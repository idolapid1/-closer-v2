import {
  AppointmentStatus,
  ConversationStage,
  ConversationMode,
  JobStatus,
  LeadStatus,
  MessageAuthor,
  NextActionStatus,
  NextActionType,
  PaymentKind,
  PaymentReferenceType,
  PaymentStatus,
  type WorkflowType,
  type ActivityType,
  type CustomerFactKey,
  type HandoffReason,
  type QuoteStatus,
} from '../../domain/entities';
import type { DatabasePort } from '../../repositories/contracts';
import type { ActionCenterItem, CommercialOpportunityView } from '../../types/commercial';
import type { CommercialJourneyService } from '../commercial/CommercialJourneyService';
import type { RevenueAttributionService } from '../revenue/RevenueAttributionService';
import { productServiceName } from './productCopy';

export interface ProductActionView extends ActionCenterItem {
  missingInformation: string[];
  isHumanReview: boolean;
  automatic: boolean;
  serviceName: string | null;
}

export interface ProductCommitmentView {
  id: string;
  contactId: string;
  customerName: string;
  serviceName: string;
  startsAt: string;
  kind: 'APPOINTMENT' | 'JOB';
  depositPaid: boolean;
}

export interface ProductAutomationProofView {
  preparedActions: number;
  informationCollected: number;
  progressedCustomers: number;
}

export interface ProductRevenueOverviewView {
  validatedCollectedCents: number;
  collectionDueCents: number;
  openPipelineCents: number;
  bookedOpportunityCount: number;
  wonOpportunityCount: number;
  attribution: {
    status: 'AVAILABLE' | 'NOT_AVAILABLE';
    generatedByCloserCents: number | null;
    recoveredByCloserCents: number | null;
  };
}

export interface ProductTodayView {
  asOf: string;
  attention: ProductActionView[];
  payments: ProductActionView[];
  commitments: ProductCommitmentView[];
  activeOpportunityCount: number;
  automation: ProductAutomationProofView;
  revenue: ProductRevenueOverviewView;
}

export interface ProductMessageView {
  id: string;
  body: string;
  sentAt: string;
  side: 'CUSTOMER' | 'BUSINESS' | 'SYSTEM';
}

export interface ProductHandoffView {
  reason: HandoffReason;
  detail: string;
  startedAt: string;
}

export interface ProductInboxConversationView {
  id: string;
  contactId: string;
  customerName: string;
  phone: string;
  serviceName: string | null;
  stage: CommercialOpportunityView['stage'];
  automationStopped: boolean;
  isHumanActive: boolean;
  isClosed: boolean;
  action: ProductActionView | null;
  lastMessage: ProductMessageView | null;
  messages: ProductMessageView[];
  suggestedReply: string | null;
  handoff: ProductHandoffView | null;
  missingInformation: string[];
  updatedAt: string;
}

export interface ProductInboxView {
  conversations: ProductInboxConversationView[];
}

export interface ProductWorkView {
  kind: 'APPOINTMENT' | 'QUOTE_JOB' | 'NONE';
  appointmentStatus: AppointmentStatus | null;
  appointmentStartAt: string | null;
  quoteStatus: QuoteStatus | null;
  quoteTotalCents: number | null;
  jobStatus: JobStatus | null;
  jobStartAt: string | null;
}

export interface ProductCustomerView {
  contactId: string;
  customerName: string;
  phone: string;
  email: string | null;
  serviceName: string | null;
  stage: CommercialOpportunityView['stage'];
  leadStatus: LeadStatus;
  workflowType: WorkflowType;
  lostReason: CommercialOpportunityView['lostReason'];
  conversationId: string;
  automationStopped: boolean;
  isHumanActive: boolean;
  isClosed: boolean;
  marketingAllowed: boolean;
  operationalAllowed: boolean;
  action: ProductActionView | null;
  totalCents: number | null;
  collectedCents: number;
  remainingBalanceCents: number | null;
  paymentCount: number;
  refundCents: number;
  work: ProductWorkView;
  messages: ProductMessageView[];
  facts: Array<{ id: string; key: CustomerFactKey; value: string | number | boolean }>;
  activity: Array<{ id: string; type: ActivityType; occurredAt: string }>;
  suggestedReply: string | null;
  handoff: ProductHandoffView | null;
}

export type ProductCustomerGroup =
  | 'NEEDS_OWNER'
  | 'READY'
  | 'WAITING'
  | 'IN_PROGRESS'
  | 'PAYMENT'
  | 'CLOSED';

export interface ProductCustomerSummaryView {
  contactId: string;
  customerName: string;
  serviceName: string | null;
  stage: CommercialOpportunityView['stage'];
  leadStatus: LeadStatus;
  workflowType: WorkflowType;
  group: ProductCustomerGroup;
  action: ProductActionView | null;
  automationStopped: boolean;
  isHumanActive: boolean;
  totalCents: number | null;
  collectedCents: number;
  remainingBalanceCents: number | null;
  updatedAt: string;
}

export interface ProductCustomersView {
  customers: ProductCustomerSummaryView[];
}

export interface ProductScheduleItemView {
  id: string;
  kind: 'APPOINTMENT' | 'JOB';
  contactId: string;
  customerName: string;
  serviceName: string;
  startsAt: string | null;
  appointmentStatus: AppointmentStatus | null;
  jobStatus: JobStatus | null;
  totalCents: number;
  collectedCents: number;
  remainingBalanceCents: number;
  depositRequiredCents: number;
}

export interface ProductScheduleView {
  asOf: string;
  items: ProductScheduleItemView[];
}

export interface ProductMoneyItemView {
  leadId: string;
  contactId: string;
  customerName: string;
  serviceName: string | null;
  stage: CommercialOpportunityView['stage'];
  leadStatus: LeadStatus;
  totalCents: number;
  collectedCents: number;
  remainingBalanceCents: number;
  collectionDueCents: number;
  refundCents: number;
  updatedAt: string;
}

export interface ProductMoneyView {
  waitingTotalCents: number;
  collectedTotalCents: number;
  items: ProductMoneyItemView[];
}

export class ProductReadService {
  constructor(
    private readonly database: DatabasePort,
    private readonly commercialJourney: CommercialJourneyService,
    private readonly now: () => string,
    private readonly revenueAttribution?: RevenueAttributionService,
  ) {}

  actionCenter(businessId: string): ActionCenterItem[] {
    const repositories = this.database.repositories;
    return repositories.leads
      .list(businessId)
      .filter((lead) => ![LeadStatus.Won, LeadStatus.Lost, LeadStatus.Archived].includes(lead.status))
      .map((lead) => {
        const action = lead.nextActionId
          ? repositories.nextActions.get(businessId, lead.nextActionId)
          : null;
        const contact = repositories.contacts.get(businessId, lead.contactId);
        if (!action || action.status !== NextActionStatus.Pending) return null;
        if (!contact) {
          throw new Error(`Active lead ${lead.id} references a missing contact`);
        }
        const opportunity = this.commercialJourney.evaluate(businessId, lead.id).opportunity;
        return {
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
        } satisfies ActionCenterItem;
      })
      .filter((item): item is ActionCenterItem => item !== null)
      .sort((first, second) =>
        (first.dueAt ?? first.createdAt).localeCompare(second.dueAt ?? second.createdAt),
      );
  }

  today(businessId: string): ProductTodayView {
    const repositories = this.database.repositories;
    const asOf = this.now();
    const business = repositories.businesses.get(businessId, businessId);
    const services = repositories.services.list(businessId);
    const activeLeads = repositories.leads.list(businessId).filter((lead) => isOpenLead(lead.status));
    const activeContactIds = new Set(activeLeads.map((lead) => lead.contactId));
    const actions = this.actionCenter(businessId).map((action) => {
      const conversation = repositories.conversations.get(businessId, action.conversationId);
      const lead = repositories.leads.get(businessId, action.leadId);
      const nextAction = repositories.nextActions.get(businessId, action.id);
      const service = lead?.serviceId ? repositories.services.get(businessId, lead.serviceId) : null;
      return {
        ...action,
        missingInformation: conversation?.missingInformation ?? [],
        isHumanReview: action.actionType === NextActionType.HumanReview,
        automatic: nextAction?.automatic ?? false,
        serviceName: service
          ? business
            ? productServiceName(business.kind, service.id, service.name)
            : service.name
          : null,
      };
    });
    const timeZone = business?.timeZone ?? 'Asia/Jerusalem';
    const todayKey = calendarKey(asOf, timeZone);
    const contacts = repositories.contacts.list(businessId);
    const commitments: ProductCommitmentView[] = [
      ...repositories.appointments
        .list(businessId)
        .filter(
          (appointment) =>
            [AppointmentStatus.Tentative, AppointmentStatus.Confirmed].includes(appointment.status) &&
            calendarKey(appointment.startAt, timeZone) === todayKey,
        )
        .map((appointment) => {
          const service = services.find((candidate) => candidate.id === appointment.serviceId);
          const opportunity = this.commercialJourney.evaluate(businessId, appointment.leadId).opportunity;
          return {
            id: appointment.id,
            contactId: appointment.contactId,
            customerName: contacts.find((contact) => contact.id === appointment.contactId)?.displayName ?? 'לקוח/ה',
            serviceName: service
              ? business
                ? productServiceName(business.kind, service.id, service.name)
                : service.name
              : 'פגישה',
            startsAt: appointment.startAt,
            kind: 'APPOINTMENT' as const,
            depositPaid:
              appointment.depositRequiredCents > 0 &&
              opportunity.collectedCents >= appointment.depositRequiredCents,
          };
        }),
      ...repositories.jobs
        .list(businessId)
        .filter(
          (job) =>
            [JobStatus.Scheduled, JobStatus.InProgress].includes(job.status) &&
            job.scheduledStartAt !== null &&
            calendarKey(job.scheduledStartAt, timeZone) === todayKey,
        )
        .map((job) => {
          const quote = repositories.quotes.get(businessId, job.quoteId);
          const lead = quote ? repositories.leads.get(businessId, quote.leadId) : null;
          const service = lead?.serviceId
            ? repositories.services.get(businessId, lead.serviceId)
            : null;
          const opportunity = this.commercialJourney.evaluate(businessId, job.leadId).opportunity;
          return {
            id: job.id,
            contactId: job.contactId,
            customerName: contacts.find((contact) => contact.id === job.contactId)?.displayName ?? 'לקוח/ה',
            serviceName: service
              ? business
                ? productServiceName(business.kind, service.id, service.name)
                : service.name
              : quote?.items[0]?.description ?? 'עבודה',
            startsAt: job.scheduledStartAt ?? asOf,
            kind: 'JOB' as const,
            depositPaid:
              job.depositRequiredCents > 0 && opportunity.collectedCents >= job.depositRequiredCents,
          };
        }),
    ].sort((first, second) => first.startsAt.localeCompare(second.startsAt));

    const preparedActions = activeLeads.filter((lead) => {
      const action = lead.nextActionId
        ? repositories.nextActions.get(businessId, lead.nextActionId)
        : null;
      return action?.automatic === true;
    }).length;
    const informationCollected = new Set(
      repositories.customerMemory
        .list(businessId)
        .filter((fact) => activeContactIds.has(fact.contactId))
        .map((fact) => fact.contactId),
    ).size;
    const progressedCustomers = activeLeads.filter((lead) => {
      const stage = this.commercialJourney.evaluate(businessId, lead.id).opportunity.stage;
      return ![
        ConversationStage.NewInquiry,
        ConversationStage.Discovery,
        ConversationStage.Qualification,
        ConversationStage.InformationCollection,
        ConversationStage.HumanReview,
      ].includes(stage);
    }).length;
    const revenue = this.revenueOverview(businessId);

    return {
      asOf,
      attention: actions
        .filter(
          (action) =>
            action.actionType !== NextActionType.CollectBalance &&
            action.actionType !== NextActionType.ServiceScheduled,
        )
        .sort(
          (first, second) =>
            Number(second.isHumanReview) - Number(first.isHumanReview) ||
            (first.dueAt ?? first.createdAt).localeCompare(second.dueAt ?? second.createdAt),
        ),
      payments: actions.filter((action) => action.actionType === NextActionType.CollectBalance),
      commitments,
      activeOpportunityCount: activeLeads.length,
      automation: {
        preparedActions,
        informationCollected,
        progressedCustomers,
      },
      revenue,
    };
  }

  revenueOverview(businessId: string): ProductRevenueOverviewView {
    const repositories = this.database.repositories;
    const leads = repositories.leads.list(businessId);
    const openLeadIds = new Set(
      leads.filter((lead) => isOpenLead(lead.status)).map((lead) => lead.id),
    );
    const opportunities = leads.map(
      (lead) => this.commercialJourney.evaluate(businessId, lead.id).opportunity,
    );
    const payments = repositories.payments
      .list(businessId)
      .filter((payment) => payment.status === PaymentStatus.Collected);
    const validatedCollectedCents = Math.max(
      0,
      payments.reduce(
        (total, payment) =>
          total + (payment.kind === PaymentKind.Refund ? -payment.amountCents : payment.amountCents),
        0,
      ),
    );
    const openOpportunities = opportunities.filter((opportunity) =>
      openLeadIds.has(opportunity.leadId),
    );
    const attribution = this.revenueAttribution?.summarize(businessId);

    return {
      validatedCollectedCents,
      collectionDueCents: openOpportunities.reduce(
        (total, opportunity) => total + this.collectionDue(opportunity),
        0,
      ),
      openPipelineCents: openOpportunities.reduce(
        (total, opportunity) => total + (opportunity.totalCents ?? 0),
        0,
      ),
      bookedOpportunityCount: openOpportunities.filter((opportunity) =>
        [
          ConversationStage.AwaitingDeposit,
          ConversationStage.Booked,
          ConversationStage.JobScheduled,
        ].includes(opportunity.stage),
      ).length,
      wonOpportunityCount: leads.filter((lead) => lead.status === LeadStatus.Won).length,
      attribution: {
        status: attribution?.status ?? 'NOT_AVAILABLE',
        generatedByCloserCents:
          attribution?.status === 'AVAILABLE' ? attribution.generatedCents : null,
        recoveredByCloserCents:
          attribution?.status === 'AVAILABLE' ? attribution.recoveredCents : null,
      },
    };
  }

  inbox(businessId: string): ProductInboxView {
    const repositories = this.database.repositories;
    const business = repositories.businesses.get(businessId, businessId);
    const actionByConversation = new Map(
      this.actionCenter(businessId).map((action) => [action.conversationId, action]),
    );
    const conversations = repositories.conversations
      .list(businessId)
      .map((conversation): ProductInboxConversationView | null => {
        const contact = repositories.contacts.get(businessId, conversation.contactId);
        const lead = repositories.leads.find(
          businessId,
          (candidate) => candidate.conversationId === conversation.id,
        )[0];
        if (!contact || !lead) return null;
        const messages = this.messages(businessId, conversation.id);
        const action = actionByConversation.get(conversation.id);
        const opportunity = this.commercialJourney.evaluate(businessId, lead.id).opportunity;
        const service = lead.serviceId ? repositories.services.get(businessId, lead.serviceId) : null;
        const latestDecision = repositories.assistantDecisionRecords
          .find(businessId, (record) => record.conversationId === conversation.id)
          .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
          .at(-1);
        const handoff = conversation.handoffId
          ? repositories.humanHandoffs.get(businessId, conversation.handoffId)
          : null;
        return {
          id: conversation.id,
          contactId: contact.id,
          customerName: contact.displayName,
          phone: contact.phone,
          serviceName: service
            ? business
              ? productServiceName(business.kind, service.id, service.name)
              : service.name
            : null,
          stage: opportunity.stage,
          automationStopped: automationStopped(conversation.mode),
          isHumanActive: conversation.mode === ConversationMode.HumanActive,
          isClosed: conversation.mode === ConversationMode.Closed,
          action: action
            ? {
                ...action,
                missingInformation: conversation.missingInformation,
                isHumanReview: action.actionType === NextActionType.HumanReview,
                automatic:
                  repositories.nextActions.get(businessId, action.id)?.automatic ?? false,
                serviceName: service
                  ? business
                    ? productServiceName(business.kind, service.id, service.name)
                    : service.name
                  : null,
              }
            : null,
          lastMessage: messages.at(-1) ?? null,
          messages,
          suggestedReply: latestDecision?.decision.suggestedReply ?? null,
          handoff:
            handoff && handoff.resolvedAt === null
              ? {
                  reason: handoff.reason,
                  detail: handoff.detail,
                  startedAt: handoff.startedAt,
                }
              : null,
          missingInformation: conversation.missingInformation,
          updatedAt: conversation.lastCustomerMessageAt ?? conversation.updatedAt,
        };
      })
      .filter((conversation): conversation is ProductInboxConversationView => conversation !== null)
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
    return { conversations };
  }

  customers(businessId: string): ProductCustomersView {
    const repositories = this.database.repositories;
    const contactIds = new Set(repositories.leads.list(businessId).map((lead) => lead.contactId));
    const customers = [...contactIds]
      .map((contactId): ProductCustomerSummaryView | null => {
        const customer = this.customer(businessId, contactId);
        if (!customer) return null;
        const lead = repositories.leads
          .find(businessId, (candidate) => candidate.contactId === contactId)
          .sort((first, second) => {
            const firstActive = isOpenLead(first.status) ? 1 : 0;
            const secondActive = isOpenLead(second.status) ? 1 : 0;
            return secondActive - firstActive || second.updatedAt.localeCompare(first.updatedAt);
          })[0];
        if (!lead) return null;
        return {
          contactId,
          customerName: customer.customerName,
          serviceName: customer.serviceName,
          stage: customer.stage,
          leadStatus: customer.leadStatus,
          workflowType: customer.workflowType,
          group: customerGroup(customer),
          action: customer.action,
          automationStopped: customer.automationStopped,
          isHumanActive: customer.isHumanActive,
          totalCents: customer.totalCents,
          collectedCents: customer.collectedCents,
          remainingBalanceCents: customer.remainingBalanceCents,
          updatedAt: lead.updatedAt,
        };
      })
      .filter((customer): customer is ProductCustomerSummaryView => customer !== null)
      .sort(
        (first, second) =>
          customerGroupPriority(first.group) - customerGroupPriority(second.group) ||
          second.updatedAt.localeCompare(first.updatedAt),
      );
    return { customers };
  }

  schedule(businessId: string): ProductScheduleView {
    const repositories = this.database.repositories;
    const business = repositories.businesses.get(businessId, businessId);
    const contacts = new Map(repositories.contacts.list(businessId).map((contact) => [contact.id, contact]));
    const services = new Map(repositories.services.list(businessId).map((service) => [service.id, service]));
    const appointments: ProductScheduleItemView[] = repositories.appointments
      .list(businessId)
      .map((appointment) => {
        const opportunity = this.commercialJourney.evaluate(businessId, appointment.leadId).opportunity;
        const service = services.get(appointment.serviceId);
        return {
          id: appointment.id,
          kind: 'APPOINTMENT' as const,
          contactId: appointment.contactId,
          customerName: contacts.get(appointment.contactId)?.displayName ?? 'לקוח/ה',
          serviceName: service
            ? business
              ? productServiceName(business.kind, service.id, service.name)
              : service.name
            : 'תור',
          startsAt: appointment.startAt,
          appointmentStatus: appointment.status,
          jobStatus: null,
          totalCents: appointment.totalCents,
          collectedCents: opportunity.collectedCents,
          remainingBalanceCents: opportunity.remainingBalanceCents ?? 0,
          depositRequiredCents: appointment.depositRequiredCents,
        };
      });
    const jobs: ProductScheduleItemView[] = repositories.jobs.list(businessId).map((job) => {
      const opportunity = this.commercialJourney.evaluate(businessId, job.leadId).opportunity;
      const quote = repositories.quotes.get(businessId, job.quoteId);
      const lead = repositories.leads.get(businessId, job.leadId);
      const service = lead?.serviceId ? services.get(lead.serviceId) : null;
      return {
        id: job.id,
        kind: 'JOB' as const,
        contactId: job.contactId,
        customerName: contacts.get(job.contactId)?.displayName ?? 'לקוח/ה',
        serviceName: service
          ? business
            ? productServiceName(business.kind, service.id, service.name)
            : service.name
          : quote?.items[0]?.description ?? 'עבודה',
        startsAt: job.scheduledStartAt,
        appointmentStatus: null,
        jobStatus: job.status,
        totalCents: job.totalCents,
        collectedCents: opportunity.collectedCents,
        remainingBalanceCents: opportunity.remainingBalanceCents ?? 0,
        depositRequiredCents: job.depositRequiredCents,
      };
    });
    return {
      asOf: this.now(),
      items: [...appointments, ...jobs].sort((first, second) => {
        if (first.startsAt === null) return 1;
        if (second.startsAt === null) return -1;
        return first.startsAt.localeCompare(second.startsAt);
      }),
    };
  }

  money(businessId: string): ProductMoneyView {
    const repositories = this.database.repositories;
    const business = repositories.businesses.get(businessId, businessId);
    const contacts = new Map(repositories.contacts.list(businessId).map((contact) => [contact.id, contact]));
    const services = new Map(repositories.services.list(businessId).map((service) => [service.id, service]));
    const items = repositories.leads
      .list(businessId)
      .map((lead): ProductMoneyItemView | null => {
        const opportunity = this.commercialJourney.evaluate(businessId, lead.id).opportunity;
        if (opportunity.totalCents === null) return null;
        const service = lead.serviceId ? services.get(lead.serviceId) : null;
        const reference = opportunity.appointmentId
          ? { type: PaymentReferenceType.Appointment, id: opportunity.appointmentId }
          : opportunity.jobId
            ? { type: PaymentReferenceType.Job, id: opportunity.jobId }
            : null;
        const refundCents = reference
          ? repositories.payments
              .find(
                businessId,
                (payment) =>
                  payment.contactId === lead.contactId &&
                  payment.referenceType === reference.type &&
                  payment.referenceId === reference.id &&
                  payment.kind === PaymentKind.Refund &&
                  payment.status === PaymentStatus.Collected,
              )
              .reduce((total, payment) => total + payment.amountCents, 0)
          : 0;
        return {
          leadId: lead.id,
          contactId: lead.contactId,
          customerName: contacts.get(lead.contactId)?.displayName ?? 'לקוח/ה',
          serviceName: service
            ? business
              ? productServiceName(business.kind, service.id, service.name)
              : service.name
            : null,
          stage: opportunity.stage,
          leadStatus: lead.status,
          totalCents: opportunity.totalCents,
          collectedCents: opportunity.collectedCents,
          remainingBalanceCents: opportunity.remainingBalanceCents ?? 0,
          collectionDueCents: isOpenLead(lead.status) ? this.collectionDue(opportunity) : 0,
          refundCents,
          updatedAt: lead.updatedAt,
        };
      })
      .filter((item): item is ProductMoneyItemView => item !== null)
      .sort(
        (first, second) =>
          second.remainingBalanceCents - first.remainingBalanceCents ||
          second.updatedAt.localeCompare(first.updatedAt),
      );
    return {
      waitingTotalCents: items.reduce((total, item) => total + item.collectionDueCents, 0),
      collectedTotalCents: items.reduce((total, item) => total + item.collectedCents, 0),
      items,
    };
  }

  customer(businessId: string, contactId: string): ProductCustomerView | null {
    const repositories = this.database.repositories;
    const business = repositories.businesses.get(businessId, businessId);
    const contact = repositories.contacts.get(businessId, contactId);
    const leads = repositories.leads
      .find(businessId, (candidate) => candidate.contactId === contactId)
      .sort((first, second) => {
        const firstActive = isOpenLead(first.status) ? 1 : 0;
        const secondActive = isOpenLead(second.status) ? 1 : 0;
        return secondActive - firstActive || second.updatedAt.localeCompare(first.updatedAt);
      });
    const lead = leads[0];
    const conversation = lead
      ? repositories.conversations.get(businessId, lead.conversationId)
      : null;
    if (!contact || !conversation || !lead) return null;
    const opportunity = this.commercialJourney.evaluate(businessId, lead.id).opportunity;
    const action = this.actionCenter(businessId).find((candidate) => candidate.leadId === lead.id);
    const appointment = opportunity.appointmentId
      ? repositories.appointments.get(businessId, opportunity.appointmentId)
      : null;
    const quote = opportunity.quoteId ? repositories.quotes.get(businessId, opportunity.quoteId) : null;
    const job = opportunity.jobId ? repositories.jobs.get(businessId, opportunity.jobId) : null;
    const displayServiceId = lead.serviceId ?? appointment?.serviceId ?? null;
    const reference = opportunity.appointmentId
      ? { type: PaymentReferenceType.Appointment, id: opportunity.appointmentId }
      : opportunity.jobId
        ? { type: PaymentReferenceType.Job, id: opportunity.jobId }
        : null;
    const payments = reference
      ? repositories.payments.find(
          businessId,
          (payment) =>
            payment.contactId === contactId &&
            payment.referenceType === reference.type &&
            payment.referenceId === reference.id &&
            payment.status === PaymentStatus.Collected,
        )
      : [];
    const messages = this.messages(businessId, conversation.id);
    const latestDecision = repositories.assistantDecisionRecords
      .find(businessId, (record) => record.conversationId === conversation.id)
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
      .at(-1);
    const handoff = conversation.handoffId
      ? repositories.humanHandoffs.get(businessId, conversation.handoffId)
      : null;
    const consent = repositories.consentRecords.find(
      businessId,
      (record) => record.contactId === contactId,
    )[0];
    return {
      contactId,
      customerName: contact.displayName,
      phone: contact.phone,
      email: contact.email,
      serviceName: displayServiceId
        ? business
          ? productServiceName(
              business.kind,
              displayServiceId,
              repositories.services.get(businessId, displayServiceId)?.name,
            )
          : repositories.services.get(businessId, displayServiceId)?.name ?? null
        : null,
      stage: opportunity.stage,
      leadStatus: lead.status,
      workflowType: lead.workflowType,
      lostReason: lead.lostReason,
      conversationId: conversation.id,
      automationStopped: automationStopped(conversation.mode),
      isHumanActive: conversation.mode === ConversationMode.HumanActive,
      isClosed: conversation.mode === ConversationMode.Closed,
      marketingAllowed: consent ? consent.marketingAllowed && !consent.optedOut : false,
      operationalAllowed: consent?.operationalAllowed ?? false,
      action: action
        ? {
            ...action,
            missingInformation: conversation.missingInformation,
            isHumanReview: action.actionType === NextActionType.HumanReview,
            automatic: repositories.nextActions.get(businessId, action.id)?.automatic ?? false,
            serviceName: displayServiceId
              ? business
                ? productServiceName(
                    business.kind,
                    displayServiceId,
                    repositories.services.get(businessId, displayServiceId)?.name,
                  )
                : repositories.services.get(businessId, displayServiceId)?.name ?? null
              : null,
          }
        : null,
      totalCents: opportunity.totalCents,
      collectedCents: opportunity.collectedCents,
      remainingBalanceCents: opportunity.remainingBalanceCents,
      paymentCount: payments.filter((payment) => payment.kind !== PaymentKind.Refund).length,
      refundCents: payments
        .filter((payment) => payment.kind === PaymentKind.Refund)
        .reduce((total, payment) => total + payment.amountCents, 0),
      work: {
        kind: appointment ? 'APPOINTMENT' : quote || job ? 'QUOTE_JOB' : 'NONE',
        appointmentStatus: appointment?.status ?? null,
        appointmentStartAt: appointment?.startAt ?? null,
        quoteStatus: quote?.status ?? null,
        quoteTotalCents: quote?.totalCents ?? null,
        jobStatus: job?.status ?? null,
        jobStartAt: job?.scheduledStartAt ?? null,
      },
      messages,
      facts: repositories.customerMemory
        .find(businessId, (fact) => fact.contactId === contactId)
        .map((fact) => ({ id: fact.id, key: fact.key, value: fact.value })),
      activity: repositories.activities
        .find(businessId, (activity) => activity.contactId === contactId)
        .sort((first, second) => first.occurredAt.localeCompare(second.occurredAt))
        .map((activity) => ({ id: activity.id, type: activity.type, occurredAt: activity.occurredAt })),
      suggestedReply: latestDecision?.decision.suggestedReply ?? null,
      handoff:
        handoff && handoff.resolvedAt === null
          ? {
              reason: handoff.reason,
              detail: handoff.detail,
              startedAt: handoff.startedAt,
            }
          : null,
    };
  }

  private messages(businessId: string, conversationId: string): ProductMessageView[] {
    return this.database.repositories.messages
      .find(businessId, (message) => message.conversationId === conversationId)
      .sort((first, second) => first.sentAt.localeCompare(second.sentAt))
      .map((message) => ({
        id: message.id,
        body: message.body,
        sentAt: message.sentAt,
        side:
          message.author === MessageAuthor.Customer
            ? 'CUSTOMER'
            : message.author === MessageAuthor.Business || message.author === MessageAuthor.Assistant
              ? 'BUSINESS'
              : 'SYSTEM',
      }));
  }

  private depositOutstanding(opportunity: CommercialOpportunityView): number | null {
    const repositories = this.database.repositories;
    if (opportunity.appointmentId) {
      const appointment = repositories.appointments.get(opportunity.businessId, opportunity.appointmentId);
      return appointment ? Math.max(0, appointment.depositRequiredCents - opportunity.collectedCents) : null;
    }
    if (opportunity.jobId) {
      const job = repositories.jobs.get(opportunity.businessId, opportunity.jobId);
      return job ? Math.max(0, job.depositRequiredCents - opportunity.collectedCents) : null;
    }
    return null;
  }

  private collectionDue(opportunity: CommercialOpportunityView): number {
    if (opportunity.stage === ConversationStage.AwaitingBalance) {
      return opportunity.remainingBalanceCents ?? 0;
    }
    if (opportunity.stage === ConversationStage.AwaitingDeposit) {
      return this.depositOutstanding(opportunity) ?? 0;
    }
    return 0;
  }
}

function calendarKey(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(value));
}

function automationStopped(mode: ConversationMode): boolean {
  return [ConversationMode.HumanActive, ConversationMode.Paused].includes(mode);
}

function isOpenLead(status: LeadStatus): boolean {
  return [LeadStatus.New, LeadStatus.Active, LeadStatus.Qualified].includes(status);
}

function customerGroup(customer: ProductCustomerView): ProductCustomerGroup {
  if (customer.automationStopped || customer.action?.isHumanReview) return 'NEEDS_OWNER';
  if ((customer.remainingBalanceCents ?? 0) > 0 && customer.stage === ConversationStage.AwaitingBalance) {
    return 'PAYMENT';
  }
  if ([ConversationStage.ReadyToBook, ConversationStage.ReadyForQuote, ConversationStage.QuotePreparation].includes(customer.stage)) {
    return 'READY';
  }
  if ([ConversationStage.Booked, ConversationStage.JobScheduled, ConversationStage.ServiceComplete].includes(customer.stage)) {
    return 'IN_PROGRESS';
  }
  if ([LeadStatus.Won, LeadStatus.Lost, LeadStatus.Archived].includes(customer.leadStatus)) return 'CLOSED';
  return 'WAITING';
}

function customerGroupPriority(group: ProductCustomerGroup): number {
  return ['NEEDS_OWNER', 'READY', 'PAYMENT', 'IN_PROGRESS', 'WAITING', 'CLOSED'].indexOf(group);
}
