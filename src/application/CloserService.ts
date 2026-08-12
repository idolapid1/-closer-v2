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
  PaymentKind,
  PaymentReferenceType,
  PaymentStatus,
  QuoteStatus,
  RevenueStage,
  WorkflowType,
  type Activity,
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

export interface CreateAppointmentInput {
  businessId: string;
  contactId: string;
  leadId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  totalCents?: number;
}

export interface CreateQuoteInput {
  businessId: string;
  contactId: string;
  leadId: string;
  items: QuoteItem[];
  discountCents?: number;
  depositBasisPoints?: number;
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

  constructor(
    private readonly database: DatabasePort,
    private readonly aiProvider: AIProvider,
    private readonly messagingProvider: MessagingProvider,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {
    this.memoryService = new CustomerMemoryService(database, now, id);
    this.followUpService = new FollowUpService(database, now, id);
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
    return repositories.leads.save(businessId, {
      ...lead,
      updatedAt: this.now(),
      serviceId: service.id,
    });
  }

  rememberCustomerFact(
    businessId: string,
    contactId: string,
    key: CustomerFactKey,
    value: CustomerFactValue,
  ) {
    return this.memoryService.remember(
      businessId,
      contactId,
      key,
      value,
      MemorySource.Manual,
    );
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
    if (lead.contactId !== contact.id) throw new DomainError('Lead and contact do not match', 'CONTACT_MISMATCH');
    const service = required(repositories.services.get(input.businessId, input.serviceId), 'Service not found');
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
    );
    assertNoDoubleBooking(appointment, repositories.appointments.list(input.businessId));
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
    this.replaceNextAction(
      input.businessId,
      lead.conversationId,
      deposit > 0 ? NextActionType.RequestDeposit : NextActionType.ConfirmAppointment,
      deposit > 0 ? 'Collect the validated deposit.' : 'Confirm the appointment.',
      false,
    );
    this.tryScheduleFollowUp(
      input.businessId,
      lead.conversationId,
      deposit > 0
        ? ConversationStage.AwaitingDeposit
        : ConversationStage.AwaitingConfirmation,
      addHours(this.now(), deposit > 0 ? 48 : 24),
    );
    this.activity(input.businessId, input.contactId, lead.conversationId, ActivityType.AppointmentChanged, 'Appointment created.');
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
    return repositories.appointments.save(businessId, next);
  }

  cancelAppointment(businessId: string, appointmentId: string): Appointment {
    const repositories = this.database.repositories;
    const appointment = required(repositories.appointments.get(businessId, appointmentId), 'Appointment not found');
    if (appointment.status === AppointmentStatus.Completed) {
      throw new DomainError('Completed appointments cannot be cancelled', 'INVALID_APPOINTMENT_STATE');
    }
    return repositories.appointments.save(businessId, {
      ...appointment,
      updatedAt: this.now(),
      status: AppointmentStatus.Cancelled,
    });
  }

  confirmAppointment(businessId: string, appointmentId: string): Appointment {
    const repositories = this.database.repositories;
    const appointment = required(repositories.appointments.get(businessId, appointmentId), 'Appointment not found');
    const collected = appointment.totalCents - this.balance(
      businessId,
      PaymentReferenceType.Appointment,
      appointment.id,
    );
    if (collected < appointment.depositRequiredCents) {
      throw new DomainError('Required deposit has not been collected', 'DEPOSIT_REQUIRED');
    }
    return repositories.appointments.save(businessId, {
      ...appointment,
      updatedAt: this.now(),
      status: AppointmentStatus.Confirmed,
      confirmedAt: this.now(),
    });
  }

  completeAppointment(businessId: string, appointmentId: string): Appointment {
    const repositories = this.database.repositories;
    const appointment = required(repositories.appointments.get(businessId, appointmentId), 'Appointment not found');
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
    return completed;
  }

  createQuoteDraft(input: CreateQuoteInput): Quote {
    const repositories = this.database.repositories;
    const contact = required(repositories.contacts.get(input.businessId, input.contactId), 'Contact not found');
    const lead = required(repositories.leads.get(input.businessId, input.leadId), 'Lead not found');
    if (lead.contactId !== contact.id) throw new DomainError('Lead and contact do not match', 'CONTACT_MISMATCH');
    const settings = required(repositories.businessSettings.list(input.businessId)[0] ?? null, 'Settings not found');
    const totals = calculateQuoteTotals(
      input.items,
      input.discountCents ?? 0,
      settings.taxEnabled ? settings.taxRateBasisPoints : 0,
    );
    const depositBasisPoints = input.depositBasisPoints ?? settings.defaultDepositBasisPoints;
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
    };
    repositories.quotes.save(input.businessId, quote);
    this.setConversationState(input.businessId, lead.conversationId, ConversationState.QuoteInProgress);
    this.replaceNextAction(input.businessId, lead.conversationId, NextActionType.FollowUpQuote, 'Review and send the quote draft.', false);
    return quote;
  }

  sendQuote(businessId: string, quoteId: string): Quote {
    const repositories = this.database.repositories;
    const quote = required(repositories.quotes.get(businessId, quoteId), 'Quote not found');
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
    return sent;
  }

  acceptQuote(businessId: string, quoteId: string): Job {
    const repositories = this.database.repositories;
    const quote = required(repositories.quotes.get(businessId, quoteId), 'Quote not found');
    const existingJob = repositories.jobs.find(businessId, (job) => job.quoteId === quoteId)[0];
    if (existingJob) return existingJob;
    if (!canAcceptQuote(quote.status)) {
      throw new DomainError('Quote is not in an acceptable state', 'INVALID_QUOTE_STATE');
    }
    repositories.quotes.save(businessId, {
      ...quote,
      updatedAt: this.now(),
      status: QuoteStatus.Accepted,
      acceptedAt: this.now(),
    });
    const contact = required(repositories.contacts.get(businessId, quote.contactId), 'Contact not found');
    const job: Job = {
      ...this.entityBase(businessId),
      contactId: quote.contactId,
      leadId: quote.leadId,
      quoteId: quote.id,
      address: contact.address,
      scheduledStartAt: null,
      scheduledEndAt: null,
      assignedStaffId: null,
      status: quote.depositRequiredCents > 0 ? JobStatus.PendingDeposit : JobStatus.ReadyToSchedule,
      totalCents: quote.totalCents,
      depositRequiredCents: quote.depositRequiredCents,
      completedAt: null,
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
    const lead = required(repositories.leads.get(businessId, quote.leadId), 'Lead not found');
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
    if (this.balance(businessId, PaymentReferenceType.Job, job.id) > job.totalCents - job.depositRequiredCents) {
      throw new DomainError('Required deposit has not been collected', 'DEPOSIT_REQUIRED');
    }
    const scheduled = repositories.jobs.save(businessId, {
      ...job,
      updatedAt: this.now(),
      assignedStaffId: staffId,
      scheduledStartAt: new Date(startAt).toISOString(),
      scheduledEndAt: new Date(endAt).toISOString(),
      status: JobStatus.Scheduled,
    });
    const lead = required(repositories.leads.get(businessId, job.leadId), 'Lead not found');
    this.setConversationState(businessId, lead.conversationId, ConversationState.JobScheduled);
    return scheduled;
  }

  completeJob(businessId: string, jobId: string): Job {
    const repositories = this.database.repositories;
    const job = required(repositories.jobs.get(businessId, jobId), 'Job not found');
    if (job.status === JobStatus.Cancelled) throw new DomainError('Cancelled jobs cannot be completed', 'INVALID_JOB_STATE');
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
        existing.referenceId !== input.referenceId ||
        existing.amountCents !== input.amountCents ||
        existing.kind !== input.kind
      ) {
        throw new DomainError('Idempotency key was reused for a different payment', 'IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    const total = this.totalForReference(input.businessId, input.referenceType, input.referenceId);
    if (input.kind === PaymentKind.Refund) {
      const originalId = required(input.originalPaymentId ?? null, 'Refund requires original payment');
      const original = required(repositories.payments.get(input.businessId, originalId), 'Original payment not found');
      if (original.referenceId !== input.referenceId || original.kind === PaymentKind.Refund) {
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
    this.cancelFollowUpsForReference(
      input.businessId,
      input.referenceType,
      input.referenceId,
    );
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
    if (input.kind !== PaymentKind.Refund) {
      const leadId =
        input.referenceType === PaymentReferenceType.Appointment
          ? required(repositories.appointments.get(input.businessId, input.referenceId), 'Appointment not found').leadId
          : input.referenceType === PaymentReferenceType.Job
            ? required(repositories.jobs.get(input.businessId, input.referenceId), 'Job not found').leadId
            : required(repositories.quotes.get(input.businessId, input.referenceId), 'Quote not found').leadId;
      this.closeIfSettled(input.businessId, leadId, input.referenceType, input.referenceId);
    }
    this.activity(input.businessId, input.contactId, null, ActivityType.PaymentChanged, `${input.kind} recorded for ${total} total.`);
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
    return remainingBalance(total, this.database.repositories.payments.list(businessId), referenceId);
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
  ): NextAction {
    const repositories = this.database.repositories;
    const conversation = required(repositories.conversations.get(businessId, conversationId), 'Conversation not found');
    const lead = required(
      repositories.leads.find(businessId, (candidate) => candidate.conversationId === conversationId)[0] ?? null,
      'Lead not found',
    );
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
      dueAt: this.now(),
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
    repositories.nextActions
      .find(businessId, (action) => action.leadId === lead.id && action.status === NextActionStatus.Pending)
      .forEach((action) => repositories.nextActions.save(businessId, {
        ...action,
        updatedAt: this.now(),
        status: NextActionStatus.Completed,
      }));
    repositories.leads.save(businessId, {
      ...lead,
      updatedAt: this.now(),
      status: LeadStatus.Won,
      nextActionId: null,
      closedAt: this.now(),
    });
    repositories.conversations.save(businessId, {
      ...conversation,
      updatedAt: this.now(),
      state: ConversationState.Complete,
      mode: ConversationMode.Closed,
      automationEnabled: false,
      nextActionId: null,
    });
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
  ): Activity {
    const activity: Activity = {
      ...this.entityBase(businessId),
      contactId,
      conversationId,
      type,
      summary,
      metadata: {},
    };
    return this.database.repositories.activities.save(businessId, activity);
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
