import {
  ActivityType,
  AppointmentStatus,
  BusinessKind,
  ConversationChannel,
  ConversationMode,
  ConversationStage,
  ConversationState,
  CustomerFactKey,
  HandoffReason,
  JobStatus,
  LeadStatus,
  MessageAuthor,
  MessageDirection,
  MessagePurpose,
  MemorySource,
  NextActionStatus,
  NextActionType,
  OpportunityLostReason,
  PaymentKind,
  PaymentReferenceType,
  PaymentStatus,
  QuoteStatus,
  RevenueStage,
  WorkflowType,
  type Appointment,
  type ConsentRecord,
  type Contact,
  type Conversation,
  type CustomerFactValue,
  type HumanHandoff,
  type Job,
  type Lead,
  type Message,
  type NextAction,
  type Payment,
  type Quote,
  type QuoteItem,
  type RevenueEvent,
  type TenantEntity,
} from '../domain/entities';
import {
  DomainError,
  assertMoney,
  assertNextActionInvariant,
  assertNoDoubleBooking,
  calculateQuoteTotals,
  canAcceptQuote,
  remainingBalance,
} from '../domain/rules';
import type { AIProvider } from '../integrations/ai/AIProvider';
import type { MessagingProvider } from '../integrations/messaging/MessagingProvider';
import type { DatabasePort, DatabaseSchema } from '../repositories/contracts';
import {
  AutonomyLevel,
  type AssistantContext,
  type AssistantDecision,
  type ConversationDecisionRecord,
  type MemoryConflict,
} from '../types/assistant';
import { AssistantToolExecutor } from './conversation/AssistantToolExecutor';
import { AssistantDecisionPolicy } from './conversation/AssistantDecisionPolicy';
import { ConversationStageService } from './conversation/ConversationStageService';
import { CustomerMemoryService } from './conversation/CustomerMemoryService';
import { FollowUpService } from './conversation/FollowUpService';
import { ActivityTimelineService } from './commercial/ActivityTimelineService';
import { CommercialJourneyService } from './commercial/CommercialJourneyService';
import type { ActionCenterItem, CommercialOpportunityView } from '../types/commercial';

export interface CreateAppointmentInput {
  businessId: string;
  contactId: string;
  leadId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  totalCents?: number;
  operationKey?: string;
}

export interface CreateQuoteInput {
  businessId: string;
  contactId: string;
  leadId: string;
  items: QuoteItem[];
  discountCents?: number;
  depositBasisPoints?: number;
  operationKey?: string;
}

export interface RecordPaymentInput {
  businessId: string;
  contactId: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  kind: PaymentKind;
  amountCents: number;
  idempotencyKey: string;
  originalPaymentId?: string;
}

export interface ReceiveCustomerMessageOptions {
  providerMessageId?: string;
}

export interface CreateCustomerOpportunityInput {
  businessId: string;
  displayName: string;
  phone?: string;
}

export class CloserService {
  private readonly memoryService: CustomerMemoryService;
  private readonly stageService = new ConversationStageService();
  private readonly toolExecutor = new AssistantToolExecutor();
  private readonly decisionPolicy = new AssistantDecisionPolicy();
  private readonly followUpService: FollowUpService;
  private readonly timelineService: ActivityTimelineService;
  private readonly commercialJourney: CommercialJourneyService;

  constructor(
    private readonly database: DatabasePort,
    private readonly aiProvider: AIProvider,
    private readonly messagingProvider: MessagingProvider,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {
    this.memoryService = new CustomerMemoryService(database, now, id);
    this.followUpService = new FollowUpService(database, now, id);
    this.timelineService = new ActivityTimelineService(database, now, id);
    this.commercialJourney = new CommercialJourneyService(database);
  }

  snapshot(): DatabaseSchema {
    return this.database.snapshot();
  }

  subscribe(listener: () => void): () => void {
    return this.database.subscribe(listener);
  }

  resetDemo(): void {
    this.database.reset();
  }

  resetTo(seed: DatabaseSchema): void {
    this.database.reset(seed);
  }

  validateNextActions(businessId: string): void {
    const repositories = this.database.repositories;
    const actions = repositories.nextActions.list(businessId);
    repositories.leads.list(businessId).forEach((lead) => assertNextActionInvariant(lead, actions));
  }

  opportunity(businessId: string, leadId: string): CommercialOpportunityView {
    return this.commercialJourney.evaluate(businessId, leadId).opportunity;
  }

  actionCenter(businessId: string): ActionCenterItem[] {
    const repositories = this.database.repositories;
    return repositories.leads
      .list(businessId)
      .filter((lead) => ![LeadStatus.Won, LeadStatus.Lost, LeadStatus.Archived].includes(lead.status))
      .map((lead) => {
        const action = lead.nextActionId
          ? repositories.nextActions.get(businessId, lead.nextActionId)
          : null;
        const contact = required(repositories.contacts.get(businessId, lead.contactId), 'Contact not found');
        const opportunity = this.opportunity(businessId, lead.id);
        return action && action.status === NextActionStatus.Pending
          ? {
              id: action.id,
              businessId,
              leadId: lead.id,
              contactId: lead.contactId,
              conversationId: lead.conversationId,
              customerName: contact.displayName,
              actionType: action.type,
              reason: action.reason,
              amountCents:
                action.type === NextActionType.CollectBalance
                  ? opportunity.remainingBalanceCents
                  : action.type === NextActionType.RequestDeposit
                    ? this.depositOutstanding(opportunity)
                    : action.type === NextActionType.FollowUpQuote
                      ? opportunity.totalCents
                      : null,
              dueAt: action.dueAt,
              createdAt: action.createdAt,
            }
          : null;
      })
      .filter((item): item is ActionCenterItem => item !== null)
      .sort((first, second) =>
        (first.dueAt ?? first.createdAt).localeCompare(second.dueAt ?? second.createdAt),
      );
  }

  activityTimeline(businessId: string, contactId: string) {
    required(this.database.repositories.contacts.get(businessId, contactId), 'Contact not found');
    return this.timelineService.list(businessId, contactId);
  }

  reconcileOpportunity(businessId: string, leadId: string): CommercialOpportunityView {
    const repositories = this.database.repositories;
    const result = this.commercialJourney.evaluate(businessId, leadId);
    const lead = required(repositories.leads.get(businessId, leadId), 'Lead not found');
    const conversation = required(
      repositories.conversations.get(businessId, lead.conversationId),
      'Conversation not found',
    );
    if (result.shouldRemainClosedLost) {
      this.followUpService.cancelPending(businessId, lead.conversationId);
      this.clearPendingActions(businessId, lead);
      return this.commercialJourney.evaluate(businessId, leadId).opportunity;
    }
    if (result.shouldCloseWon) {
      this.closeWon(businessId, lead, conversation);
      return this.commercialJourney.evaluate(businessId, leadId).opportunity;
    }
    const reopensAfterRefund =
      lead.status === LeadStatus.Won &&
      result.opportunity.stage === ConversationStage.AwaitingBalance;
    repositories.leads.save(businessId, {
      ...lead,
      updatedAt: this.now(),
      status:
        lead.status === LeadStatus.New || reopensAfterRefund
          ? LeadStatus.Active
          : lead.status,
      closedAt: reopensAfterRefund ? null : lead.closedAt,
    });
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: this.now(),
      inferredStage: result.opportunity.stage,
      state: conversationStateForStage(result.opportunity.stage),
      mode: reopensAfterRefund ? ConversationMode.AiActive : conversation.mode,
      automationEnabled: reopensAfterRefund ? true : conversation.automationEnabled,
    });
    if (reopensAfterRefund) {
      this.activity(businessId, lead.contactId, lead.conversationId, ActivityType.OpportunityReopened, 'Refund created an outstanding balance; opportunity reopened.', {}, `${lead.id}:reopen:refund:${result.opportunity.remainingBalanceCents}`);
      this.tryScheduleFollowUp(
        businessId,
        lead.conversationId,
        ConversationStage.AwaitingBalance,
        addHours(this.now(), 24),
      );
    }
    if (result.action) {
      this.replaceNextAction(
        businessId,
        lead.conversationId,
        result.action.type,
        result.action.reason,
        result.action.automatic,
        result.action.dueAt,
      );
    }
    return this.commercialJourney.evaluate(businessId, leadId).opportunity;
  }

  closeOpportunityLost(
    businessId: string,
    leadId: string,
    reason: OpportunityLostReason,
    operationKey = `${leadId}:lost:${reason}`,
  ): Lead {
    const repositories = this.database.repositories;
    const lead = required(repositories.leads.get(businessId, leadId), 'Lead not found');
    if (lead.status === LeadStatus.Lost) {
      if (lead.lostReason !== reason) {
        throw new DomainError('Opportunity is already closed for another reason', 'IDEMPOTENCY_CONFLICT');
      }
      return lead;
    }
    if (lead.status === LeadStatus.Won) {
      throw new DomainError('A won opportunity cannot be closed lost', 'INVALID_LEAD_STATE');
    }
    this.clearPendingActions(businessId, lead);
    this.followUpService.cancelPending(businessId, lead.conversationId);
    const closed = repositories.leads.save(businessId, {
      ...lead,
      updatedAt: this.now(),
      status: LeadStatus.Lost,
      lostReason: reason,
      nextActionId: null,
      closedAt: this.now(),
    });
    const conversation = required(
      repositories.conversations.get(businessId, lead.conversationId),
      'Conversation not found',
    );
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: this.now(),
      state: ConversationState.Complete,
      inferredStage: ConversationStage.ClosedLost,
      mode: ConversationMode.Closed,
      automationEnabled: false,
      nextActionId: null,
    });
    this.activity(
      businessId,
      lead.contactId,
      lead.conversationId,
      ActivityType.OpportunityLost,
      `Opportunity closed: ${reason.toLowerCase().replaceAll('_', ' ')}.`,
      {},
      operationKey,
    );
    return closed;
  }

  reopenOpportunity(
    businessId: string,
    leadId: string,
    operationKey = `${leadId}:reopen`,
  ): Lead {
    const repositories = this.database.repositories;
    const lead = required(repositories.leads.get(businessId, leadId), 'Lead not found');
    if (lead.status !== LeadStatus.Lost) return lead;
    const conversation = required(
      repositories.conversations.get(businessId, lead.conversationId),
      'Conversation not found',
    );
    repositories.leads.save(businessId, {
      ...lead,
      updatedAt: this.now(),
      status: LeadStatus.Active,
      lostReason: null,
      closedAt: null,
    });
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: this.now(),
      state: ConversationState.Qualifying,
      inferredStage: ConversationStage.Discovery,
      mode: ConversationMode.AiActive,
      automationEnabled: true,
    });
    this.activity(
      businessId,
      lead.contactId,
      lead.conversationId,
      ActivityType.OpportunityReopened,
      'Customer returned; opportunity reopened.',
      {},
      operationKey,
    );
    this.reconcileOpportunity(businessId, leadId);
    return required(repositories.leads.get(businessId, leadId), 'Lead not found');
  }

  async receiveCustomerMessage(
    businessId: string,
    conversationId: string,
    body: string,
    options: ReceiveCustomerMessageOptions = {},
  ): Promise<AssistantDecision> {
    if (!body.trim()) throw new DomainError('Message body is required', 'EMPTY_MESSAGE');
    const repositories = this.database.repositories;
    const conversation = required(
      repositories.conversations.get(businessId, conversationId),
      'Conversation not found',
    );
    if (conversation.mode === ConversationMode.Closed) {
      throw new DomainError('Closed conversations cannot receive messages', 'CONVERSATION_CLOSED');
    }
    const providerMessageId = options.providerMessageId ?? `mock-inbound-${this.id()}`;
    const duplicate = repositories.messages.find(
      businessId,
      (message) => message.providerMessageId === providerMessageId,
    )[0];
    if (duplicate) {
      if (duplicate.conversationId !== conversationId || duplicate.body !== body.trim()) {
        throw new DomainError(
          'Incoming message id was reused for different content',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      const record = repositories.assistantDecisionRecords.find(
        businessId,
        (candidate) => candidate.triggeringMessageId === duplicate.id,
      )[0];
      if (!record) {
        throw new DomainError(
          'Incoming message was already accepted and is awaiting a decision',
          'MESSAGE_ALREADY_RECEIVED',
        );
      }
      return structuredClone(record.decision);
    }
    const at = this.now();
    const message: Message = {
      ...this.entityBase(businessId),
      conversationId,
      direction: MessageDirection.Inbound,
      author: MessageAuthor.Customer,
      purpose: MessagePurpose.Operational,
      body: body.trim(),
      providerMessageId,
      sentAt: at,
    };
    repositories.messages.save(businessId, message);
    this.followUpService.cancelPending(businessId, conversationId);
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: at,
      lastCustomerMessageAt: at,
    });
    this.activity(businessId, conversation.contactId, conversationId, ActivityType.MessageReceived, 'Customer message received.');

    if (isOptOutMessage(body)) this.optOutMarketing(businessId, conversation.contactId, 'CUSTOMER_MESSAGE');

    const business = required(repositories.businesses.get(businessId, businessId), 'Business not found');
    const memoryCapture = this.memoryService.captureFromMessage(
      businessId,
      conversation.contactId,
      message,
      business.kind,
      repositories.services.list(businessId),
    );
    if (memoryCapture.saved.length > 0) {
      this.activity(
        businessId,
        conversation.contactId,
        conversationId,
        ActivityType.MemoryChanged,
        `${memoryCapture.saved.length} customer fact${memoryCapture.saved.length === 1 ? '' : 's'} updated.`,
      );
    }
    const rememberedService = memoryCapture.saved.find(
      (fact) =>
        fact.key === CustomerFactKey.RequestedService ||
        fact.key === CustomerFactKey.RequestedJob,
    );
    if (rememberedService && typeof rememberedService.value === 'string') {
      const lead = required(
        repositories.leads.find(
          businessId,
          (candidate) => candidate.conversationId === conversationId,
        )[0] ?? null,
        'Lead not found',
      );
      const selectedService = repositories.services.get(businessId, rememberedService.value);
      if (selectedService) {
        repositories.leads.save(businessId, {
          ...lead,
          updatedAt: this.now(),
          serviceId: selectedService.id,
        });
      }
    }

    let decision = await this.getAssistantDecision(
      businessId,
      conversationId,
      memoryCapture.conflicts,
    );
    const context = this.buildAssistantContext(
      businessId,
      conversationId,
      memoryCapture.conflicts,
    );
    decision = this.decisionPolicy.validate(context, decision);
    const toolResult = this.toolExecutor.execute(
      businessId,
      context,
      decision,
      (tenantId, serviceId, staffId, date) =>
        this.getAvailableSlots(tenantId, serviceId, staffId, date),
    );
    decision = this.decisionPolicy.applyToolResult(context, decision, toolResult);
    repositories.conversations.save(businessId, {
      ...required(repositories.conversations.get(businessId, conversationId), 'Conversation not found'),
      updatedAt: this.now(),
      currentIntent: decision.detectedIntent,
      inferredStage: decision.conversationStage,
      missingInformation: decision.missingInformation.map(String),
    });

    const modeBeforeDecision = conversation.mode;
    if (modeBeforeDecision === ConversationMode.HumanActive || modeBeforeDecision === ConversationMode.Paused) {
      // Internal suggestion only. No action, follow-up, send, or mode change may execute.
    } else if (decision.requiresHumanReview) {
      this.startHumanTakeover(
        businessId,
        conversationId,
        decision.handoffReason ?? HandoffReason.UnsupportedKnowledge,
        decision.suggestedReply,
        'ASSISTANT',
        {
          triggeringMessageId: message.id,
          confidence: decision.confidence,
          responsibleState: decision.conversationStage,
        },
      );
    } else {
      this.replaceNextAction(
        businessId,
        conversationId,
        decision.suggestedNextAction,
        decision.missingInformation.length > 0
          ? plainMissingInformation(decision.missingInformation)
          : plainNextActionReason(decision),
        true,
      );
      this.followUpService.scheduleForDecision(
        businessId,
        required(repositories.conversations.get(businessId, conversationId), 'Conversation not found'),
        message.id,
        decision,
      );
    }
    const record: ConversationDecisionRecord = {
      ...this.entityBase(businessId),
      contactId: conversation.contactId,
      conversationId,
      triggeringMessageId: message.id,
      decision: structuredClone(decision),
      toolResult: structuredClone(toolResult),
    };
    repositories.assistantDecisionRecords.save(businessId, record);
    this.activity(
      businessId,
      conversation.contactId,
      conversationId,
      ActivityType.AssistantToolRequested,
      `${decision.requestedTool}: ${toolResult.status}`,
    );
    if (
      modeBeforeDecision === ConversationMode.AiActive &&
      !decision.requiresHumanReview &&
      decision.autonomyLevel <= AutonomyLevel.InformationCollection &&
      this.decisionPolicy.canAutomaticallySend(decision, toolResult) &&
      this.canSendOperationalMessage(businessId, conversation.contactId)
    ) {
      await this.sendMessage(businessId, conversationId, decision.suggestedReply, {
        author: MessageAuthor.Assistant,
        purpose: MessagePurpose.Operational,
      });
    }
    return decision;
  }

  async getAssistantDecision(
    businessId: string,
    conversationId: string,
    memoryConflicts: MemoryConflict[] = [],
  ): Promise<AssistantDecision> {
    return this.aiProvider.decide(
      this.buildAssistantContext(businessId, conversationId, memoryConflicts),
    );
  }

  createCustomerOpportunity(input: CreateCustomerOpportunityInput): {
    contact: Contact;
    lead: Lead;
    conversation: Conversation;
  } {
    const repositories = this.database.repositories;
    const business = required(
      repositories.businesses.get(input.businessId, input.businessId),
      'Business not found',
    );
    const contact: Contact = {
      ...this.entityBase(input.businessId),
      displayName: input.displayName.trim() || 'New customer',
      phone: input.phone?.trim() || `+972-555-${this.id().slice(0, 7)}`,
      email: null,
      address: null,
      notes: [],
    };
    repositories.contacts.save(input.businessId, contact);
    const conversation: Conversation = {
      ...this.entityBase(input.businessId),
      contactId: contact.id,
      channel: ConversationChannel.WhatsApp,
      ownerTeamMemberId: null,
      state: ConversationState.NewInquiry,
      inferredStage: ConversationStage.NewInquiry,
      mode: ConversationMode.AiActive,
      automationEnabled: true,
      lastCustomerMessageAt: null,
      lastBusinessResponseAt: null,
      currentIntent: null,
      missingInformation: [],
      nextActionId: null,
      handoffId: null,
    };
    repositories.conversations.save(input.businessId, conversation);
    const lead: Lead = {
      ...this.entityBase(input.businessId),
      contactId: contact.id,
      conversationId: conversation.id,
      workflowType: business.workflowType,
      status: LeadStatus.New,
      serviceId: null,
      nextActionId: null,
      closedAt: null,
      lostReason: null,
    };
    repositories.leads.save(input.businessId, lead);
    this.replaceNextAction(
      input.businessId,
      conversation.id,
      NextActionType.ReplyToCustomer,
      'Reply to the new customer.',
      false,
    );
    const consent: ConsentRecord = {
      ...this.entityBase(input.businessId),
      contactId: contact.id,
      marketingAllowed: false,
      operationalAllowed: true,
      optedOut: false,
      source: 'MANUAL',
      changedAt: this.now(),
    };
    repositories.consentRecords.save(input.businessId, consent);
    return {
      contact,
      lead: required(repositories.leads.get(input.businessId, lead.id), 'Lead not found'),
      conversation: required(
        repositories.conversations.get(input.businessId, conversation.id),
        'Conversation not found',
      ),
    };
  }

  selectServiceForLead(businessId: string, leadId: string, serviceId: string): Lead {
    const repositories = this.database.repositories;
    const lead = required(repositories.leads.get(businessId, leadId), 'Lead not found');
    const service = required(repositories.services.get(businessId, serviceId), 'Service not found');
    if (lead.workflowType !== service.workflowType) {
      throw new DomainError('Service does not match this commercial journey', 'WORKFLOW_MISMATCH');
    }
    this.memoryService.remember(
      businessId,
      lead.contactId,
      lead.workflowType === WorkflowType.QuoteJob &&
        repositories.businesses.get(businessId, businessId)?.kind === BusinessKind.HomeServices
        ? CustomerFactKey.RequestedJob
        : CustomerFactKey.RequestedService,
      service.id,
      MemorySource.Manual,
    );
    const selected = repositories.leads.save(businessId, {
      ...lead,
      updatedAt: this.now(),
      serviceId: service.id,
    });
    this.reconcileOpportunity(businessId, lead.id);
    return selected;
  }

  rememberCustomerFact(
    businessId: string,
    contactId: string,
    key: CustomerFactKey,
    value: CustomerFactValue,
  ) {
    const fact = this.memoryService.remember(
      businessId,
      contactId,
      key,
      value,
      MemorySource.Manual,
    );
    const activeLead = this.database.repositories.leads.find(
      businessId,
      (lead) => lead.contactId === contactId && ![LeadStatus.Won, LeadStatus.Lost, LeadStatus.Archived].includes(lead.status),
    )[0];
    if (activeLead) this.reconcileOpportunity(businessId, activeLead.id);
    return fact;
  }

  scheduleFollowUpForConversation(
    businessId: string,
    conversationId: string,
    dueAt: string,
  ) {
    const stage = this.inferConversationStage(businessId, conversationId);
    const followUp = this.followUpService.scheduleForStage(
      businessId,
      conversationId,
      stage,
      dueAt,
    );
    const conversation = required(
      this.database.repositories.conversations.get(businessId, conversationId),
      'Conversation not found',
    );
    this.activity(
      businessId,
      conversation.contactId,
      conversationId,
      ActivityType.FollowUpScheduled,
      followUp.reason,
    );
    return followUp;
  }

  inferConversationStage(businessId: string, conversationId: string): ConversationStage {
    const repositories = this.database.repositories;
    const conversation = required(
      repositories.conversations.get(businessId, conversationId),
      'Conversation not found',
    );
    const lead = required(
      repositories.leads.find(
        businessId,
        (candidate) => candidate.conversationId === conversationId,
      )[0] ?? null,
      'Lead not found',
    );
    const knowledge = required(
      repositories.businessKnowledge.list(businessId)[0] ?? null,
      'Business knowledge not found',
    );
    return this.stageService.infer({
      lead,
      conversation,
      knowledge,
      memory: this.memoryService.list(businessId, conversation.contactId),
      appointments: repositories.appointments.find(
        businessId,
        (appointment) => appointment.leadId === lead.id,
      ),
      quotes: repositories.quotes.find(businessId, (quote) => quote.leadId === lead.id),
      jobs: repositories.jobs.find(businessId, (job) => job.leadId === lead.id),
      payments: repositories.payments.find(
        businessId,
        (payment) => payment.contactId === conversation.contactId,
      ),
      followUps: repositories.scheduledFollowUps.find(
        businessId,
        (followUp) => followUp.conversationId === conversationId,
      ),
    });
  }

  latestDecisionRecord(
    businessId: string,
    conversationId: string,
  ): ConversationDecisionRecord | null {
    return (
      this.database.repositories.assistantDecisionRecords
        .find(businessId, (record) => record.conversationId === conversationId)
        .at(-1) ?? null
    );
  }

  private canSendOperationalMessage(businessId: string, contactId: string): boolean {
    const consent = this.database.repositories.consentRecords.find(
      businessId,
      (record) => record.contactId === contactId,
    )[0];
    return consent?.operationalAllowed ?? true;
  }

  async sendMessage(
    businessId: string,
    conversationId: string,
    body: string,
    options: { author?: MessageAuthor; purpose?: MessagePurpose } = {},
  ): Promise<Message> {
    const author = options.author ?? MessageAuthor.Business;
    const purpose = options.purpose ?? MessagePurpose.Operational;
    if (!body.trim()) throw new DomainError('Message body is required', 'EMPTY_MESSAGE');
    const repositories = this.database.repositories;
    const conversation = required(
      repositories.conversations.get(businessId, conversationId),
      'Conversation not found',
    );
    if (conversation.mode === ConversationMode.Closed) {
      throw new DomainError('Closed conversations cannot send messages', 'CONVERSATION_CLOSED');
    }
    if (author === MessageAuthor.Assistant && conversation.mode !== ConversationMode.AiActive) {
      throw new DomainError('Assistant messages are paused during human takeover', 'AUTOMATION_PAUSED');
    }
    const contact = required(repositories.contacts.get(businessId, conversation.contactId), 'Contact not found');
    const consent = repositories.consentRecords.find(
      businessId,
      (record) => record.contactId === contact.id,
    )[0];
    if (purpose === MessagePurpose.Marketing && (!consent?.marketingAllowed || consent.optedOut)) {
      throw new DomainError('Marketing is blocked for this contact', 'MARKETING_BLOCKED');
    }
    if (purpose === MessagePurpose.Operational && consent && !consent.operationalAllowed) {
      throw new DomainError('Operational communication is blocked', 'OPERATIONAL_BLOCKED');
    }
    const providerResult = await this.messagingProvider.send({
      businessId,
      conversationId,
      channel: conversation.channel,
      to: contact.phone,
      body: body.trim(),
    });
    const message: Message = {
      ...this.entityBase(businessId),
      conversationId,
      direction: MessageDirection.Outbound,
      author,
      purpose,
      body: body.trim(),
      providerMessageId: providerResult.providerMessageId,
      sentAt: providerResult.sentAt,
    };
    repositories.messages.save(businessId, message);
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: providerResult.sentAt,
      lastBusinessResponseAt: providerResult.sentAt,
    });
    this.activity(businessId, contact.id, conversationId, ActivityType.MessageSent, 'Business message sent.');
    return message;
  }

  startHumanTakeover(
    businessId: string,
    conversationId: string,
    reason: HandoffReason,
    detail: string,
    startedBy: HumanHandoff['startedBy'] = 'HUMAN',
    metadata: {
      triggeringMessageId?: string;
      confidence?: number;
      responsibleState?: ConversationStage;
    } = {},
  ): HumanHandoff {
    const repositories = this.database.repositories;
    const conversation = required(
      repositories.conversations.get(businessId, conversationId),
      'Conversation not found',
    );
    if (conversation.mode === ConversationMode.Closed) {
      throw new DomainError('Closed conversations cannot start human takeover', 'CONVERSATION_CLOSED');
    }
    const existing = repositories.humanHandoffs.find(
      businessId,
      (handoff) => handoff.conversationId === conversationId && handoff.resolvedAt === null,
    )[0];
    if (existing) return existing;
    const handoff: HumanHandoff = {
      ...this.entityBase(businessId),
      conversationId,
      reason,
      detail,
      startedAt: this.now(),
      resolvedAt: null,
      startedBy,
      triggeringMessageId: metadata.triggeringMessageId ?? null,
      confidence: metadata.confidence ?? null,
      responsibleState: metadata.responsibleState ?? conversation.inferredStage,
    };
    repositories.humanHandoffs.save(businessId, handoff);
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: this.now(),
      mode: ConversationMode.HumanActive,
      inferredStage: ConversationStage.HumanReview,
      automationEnabled: false,
      handoffId: handoff.id,
    });
    this.replaceNextAction(businessId, conversationId, NextActionType.HumanReview, detail, false);
    this.followUpService.cancelPending(businessId, conversationId);
    this.activity(businessId, conversation.contactId, conversationId, ActivityType.HandoffStarted, `Human takeover: ${detail}`);
    return handoff;
  }

  resumeAssistant(businessId: string, conversationId: string): Conversation {
    const repositories = this.database.repositories;
    const conversation = required(
      repositories.conversations.get(businessId, conversationId),
      'Conversation not found',
    );
    if (conversation.mode !== ConversationMode.HumanActive && conversation.mode !== ConversationMode.Paused) {
      throw new DomainError('Assistant can only resume from a paused or human-active conversation', 'RESUME_NOT_REQUIRED');
    }
    if (conversation.handoffId) {
      const handoff = repositories.humanHandoffs.get(businessId, conversation.handoffId);
      if (handoff) {
        repositories.humanHandoffs.save(businessId, {
          ...handoff,
          updatedAt: this.now(),
          resolvedAt: this.now(),
        });
      }
    }
    const resumed: Conversation = {
      ...conversation,
      updatedAt: this.now(),
      mode: ConversationMode.AiActive,
      inferredStage: ConversationStage.Discovery,
      automationEnabled: true,
      handoffId: null,
    };
    repositories.conversations.save(businessId, resumed);
    const inferredStage = this.inferConversationStage(businessId, conversationId);
    repositories.conversations.save(businessId, {
      ...resumed,
      updatedAt: this.now(),
      inferredStage,
    });
    const resumedAction = nextActionForConversationStage(inferredStage);
    this.replaceNextAction(
      businessId,
      conversationId,
      resumedAction,
      resumedActionReason(resumedAction),
      true,
    );
    this.activity(businessId, conversation.contactId, conversationId, ActivityType.AssistantResumed, 'Assistant mode explicitly resumed.');
    const lead = required(
      repositories.leads.find(businessId, (candidate) => candidate.conversationId === conversationId)[0] ?? null,
      'Lead not found',
    );
    this.reconcileOpportunity(businessId, lead.id);
    return required(repositories.conversations.get(businessId, conversationId), 'Conversation not found');
  }

  optOutMarketing(
    businessId: string,
    contactId: string,
    source: ConsentRecord['source'] = 'MANUAL',
  ): ConsentRecord {
    const repositories = this.database.repositories;
    required(repositories.contacts.get(businessId, contactId), 'Contact not found');
    const current = repositories.consentRecords.find(
      businessId,
      (record) => record.contactId === contactId,
    )[0];
    const record: ConsentRecord = {
      ...(current ?? this.entityBase(businessId)),
      id: current?.id ?? this.id(),
      businessId,
      createdAt: current?.createdAt ?? this.now(),
      updatedAt: this.now(),
      contactId,
      marketingAllowed: false,
      operationalAllowed: current?.operationalAllowed ?? true,
      optedOut: true,
      source,
      changedAt: this.now(),
    };
    repositories.consentRecords.save(businessId, record);
    this.activity(businessId, contactId, null, ActivityType.ConsentChanged, 'Marketing opt-out recorded.');
    return record;
  }

  getAvailableSlots(
    businessId: string,
    serviceId: string,
    staffId: string,
    date: string,
  ): string[] {
    const repositories = this.database.repositories;
    const service = required(repositories.services.get(businessId, serviceId), 'Service not found');
    required(repositories.teamMembers.get(businessId, staffId), 'Staff member not found');
    const dateStart = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(dateStart.getTime())) throw new DomainError('Invalid slot date', 'INVALID_DATE');
    const rule = repositories.availabilityRules.find(
      businessId,
      (candidate) => candidate.staffId === staffId && candidate.weekdays.includes(dateStart.getUTCDay()),
    )[0];
    if (!rule) return [];
    const [startHour, startMinute] = parseTime(rule.startTime);
    const [endHour, endMinute] = parseTime(rule.endTime);
    const cursor = new Date(dateStart);
    cursor.setUTCHours(startHour, startMinute, 0, 0);
    const end = new Date(dateStart);
    end.setUTCHours(endHour, endMinute, 0, 0);
    const existing = repositories.appointments.list(businessId);
    const slots: string[] = [];
    while (cursor.getTime() + service.durationMinutes * 60_000 <= end.getTime()) {
      const candidate = this.appointmentCandidate(
        businessId,
        'slot-check',
        'slot-check',
        serviceId,
        staffId,
        cursor.toISOString(),
        service.durationMinutes,
        service.fixedPriceCents ?? 0,
        0,
        `slot:${staffId}:${cursor.toISOString()}`,
      );
      try {
        assertNoDoubleBooking(candidate, existing);
        slots.push(cursor.toISOString());
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'DOUBLE_BOOKING') throw error;
      }
      cursor.setUTCMinutes(cursor.getUTCMinutes() + rule.slotIntervalMinutes);
    }
    return slots;
  }

  createAppointment(input: CreateAppointmentInput): Appointment {
    const repositories = this.database.repositories;
    const contact = required(repositories.contacts.get(input.businessId, input.contactId), 'Contact not found');
    const lead = required(repositories.leads.get(input.businessId, input.leadId), 'Lead not found');
    this.assertOpenLead(lead);
    if (lead.workflowType !== WorkflowType.AppointmentService) {
      throw new DomainError('This opportunity does not use appointments', 'WORKFLOW_MISMATCH');
    }
    if (lead.contactId !== contact.id) throw new DomainError('Lead and contact do not match', 'CONTACT_MISMATCH');
    const service = required(repositories.services.get(input.businessId, input.serviceId), 'Service not found');
    if (service.workflowType !== WorkflowType.AppointmentService) {
      throw new DomainError('This service does not use appointments', 'WORKFLOW_MISMATCH');
    }
    if (lead.serviceId && lead.serviceId !== service.id) {
      throw new DomainError('Appointment service does not match the opportunity', 'SERVICE_MISMATCH');
    }
    required(repositories.teamMembers.get(input.businessId, input.staffId), 'Staff member not found');
    const totalCents = input.totalCents ?? service.fixedPriceCents;
    if (totalCents === null) throw new DomainError('Appointment total must be validated', 'TOTAL_REQUIRED');
    assertMoney(totalCents, 'totalCents');
    const settings = required(repositories.businessSettings.list(input.businessId)[0] ?? null, 'Settings not found');
    const deposit = service.requiresDeposit
      ? Math.round((totalCents * settings.defaultDepositBasisPoints) / 10_000)
      : 0;
    const appointment = this.appointmentCandidate(
      input.businessId,
      input.contactId,
      input.leadId,
      input.serviceId,
      input.staffId,
      input.startAt,
      service.durationMinutes,
      totalCents,
      deposit,
      input.operationKey ?? `${input.leadId}:appointment:${new Date(input.startAt).toISOString()}`,
    );
    const existing = repositories.appointments.find(
      input.businessId,
      (candidate) => candidate.operationKey === appointment.operationKey,
    )[0];
    if (existing) {
      if (
        existing.contactId !== input.contactId ||
        existing.leadId !== input.leadId ||
        existing.serviceId !== input.serviceId ||
        existing.staffId !== input.staffId ||
        existing.startAt !== appointment.startAt ||
        existing.totalCents !== appointment.totalCents
      ) {
        throw new DomainError('Appointment operation key was reused', 'IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    assertNoDoubleBooking(appointment, repositories.appointments.list(input.businessId));
    this.assertNoJobConflict(
      input.businessId,
      input.staffId,
      appointment.startAt,
      appointment.endAt,
    );
    repositories.appointments.save(input.businessId, appointment);
    this.recordRevenueEvent({
      businessId: input.businessId,
      contactId: input.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      stage: RevenueStage.Booked,
      amountCents: totalCents,
      causationId: `${appointment.id}:booked`,
      correlationId: appointment.id,
    });
    this.tryScheduleFollowUp(
      input.businessId,
      lead.conversationId,
      deposit > 0
        ? ConversationStage.AwaitingDeposit
        : ConversationStage.AwaitingConfirmation,
      addHours(this.now(), deposit > 0 ? 48 : 24),
    );
    this.activity(input.businessId, input.contactId, lead.conversationId, ActivityType.AppointmentCreated, 'Appointment created.', { appointmentId: appointment.id }, `${appointment.operationKey}:created`);
    this.reconcileOpportunity(input.businessId, lead.id);
    return appointment;
  }

  rescheduleAppointment(businessId: string, appointmentId: string, startAt: string): Appointment {
    const repositories = this.database.repositories;
    const appointment = required(repositories.appointments.get(businessId, appointmentId), 'Appointment not found');
    if (appointment.status === AppointmentStatus.Cancelled || appointment.status === AppointmentStatus.Completed) {
      throw new DomainError('This appointment cannot be rescheduled', 'INVALID_APPOINTMENT_STATE');
    }
    const duration = new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime();
    const next: Appointment = {
      ...appointment,
      updatedAt: this.now(),
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(new Date(startAt).getTime() + duration).toISOString(),
    };
    assertNoDoubleBooking(next, repositories.appointments.list(businessId));
    const saved = repositories.appointments.save(businessId, next);
    const lead = required(repositories.leads.get(businessId, appointment.leadId), 'Lead not found');
    this.activity(businessId, appointment.contactId, lead.conversationId, ActivityType.AppointmentRescheduled, 'Appointment rescheduled.', { appointmentId, startAt: saved.startAt }, `${appointmentId}:rescheduled:${saved.startAt}`);
    this.reconcileOpportunity(businessId, appointment.leadId);
    return saved;
  }

  cancelAppointment(businessId: string, appointmentId: string): Appointment {
    const repositories = this.database.repositories;
    const appointment = required(repositories.appointments.get(businessId, appointmentId), 'Appointment not found');
    if (appointment.status === AppointmentStatus.Completed) {
      throw new DomainError('Completed appointments cannot be cancelled', 'INVALID_APPOINTMENT_STATE');
    }
    const cancelled = repositories.appointments.save(businessId, {
      ...appointment,
      updatedAt: this.now(),
      status: AppointmentStatus.Cancelled,
    });
    const lead = required(repositories.leads.get(businessId, appointment.leadId), 'Lead not found');
    this.activity(businessId, appointment.contactId, lead.conversationId, ActivityType.AppointmentCancelled, 'Appointment cancelled.', { appointmentId }, `${appointmentId}:cancelled`);
    this.closeOpportunityLost(businessId, appointment.leadId, OpportunityLostReason.Cancelled, `${appointmentId}:lost`);
    return cancelled;
  }

  confirmAppointment(businessId: string, appointmentId: string): Appointment {
    const repositories = this.database.repositories;
    const appointment = required(repositories.appointments.get(businessId, appointmentId), 'Appointment not found');
    if (appointment.status === AppointmentStatus.Confirmed) return appointment;
    if (appointment.status !== AppointmentStatus.Tentative) {
      throw new DomainError('This appointment cannot be confirmed', 'INVALID_APPOINTMENT_STATE');
    }
    const collected = appointment.totalCents - this.balance(
      businessId,
      PaymentReferenceType.Appointment,
      appointment.id,
    );
    if (collected < appointment.depositRequiredCents) {
      throw new DomainError('Required deposit has not been collected', 'DEPOSIT_REQUIRED');
    }
    const confirmed = repositories.appointments.save(businessId, {
      ...appointment,
      updatedAt: this.now(),
      status: AppointmentStatus.Confirmed,
      confirmedAt: this.now(),
    });
    const lead = required(repositories.leads.get(businessId, appointment.leadId), 'Lead not found');
    this.activity(businessId, appointment.contactId, lead.conversationId, ActivityType.AppointmentConfirmed, 'Appointment confirmed.', { appointmentId }, `${appointmentId}:confirmed`);
    this.reconcileOpportunity(businessId, appointment.leadId);
    return confirmed;
  }

  completeAppointment(businessId: string, appointmentId: string): Appointment {
    const repositories = this.database.repositories;
    const appointment = required(repositories.appointments.get(businessId, appointmentId), 'Appointment not found');
    if (appointment.status === AppointmentStatus.Completed) return appointment;
    if (appointment.status === AppointmentStatus.Cancelled) {
      throw new DomainError('Cancelled appointments cannot be completed', 'INVALID_APPOINTMENT_STATE');
    }
    const completed = repositories.appointments.save(businessId, {
      ...appointment,
      updatedAt: this.now(),
      status: AppointmentStatus.Completed,
      completedAt: this.now(),
    });
    this.recordRevenueEvent({
      businessId,
      contactId: appointment.contactId,
      referenceType: PaymentReferenceType.Appointment,
      referenceId: appointment.id,
      stage: RevenueStage.Completed,
      amountCents: appointment.totalCents,
      causationId: `${appointment.id}:completed`,
      correlationId: appointment.id,
    });
    const lead = required(repositories.leads.get(businessId, appointment.leadId), 'Lead not found');
    this.activity(businessId, appointment.contactId, lead.conversationId, ActivityType.AppointmentCompleted, 'Appointment completed.', { appointmentId }, `${appointmentId}:completed:activity`);
    if (!this.closeIfSettled(businessId, appointment.leadId, PaymentReferenceType.Appointment, appointment.id)) {
      const lead = required(repositories.leads.get(businessId, appointment.leadId), 'Lead not found');
      this.replaceNextAction(businessId, lead.conversationId, NextActionType.CollectBalance, 'Service is complete; collect the remaining balance.', false);
      this.setConversationState(businessId, lead.conversationId, ConversationState.AwaitingPayment);
      this.tryScheduleFollowUp(
        businessId,
        lead.conversationId,
        ConversationStage.AwaitingBalance,
        addHours(this.now(), 24),
      );
    }
    this.reconcileOpportunity(businessId, appointment.leadId);
    return completed;
  }

  createQuoteDraft(input: CreateQuoteInput): Quote {
    const repositories = this.database.repositories;
    const contact = required(repositories.contacts.get(input.businessId, input.contactId), 'Contact not found');
    const lead = required(repositories.leads.get(input.businessId, input.leadId), 'Lead not found');
    this.assertOpenLead(lead);
    if (lead.workflowType !== WorkflowType.QuoteJob) {
      throw new DomainError('This opportunity does not use quotes', 'WORKFLOW_MISMATCH');
    }
    if (lead.contactId !== contact.id) throw new DomainError('Lead and contact do not match', 'CONTACT_MISMATCH');
    const settings = required(repositories.businessSettings.list(input.businessId)[0] ?? null, 'Settings not found');
    const totals = calculateQuoteTotals(
      input.items,
      input.discountCents ?? 0,
      settings.taxEnabled ? settings.taxRateBasisPoints : 0,
    );
    const depositBasisPoints = input.depositBasisPoints ?? settings.defaultDepositBasisPoints;
    const operationKey = input.operationKey ?? `${input.leadId}:quote:${input.items.map((item) => `${item.description}:${item.quantity}:${item.unitPriceCents}`).join('|')}`;
    const existing = repositories.quotes.find(
      input.businessId,
      (candidate) => candidate.operationKey === operationKey,
    )[0];
    if (existing) {
      if (
        existing.contactId !== input.contactId ||
        existing.leadId !== input.leadId ||
        existing.totalCents !== totals.totalCents
      ) {
        throw new DomainError('Quote operation key was reused', 'IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    const quote: Quote = {
      ...this.entityBase(input.businessId),
      contactId: input.contactId,
      leadId: input.leadId,
      items: structuredClone(input.items),
      ...totals,
      depositRequiredCents: Math.round((totals.totalCents * depositBasisPoints) / 10_000),
      status: QuoteStatus.Draft,
      expiresAt: null,
      acceptedAt: null,
      operationKey,
    };
    repositories.quotes.save(input.businessId, quote);
    this.activity(input.businessId, input.contactId, lead.conversationId, ActivityType.QuoteCreated, 'Quote draft created.', { quoteId: quote.id, totalCents: quote.totalCents }, `${operationKey}:created`);
    this.reconcileOpportunity(input.businessId, lead.id);
    return quote;
  }

  sendQuote(businessId: string, quoteId: string): Quote {
    const repositories = this.database.repositories;
    const quote = required(repositories.quotes.get(businessId, quoteId), 'Quote not found');
    if (quote.status === QuoteStatus.Sent) return quote;
    if (quote.status !== QuoteStatus.Draft && quote.status !== QuoteStatus.ChangeRequested) {
      throw new DomainError('Only a draft or changed quote can be sent', 'INVALID_QUOTE_STATE');
    }
    const sent = repositories.quotes.save(businessId, {
      ...quote,
      updatedAt: this.now(),
      status: QuoteStatus.Sent,
    });
    const lead = required(repositories.leads.get(businessId, quote.leadId), 'Lead not found');
    this.setConversationState(businessId, lead.conversationId, ConversationState.QuoteSent);
    this.replaceNextAction(businessId, lead.conversationId, NextActionType.FollowUpQuote, 'Follow up if the customer has not responded.', true);
    this.tryScheduleFollowUp(
      businessId,
      lead.conversationId,
      ConversationStage.QuoteSent,
      addHours(this.now(), 72),
    );
    this.activity(businessId, quote.contactId, lead.conversationId, ActivityType.QuoteSent, 'Quote sent.', { quoteId, totalCents: quote.totalCents }, `${quoteId}:sent`);
    this.reconcileOpportunity(businessId, quote.leadId);
    return sent;
  }

  declineQuote(
    businessId: string,
    quoteId: string,
    operationKey = `${quoteId}:declined`,
  ): Quote {
    const repositories = this.database.repositories;
    const quote = required(repositories.quotes.get(businessId, quoteId), 'Quote not found');
    if (quote.status === QuoteStatus.Rejected) return quote;
    if (quote.status === QuoteStatus.Accepted) {
      throw new DomainError('An accepted quote cannot be declined', 'INVALID_QUOTE_STATE');
    }
    const rejected = repositories.quotes.save(businessId, {
      ...quote,
      updatedAt: this.now(),
      status: QuoteStatus.Rejected,
    });
    const lead = required(repositories.leads.get(businessId, quote.leadId), 'Lead not found');
    this.activity(businessId, quote.contactId, lead.conversationId, ActivityType.QuoteDeclined, 'Customer declined the quote.', { quoteId }, operationKey);
    this.closeOpportunityLost(businessId, quote.leadId, OpportunityLostReason.CustomerDeclined, `${operationKey}:lost`);
    return rejected;
  }

  expireQuote(
    businessId: string,
    quoteId: string,
    operationKey = `${quoteId}:expired`,
  ): Quote {
    const repositories = this.database.repositories;
    const quote = required(repositories.quotes.get(businessId, quoteId), 'Quote not found');
    if (quote.status === QuoteStatus.Expired) return quote;
    if (quote.status === QuoteStatus.Accepted) {
      throw new DomainError('An accepted quote cannot expire', 'INVALID_QUOTE_STATE');
    }
    const expired = repositories.quotes.save(businessId, {
      ...quote,
      updatedAt: this.now(),
      status: QuoteStatus.Expired,
    });
    const lead = required(repositories.leads.get(businessId, quote.leadId), 'Lead not found');
    this.activity(businessId, quote.contactId, lead.conversationId, ActivityType.QuoteExpired, 'Quote expired.', { quoteId }, operationKey);
    this.closeOpportunityLost(businessId, quote.leadId, OpportunityLostReason.QuoteExpired, `${operationKey}:lost`);
    return expired;
  }

  acceptQuote(businessId: string, quoteId: string): Job {
    const repositories = this.database.repositories;
    const quote = required(repositories.quotes.get(businessId, quoteId), 'Quote not found');
    const existingJob = repositories.jobs.find(businessId, (job) => job.quoteId === quoteId)[0];
    if (existingJob) return existingJob;
    if (!canAcceptQuote(quote.status)) {
      throw new DomainError('Quote is not in an acceptable state', 'INVALID_QUOTE_STATE');
    }
    const lead = required(repositories.leads.get(businessId, quote.leadId), 'Lead not found');
    this.assertOpenLead(lead);
    if (lead.contactId !== quote.contactId || lead.workflowType !== WorkflowType.QuoteJob) {
      throw new DomainError('Quote does not match its opportunity', 'REFERENCE_MISMATCH');
    }
    repositories.quotes.save(businessId, {
      ...quote,
      updatedAt: this.now(),
      status: QuoteStatus.Accepted,
      acceptedAt: this.now(),
    });
    const contact = required(repositories.contacts.get(businessId, quote.contactId), 'Contact not found');
    const rememberedAddress = repositories.customerMemory.find(
      businessId,
      (fact) => fact.contactId === quote.contactId && fact.key === CustomerFactKey.Address,
    )[0]?.value;
    const job: Job = {
      ...this.entityBase(businessId),
      contactId: quote.contactId,
      leadId: quote.leadId,
      quoteId: quote.id,
      address: contact.address ?? (typeof rememberedAddress === 'string' ? rememberedAddress : null),
      scheduledStartAt: null,
      scheduledEndAt: null,
      assignedStaffId: null,
      status: quote.depositRequiredCents > 0 ? JobStatus.PendingDeposit : JobStatus.ReadyToSchedule,
      totalCents: quote.totalCents,
      depositRequiredCents: quote.depositRequiredCents,
      completedAt: null,
      operationKey: `${quote.id}:job`,
    };
    repositories.jobs.save(businessId, job);
    this.recordRevenueEvent({
      businessId,
      contactId: quote.contactId,
      referenceType: PaymentReferenceType.Job,
      referenceId: job.id,
      stage: RevenueStage.Booked,
      amountCents: job.totalCents,
      causationId: `${quote.id}:accepted`,
      correlationId: job.id,
    });
    this.replaceNextAction(
      businessId,
      lead.conversationId,
      job.depositRequiredCents > 0 ? NextActionType.RequestDeposit : NextActionType.ScheduleJob,
      job.depositRequiredCents > 0 ? 'Collect the validated job deposit.' : 'Schedule the accepted job.',
      false,
    );
    if (job.depositRequiredCents > 0) {
      this.tryScheduleFollowUp(
        businessId,
        lead.conversationId,
        ConversationStage.AwaitingDeposit,
        addHours(this.now(), 48),
      );
    }
    this.activity(businessId, quote.contactId, lead.conversationId, ActivityType.QuoteAccepted, 'Quote accepted.', { quoteId }, `${quoteId}:accepted:activity`);
    this.activity(businessId, quote.contactId, lead.conversationId, ActivityType.JobCreated, 'Job created from accepted quote.', { quoteId, jobId: job.id }, `${job.operationKey}:created`);
    this.reconcileOpportunity(businessId, quote.leadId);
    return job;
  }

  scheduleJob(
    businessId: string,
    jobId: string,
    staffId: string,
    startAt: string,
    endAt: string,
  ): Job {
    const repositories = this.database.repositories;
    const job = required(repositories.jobs.get(businessId, jobId), 'Job not found');
    required(repositories.teamMembers.get(businessId, staffId), 'Staff member not found');
    if (job.status === JobStatus.Scheduled) {
      const normalizedStart = new Date(startAt).toISOString();
      const normalizedEnd = new Date(endAt).toISOString();
      if (
        job.assignedStaffId === staffId &&
        job.scheduledStartAt === normalizedStart &&
        job.scheduledEndAt === normalizedEnd
      ) return job;
      throw new DomainError('A scheduled job must be rescheduled explicitly', 'INVALID_JOB_STATE');
    }
    if (job.status !== JobStatus.ReadyToSchedule) {
      throw new DomainError('This job is not ready to schedule', 'INVALID_JOB_STATE');
    }
    if (this.balance(businessId, PaymentReferenceType.Job, job.id) > job.totalCents - job.depositRequiredCents) {
      throw new DomainError('Required deposit has not been collected', 'DEPOSIT_REQUIRED');
    }
    const { normalizedStart, normalizedEnd } = this.validateJobSchedule(
      businessId,
      job.id,
      staffId,
      startAt,
      endAt,
    );
    const scheduled = repositories.jobs.save(businessId, {
      ...job,
      updatedAt: this.now(),
      assignedStaffId: staffId,
      scheduledStartAt: normalizedStart,
      scheduledEndAt: normalizedEnd,
      status: JobStatus.Scheduled,
    });
    const lead = required(repositories.leads.get(businessId, job.leadId), 'Lead not found');
    this.activity(businessId, job.contactId, lead.conversationId, ActivityType.JobScheduled, 'Job scheduled.', { jobId, startAt: scheduled.scheduledStartAt }, `${jobId}:scheduled:${scheduled.scheduledStartAt}`);
    this.reconcileOpportunity(businessId, job.leadId);
    return scheduled;
  }

  rescheduleJob(
    businessId: string,
    jobId: string,
    startAt: string,
    endAt: string,
  ): Job {
    const repositories = this.database.repositories;
    const job = required(repositories.jobs.get(businessId, jobId), 'Job not found');
    if (![JobStatus.Scheduled, JobStatus.ReadyToSchedule].includes(job.status)) {
      throw new DomainError('This job cannot be rescheduled', 'INVALID_JOB_STATE');
    }
    const staffId = required(job.assignedStaffId, 'Assigned staff member is required');
    const { normalizedStart, normalizedEnd } = this.validateJobSchedule(
      businessId,
      job.id,
      staffId,
      startAt,
      endAt,
    );
    const saved = repositories.jobs.save(businessId, {
      ...job,
      updatedAt: this.now(),
      scheduledStartAt: normalizedStart,
      scheduledEndAt: normalizedEnd,
      status: JobStatus.Scheduled,
    });
    const lead = required(repositories.leads.get(businessId, job.leadId), 'Lead not found');
    this.activity(businessId, job.contactId, lead.conversationId, ActivityType.JobRescheduled, 'Job rescheduled.', { jobId, startAt: saved.scheduledStartAt }, `${jobId}:rescheduled:${saved.scheduledStartAt}`);
    this.reconcileOpportunity(businessId, job.leadId);
    return saved;
  }

  cancelJob(businessId: string, jobId: string): Job {
    const repositories = this.database.repositories;
    const job = required(repositories.jobs.get(businessId, jobId), 'Job not found');
    if (job.status === JobStatus.Completed) {
      throw new DomainError('Completed jobs cannot be cancelled', 'INVALID_JOB_STATE');
    }
    if (job.status === JobStatus.Cancelled) return job;
    const cancelled = repositories.jobs.save(businessId, {
      ...job,
      updatedAt: this.now(),
      status: JobStatus.Cancelled,
    });
    const lead = required(repositories.leads.get(businessId, job.leadId), 'Lead not found');
    this.activity(businessId, job.contactId, lead.conversationId, ActivityType.JobCancelled, 'Job cancelled.', { jobId }, `${jobId}:cancelled`);
    this.closeOpportunityLost(businessId, job.leadId, OpportunityLostReason.Cancelled, `${jobId}:lost`);
    return cancelled;
  }

  completeJob(businessId: string, jobId: string): Job {
    const repositories = this.database.repositories;
    const job = required(repositories.jobs.get(businessId, jobId), 'Job not found');
    if (job.status === JobStatus.Completed) return job;
    if (job.status === JobStatus.Cancelled) throw new DomainError('Cancelled jobs cannot be completed', 'INVALID_JOB_STATE');
    if (job.status !== JobStatus.Scheduled && job.status !== JobStatus.InProgress) {
      throw new DomainError('A job must be scheduled before completion', 'INVALID_JOB_STATE');
    }
    const completed = repositories.jobs.save(businessId, {
      ...job,
      updatedAt: this.now(),
      status: JobStatus.Completed,
      completedAt: this.now(),
    });
    this.recordRevenueEvent({
      businessId,
      contactId: job.contactId,
      referenceType: PaymentReferenceType.Job,
      referenceId: job.id,
      stage: RevenueStage.Completed,
      amountCents: job.totalCents,
      causationId: `${job.id}:completed`,
      correlationId: job.id,
    });
    const lead = required(repositories.leads.get(businessId, job.leadId), 'Lead not found');
    this.activity(businessId, job.contactId, lead.conversationId, ActivityType.JobCompleted, 'Job completed.', { jobId }, `${jobId}:completed:activity`);
    if (!this.closeIfSettled(businessId, job.leadId, PaymentReferenceType.Job, job.id)) {
      const lead = required(repositories.leads.get(businessId, job.leadId), 'Lead not found');
      this.replaceNextAction(businessId, lead.conversationId, NextActionType.CollectBalance, 'Job is complete; collect the remaining balance.', false);
      this.setConversationState(businessId, lead.conversationId, ConversationState.AwaitingPayment);
      this.tryScheduleFollowUp(
        businessId,
        lead.conversationId,
        ConversationStage.AwaitingBalance,
        addHours(this.now(), 24),
      );
    }
    this.reconcileOpportunity(businessId, job.leadId);
    return completed;
  }

  recordPayment(input: RecordPaymentInput): Payment {
    const repositories = this.database.repositories;
    assertMoney(input.amountCents, 'amountCents');
    if (input.amountCents === 0) throw new DomainError('Payment amount must be positive', 'INVALID_PAYMENT');
    required(repositories.contacts.get(input.businessId, input.contactId), 'Contact not found');
    const existing = repositories.payments.find(
      input.businessId,
      (payment) => payment.idempotencyKey === input.idempotencyKey,
    )[0];
    if (existing) {
      if (
        existing.contactId !== input.contactId ||
        existing.referenceType !== input.referenceType ||
        existing.referenceId !== input.referenceId ||
        existing.amountCents !== input.amountCents ||
        existing.kind !== input.kind ||
        existing.originalPaymentId !== (input.originalPaymentId ?? null)
      ) {
        throw new DomainError('Idempotency key was reused for a different payment', 'IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    const reference = this.referenceDetails(input.businessId, input.referenceType, input.referenceId);
    if (reference.contactId !== input.contactId) {
      throw new DomainError('Payment customer does not match the commercial reference', 'CONTACT_MISMATCH');
    }
    if (input.kind === PaymentKind.Refund) {
      const originalId = required(input.originalPaymentId ?? null, 'Refund requires original payment');
      const original = required(repositories.payments.get(input.businessId, originalId), 'Original payment not found');
      if (
        original.contactId !== input.contactId ||
        original.referenceType !== input.referenceType ||
        original.referenceId !== input.referenceId ||
        original.kind === PaymentKind.Refund ||
        original.status !== PaymentStatus.Collected
      ) {
        throw new DomainError('Refund does not match the original payment', 'INVALID_REFUND');
      }
      const refunded = repositories.payments
        .find(input.businessId, (payment) => payment.originalPaymentId === originalId && payment.kind === PaymentKind.Refund)
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      if (refunded + input.amountCents > original.amountCents) {
        throw new DomainError('Refund exceeds the original payment', 'REFUND_EXCEEDS_PAYMENT');
      }
    } else if (input.amountCents > this.balance(input.businessId, input.referenceType, input.referenceId)) {
      throw new DomainError('Payment exceeds the remaining balance', 'OVERPAYMENT');
    }
    const payment: Payment = {
      ...this.entityBase(input.businessId),
      contactId: input.contactId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      kind: input.kind,
      status: PaymentStatus.Collected,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      originalPaymentId: input.originalPaymentId ?? null,
      collectedAt: this.now(),
    };
    repositories.payments.save(input.businessId, payment);
    this.recordRevenueEvent({
      businessId: input.businessId,
      contactId: input.contactId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      stage: input.kind === PaymentKind.Refund ? RevenueStage.Refunded : RevenueStage.Collected,
      amountCents: input.amountCents,
      causationId: payment.id,
      correlationId: input.referenceId,
    });
    if (input.referenceType === PaymentReferenceType.Job && input.kind !== PaymentKind.Refund) {
      const job = required(repositories.jobs.get(input.businessId, input.referenceId), 'Job not found');
      const collectedCents = job.totalCents - this.balance(input.businessId, PaymentReferenceType.Job, job.id);
      if (job.status === JobStatus.PendingDeposit && collectedCents >= job.depositRequiredCents) {
        repositories.jobs.save(input.businessId, {
          ...job,
          updatedAt: this.now(),
          status: JobStatus.ReadyToSchedule,
        });
        const lead = required(repositories.leads.get(input.businessId, job.leadId), 'Lead not found');
        this.replaceNextAction(
          input.businessId,
          lead.conversationId,
          NextActionType.ScheduleJob,
          'Deposit collected; schedule the job.',
          false,
        );
      }
    }
    const leadId = this.leadIdForReference(input.businessId, input.referenceType, input.referenceId);
    const lead = required(repositories.leads.get(input.businessId, leadId), 'Lead not found');
    const activityType = input.kind === PaymentKind.Refund
      ? ActivityType.RefundRecorded
      : input.kind === PaymentKind.Deposit
        ? ActivityType.DepositCollected
        : ActivityType.BalanceCollected;
    this.activity(input.businessId, input.contactId, lead.conversationId, activityType, `${input.kind.toLowerCase()} recorded.`, { paymentId: payment.id, amountCents: input.amountCents, referenceId: input.referenceId }, `${payment.id}:activity`);
    this.reconcileOpportunity(input.businessId, leadId);
    return payment;
  }

  recordDeposit(
    businessId: string,
    referenceType: PaymentReferenceType,
    referenceId: string,
    idempotencyKey = `${referenceId}:deposit`,
  ): Payment {
    const reference = this.referenceDetails(businessId, referenceType, referenceId);
    return this.recordPayment({
      businessId,
      contactId: reference.contactId,
      referenceType,
      referenceId,
      kind: PaymentKind.Deposit,
      amountCents: reference.depositRequiredCents,
      idempotencyKey,
    });
  }

  collectRemainingBalance(
    businessId: string,
    referenceType: PaymentReferenceType,
    referenceId: string,
    idempotencyKey = `${referenceId}:balance`,
  ): Payment | null {
    const reference = this.referenceDetails(businessId, referenceType, referenceId);
    const amountCents = this.balance(businessId, referenceType, referenceId);
    if (amountCents === 0) return null;
    return this.recordPayment({
      businessId,
      contactId: reference.contactId,
      referenceType,
      referenceId,
      kind: PaymentKind.Balance,
      amountCents,
      idempotencyKey,
    });
  }

  balance(businessId: string, referenceType: PaymentReferenceType, referenceId: string): number {
    const total = this.totalForReference(businessId, referenceType, referenceId);
    return remainingBalance(
      total,
      this.database.repositories.payments.list(businessId),
      referenceId,
      referenceType,
    );
  }

  private buildAssistantContext(
    businessId: string,
    conversationId: string,
    memoryConflicts: MemoryConflict[],
  ): AssistantContext {
    const repositories = this.database.repositories;
    const conversation = required(
      repositories.conversations.get(businessId, conversationId),
      'Conversation not found',
    );
    const lead = required(
      repositories.leads.find(
        businessId,
        (candidate) => candidate.conversationId === conversationId,
      )[0] ?? null,
      'Lead not found',
    );
    const messages = repositories.messages
      .find(businessId, (message) => message.conversationId === conversationId)
      .sort((first, second) => first.sentAt.localeCompare(second.sentAt));
    const latestCustomerMessage = [...messages]
      .reverse()
      .find((message) => message.author === MessageAuthor.Customer);
    if (!latestCustomerMessage) {
      throw new DomainError('No customer message is available to analyze', 'NO_CUSTOMER_MESSAGE');
    }
    const business = required(
      repositories.businesses.get(businessId, businessId),
      'Business not found',
    );
    const settings = required(
      repositories.businessSettings.list(businessId)[0] ?? null,
      'Business settings not found',
    );
    const knowledge = required(
      repositories.businessKnowledge.list(businessId)[0] ?? null,
      'Business knowledge not found',
    );
    const memory = this.memoryService.list(businessId, conversation.contactId);
    const appointments = repositories.appointments.find(
      businessId,
      (appointment) => appointment.leadId === lead.id,
    );
    const quotes = repositories.quotes.find(
      businessId,
      (quote) => quote.leadId === lead.id,
    );
    const jobs = repositories.jobs.find(businessId, (job) => job.leadId === lead.id);
    const payments = repositories.payments.find(
      businessId,
      (payment) => payment.contactId === conversation.contactId,
    );
    const inferredStage = this.stageService.infer({
      lead,
      conversation,
      knowledge,
      memory,
      appointments,
      quotes,
      jobs,
      payments,
      followUps: repositories.scheduledFollowUps.find(
        businessId,
        (followUp) => followUp.conversationId === conversationId,
      ),
    });
    return {
      business,
      settings,
      knowledge,
      services: repositories.services.list(businessId),
      teamMembers: repositories.teamMembers.list(businessId),
      contact: required(
        repositories.contacts.get(businessId, conversation.contactId),
        'Contact not found',
      ),
      lead,
      conversation,
      messages,
      latestCustomerMessage,
      memory,
      memoryConflicts,
      appointments,
      quotes,
      jobs,
      payments,
      inferredStage,
    };
  }

  private tryScheduleFollowUp(
    businessId: string,
    conversationId: string,
    stage: ConversationStage,
    dueAt: string,
  ): void {
    try {
      this.followUpService.scheduleForStage(businessId, conversationId, stage, dueAt);
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        !['FOLLOW_UP_BLOCKED', 'FOLLOW_UP_NOT_REQUIRED', 'MARKETING_BLOCKED', 'OPERATIONAL_BLOCKED'].includes(
          error.code,
        )
      ) {
        throw error;
      }
    }
  }

  private cancelFollowUpsForReference(
    businessId: string,
    referenceType: PaymentReferenceType,
    referenceId: string,
  ): void {
    const repositories = this.database.repositories;
    const leadId =
      referenceType === PaymentReferenceType.Appointment
        ? repositories.appointments.get(businessId, referenceId)?.leadId
        : referenceType === PaymentReferenceType.Job
          ? repositories.jobs.get(businessId, referenceId)?.leadId
          : repositories.quotes.get(businessId, referenceId)?.leadId;
    if (!leadId) return;
    const lead = repositories.leads.get(businessId, leadId);
    if (lead) this.followUpService.cancelPending(businessId, lead.conversationId);
  }

  private replaceNextAction(
    businessId: string,
    conversationId: string,
    type: NextActionType,
    reason: string,
    automatic: boolean,
    dueAt: string | null = this.now(),
  ): NextAction {
    const repositories = this.database.repositories;
    const conversation = required(repositories.conversations.get(businessId, conversationId), 'Conversation not found');
    const lead = required(
      repositories.leads.find(businessId, (candidate) => candidate.conversationId === conversationId)[0] ?? null,
      'Lead not found',
    );
    const current = repositories.nextActions.find(
      businessId,
      (action) => action.leadId === lead.id && action.status === NextActionStatus.Pending,
    )[0];
    if (
      current &&
      current.type === type &&
      current.reason === reason &&
      current.automatic === automatic &&
      current.dueAt === dueAt
    ) {
      return current;
    }
    repositories.nextActions
      .find(businessId, (action) => action.leadId === lead.id && action.status === NextActionStatus.Pending)
      .forEach((action) =>
        repositories.nextActions.save(businessId, {
          ...action,
          updatedAt: this.now(),
          status: NextActionStatus.Cancelled,
        }),
      );
    const action: NextAction = {
      ...this.entityBase(businessId),
      leadId: lead.id,
      conversationId,
      type,
      status: NextActionStatus.Pending,
      reason,
      dueAt,
      automatic,
    };
    repositories.nextActions.save(businessId, action);
    repositories.leads.save(businessId, { ...lead, updatedAt: this.now(), nextActionId: action.id });
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: this.now(),
      nextActionId: action.id,
    });
    assertNextActionInvariant(
      required(repositories.leads.get(businessId, lead.id), 'Lead not found'),
      repositories.nextActions.list(businessId),
    );
    this.activity(businessId, conversation.contactId, conversationId, ActivityType.NextActionChanged, reason);
    return action;
  }

  private closeIfSettled(
    businessId: string,
    leadId: string,
    referenceType: PaymentReferenceType,
    referenceId: string,
  ): boolean {
    if (this.balance(businessId, referenceType, referenceId) !== 0) return false;
    const repositories = this.database.repositories;
    const isCompleted =
      referenceType === PaymentReferenceType.Appointment
        ? repositories.appointments.get(businessId, referenceId)?.status === AppointmentStatus.Completed
        : referenceType === PaymentReferenceType.Job
          ? repositories.jobs.get(businessId, referenceId)?.status === JobStatus.Completed
          : false;
    if (!isCompleted) return false;
    const lead = required(repositories.leads.get(businessId, leadId), 'Lead not found');
    const conversation = required(
      repositories.conversations.get(businessId, lead.conversationId),
      'Conversation not found',
    );
    this.closeWon(businessId, lead, conversation);
    return true;
  }

  private recordRevenueEvent(input: Omit<RevenueEvent, keyof TenantEntity | 'occurredAt'> & { businessId: string }): RevenueEvent {
    const repositories = this.database.repositories;
    const existing = repositories.revenueEvents.find(
      input.businessId,
      (event) => event.causationId === input.causationId,
    )[0];
    if (existing) {
      if (
        existing.referenceId !== input.referenceId ||
        existing.stage !== input.stage ||
        existing.amountCents !== input.amountCents
      ) {
        throw new DomainError('Revenue causation was reused for a different event', 'IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    const event: RevenueEvent = {
      ...this.entityBase(input.businessId),
      contactId: input.contactId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      stage: input.stage,
      amountCents: input.amountCents,
      causationId: input.causationId,
      correlationId: input.correlationId,
      occurredAt: this.now(),
    };
    return repositories.revenueEvents.save(input.businessId, event);
  }

  private totalForReference(
    businessId: string,
    referenceType: PaymentReferenceType,
    referenceId: string,
  ): number {
    return this.referenceDetails(businessId, referenceType, referenceId).totalCents;
  }

  private referenceDetails(
    businessId: string,
    referenceType: PaymentReferenceType,
    referenceId: string,
  ): { contactId: string; totalCents: number; depositRequiredCents: number } {
    const repositories = this.database.repositories;
    if (referenceType === PaymentReferenceType.Appointment) {
      return required(repositories.appointments.get(businessId, referenceId), 'Appointment not found');
    }
    if (referenceType === PaymentReferenceType.Quote) {
      return required(repositories.quotes.get(businessId, referenceId), 'Quote not found');
    }
    return required(repositories.jobs.get(businessId, referenceId), 'Job not found');
  }

  private assertOpenLead(lead: Lead): void {
    if ([LeadStatus.Won, LeadStatus.Lost, LeadStatus.Archived].includes(lead.status)) {
      throw new DomainError('The commercial opportunity is closed', 'INVALID_LEAD_STATE');
    }
  }

  private validateJobSchedule(
    businessId: string,
    jobId: string,
    staffId: string,
    startAt: string,
    endAt: string,
  ): { normalizedStart: string; normalizedEnd: string } {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new DomainError('Job schedule is invalid', 'INVALID_DATE');
    }
    const normalizedStart = start.toISOString();
    const normalizedEnd = end.toISOString();
    const repositories = this.database.repositories;
    const jobConflict = repositories.jobs.find(
      businessId,
      (candidate) =>
        candidate.id !== jobId &&
        candidate.assignedStaffId === staffId &&
        [JobStatus.Scheduled, JobStatus.InProgress].includes(candidate.status) &&
        intervalsOverlap(
          normalizedStart,
          normalizedEnd,
          candidate.scheduledStartAt,
          candidate.scheduledEndAt,
        ),
    )[0];
    const appointmentConflict = repositories.appointments.find(
      businessId,
      (appointment) =>
        appointment.staffId === staffId &&
        appointment.status !== AppointmentStatus.Cancelled &&
        intervalsOverlap(
          normalizedStart,
          normalizedEnd,
          appointment.startAt,
          appointment.endAt,
        ),
    )[0];
    if (jobConflict || appointmentConflict) {
      throw new DomainError('The staff member already has work scheduled at that time', 'SCHEDULE_CONFLICT');
    }
    return { normalizedStart, normalizedEnd };
  }

  private assertNoJobConflict(
    businessId: string,
    staffId: string,
    startAt: string,
    endAt: string,
  ): void {
    const conflict = this.database.repositories.jobs.find(
      businessId,
      (job) =>
        job.assignedStaffId === staffId &&
        [JobStatus.Scheduled, JobStatus.InProgress].includes(job.status) &&
        intervalsOverlap(startAt, endAt, job.scheduledStartAt, job.scheduledEndAt),
    )[0];
    if (conflict) {
      throw new DomainError('The staff member already has work scheduled at that time', 'SCHEDULE_CONFLICT');
    }
  }

  private leadIdForReference(
    businessId: string,
    referenceType: PaymentReferenceType,
    referenceId: string,
  ): string {
    const repositories = this.database.repositories;
    if (referenceType === PaymentReferenceType.Appointment) {
      return required(repositories.appointments.get(businessId, referenceId), 'Appointment not found').leadId;
    }
    if (referenceType === PaymentReferenceType.Quote) {
      return required(repositories.quotes.get(businessId, referenceId), 'Quote not found').leadId;
    }
    return required(repositories.jobs.get(businessId, referenceId), 'Job not found').leadId;
  }

  private depositOutstanding(opportunity: CommercialOpportunityView): number | null {
    const repositories = this.database.repositories;
    const requiredCents = opportunity.jobId
      ? repositories.jobs.get(opportunity.businessId, opportunity.jobId)?.depositRequiredCents
      : opportunity.appointmentId
        ? repositories.appointments.get(opportunity.businessId, opportunity.appointmentId)?.depositRequiredCents
        : null;
    return requiredCents === null || requiredCents === undefined
      ? null
      : Math.max(0, requiredCents - opportunity.collectedCents);
  }

  private clearPendingActions(businessId: string, lead: Lead): void {
    const repositories = this.database.repositories;
    repositories.nextActions
      .find(
        businessId,
        (action) => action.leadId === lead.id && action.status === NextActionStatus.Pending,
      )
      .forEach((action) => repositories.nextActions.save(businessId, {
        ...action,
        updatedAt: this.now(),
        status: NextActionStatus.Completed,
      }));
    const conversation = repositories.conversations.get(businessId, lead.conversationId);
    repositories.leads.save(businessId, { ...lead, updatedAt: this.now(), nextActionId: null });
    if (conversation) {
      repositories.conversations.save(businessId, {
        ...conversation,
        updatedAt: this.now(),
        nextActionId: null,
      });
    }
  }

  private closeWon(businessId: string, lead: Lead, conversation: Conversation): void {
    if (lead.status === LeadStatus.Won) return;
    this.clearPendingActions(businessId, lead);
    this.followUpService.cancelPending(businessId, lead.conversationId);
    const repositories = this.database.repositories;
    repositories.leads.save(businessId, {
      ...required(repositories.leads.get(businessId, lead.id), 'Lead not found'),
      updatedAt: this.now(),
      status: LeadStatus.Won,
      lostReason: null,
      nextActionId: null,
      closedAt: this.now(),
    });
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: this.now(),
      state: ConversationState.Complete,
      inferredStage: ConversationStage.ClosedWon,
      mode: ConversationMode.Closed,
      automationEnabled: false,
      nextActionId: null,
    });
    this.activity(businessId, lead.contactId, lead.conversationId, ActivityType.OpportunityWon, 'Opportunity closed won.', {}, `${lead.id}:won`);
  }

  private appointmentCandidate(
    businessId: string,
    contactId: string,
    leadId: string,
    serviceId: string,
    staffId: string,
    startAt: string,
    durationMinutes: number,
    totalCents: number,
    depositRequiredCents: number,
    operationKey: string,
  ): Appointment {
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) throw new DomainError('Invalid appointment start time', 'INVALID_DATE');
    return {
      ...this.entityBase(businessId),
      contactId,
      leadId,
      serviceId,
      staffId,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
      status: AppointmentStatus.Tentative,
      totalCents,
      depositRequiredCents,
      confirmedAt: null,
      completedAt: null,
      operationKey,
    };
  }

  private setConversationState(
    businessId: string,
    conversationId: string,
    state: ConversationState,
  ): void {
    const repositories = this.database.repositories;
    const conversation = required(repositories.conversations.get(businessId, conversationId), 'Conversation not found');
    repositories.conversations.save(businessId, { ...conversation, updatedAt: this.now(), state });
  }

  private activity(
    businessId: string,
    contactId: string | null,
    conversationId: string | null,
    type: ActivityType,
    summary: string,
    metadata: Record<string, string | number | boolean | null> = {},
    operationKey?: string,
  ) {
    return this.timelineService.record({
      businessId,
      contactId,
      conversationId,
      type,
      summary,
      metadata,
      ...(operationKey ? { operationKey } : {}),
    });
  }

  private entityBase(businessId: string): TenantEntity {
    const at = this.now();
    return { id: this.id(), businessId, createdAt: at, updatedAt: at };
  }
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new DomainError(message, 'NOT_FOUND');
  return value;
}

function parseTime(value: string): [number, number] {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new DomainError(`Invalid time: ${value}`, 'INVALID_TIME');
  return [Number(match[1]), Number(match[2])];
}

function isOptOutMessage(body: string): boolean {
  return /\b(stop|unsubscribe|opt out|no marketing)\b/i.test(body);
}

function plainMissingInformation(keys: CustomerFactKey[]): string {
  const labels = keys.map((key) => key.toLowerCase().replaceAll('_', ' '));
  return `Ask for ${labels.join(', ')}.`;
}

function plainNextActionReason(decision: AssistantDecision): string {
  if (decision.suggestedNextAction === NextActionType.PrepareQuote) {
    return 'Prepare a quote using the collected details.';
  }
  if (decision.suggestedNextAction === NextActionType.OfferAppointment) {
    return 'Offer a validated appointment option.';
  }
  if (decision.suggestedNextAction === NextActionType.CollectBalance) {
    return 'Request the remaining payment.';
  }
  return 'Reply using verified business information.';
}

function nextActionForConversationStage(stage: ConversationStage): NextActionType {
  if (stage === ConversationStage.AwaitingBalance) return NextActionType.CollectBalance;
  if (stage === ConversationStage.AwaitingDeposit) return NextActionType.RequestDeposit;
  if (stage === ConversationStage.QuoteSent) return NextActionType.FollowUpQuote;
  if (stage === ConversationStage.ReadyForQuote) return NextActionType.PrepareQuote;
  if (stage === ConversationStage.ReadyToBook) return NextActionType.OfferAppointment;
  if (stage === ConversationStage.AwaitingConfirmation) return NextActionType.ConfirmAppointment;
  if (stage === ConversationStage.JobScheduled) return NextActionType.ReplyToCustomer;
  return NextActionType.ReplyToCustomer;
}

function resumedActionReason(action: NextActionType): string {
  if (action === NextActionType.CollectBalance) return 'Request the remaining payment.';
  if (action === NextActionType.RequestDeposit) return 'Request the validated deposit.';
  if (action === NextActionType.FollowUpQuote) return 'Follow up on the sent quote.';
  if (action === NextActionType.PrepareQuote) return 'Prepare the quote from the collected details.';
  if (action === NextActionType.OfferAppointment) return 'Offer a validated appointment option.';
  if (action === NextActionType.ConfirmAppointment) return 'Confirm the appointment.';
  return 'Assistant explicitly resumed; review the latest customer need.';
}

function addHours(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function intervalsOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string | null,
  secondEnd: string | null,
): boolean {
  if (!secondStart || !secondEnd) return false;
  return new Date(firstStart).getTime() < new Date(secondEnd).getTime()
    && new Date(secondStart).getTime() < new Date(firstEnd).getTime();
}

function conversationStateForStage(stage: ConversationStage): ConversationState {
  if (stage === ConversationStage.NewInquiry) return ConversationState.NewInquiry;
  if ([ConversationStage.Discovery, ConversationStage.Qualification, ConversationStage.InformationCollection, ConversationStage.HumanReview].includes(stage)) {
    return ConversationState.Qualifying;
  }
  if ([ConversationStage.ReadyToBook, ConversationStage.AppointmentProposed].includes(stage)) {
    return ConversationState.ReadyToBook;
  }
  if ([ConversationStage.AwaitingDeposit, ConversationStage.AwaitingConfirmation, ConversationStage.Booked].includes(stage)) {
    return ConversationState.AppointmentScheduled;
  }
  if ([ConversationStage.ReadyForQuote, ConversationStage.QuotePreparation].includes(stage)) {
    return ConversationState.QuoteInProgress;
  }
  if (stage === ConversationStage.QuoteSent) return ConversationState.QuoteSent;
  if (stage === ConversationStage.JobScheduled) return ConversationState.JobScheduled;
  if ([ConversationStage.ServiceComplete, ConversationStage.AwaitingBalance].includes(stage)) {
    return ConversationState.AwaitingPayment;
  }
  return ConversationState.Complete;
}
