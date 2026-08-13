import {
  AppointmentStatus,
  ConversationMode,
  JobStatus,
  LeadStatus,
  MessageAuthor,
  NextActionStatus,
  NextActionType,
  PaymentKind,
  PaymentReferenceType,
  PaymentStatus,
  type ActivityType,
  type CustomerFactKey,
  type QuoteStatus,
} from '../../domain/entities';
import type { DatabasePort } from '../../repositories/contracts';
import type { ActionCenterItem, CommercialOpportunityView } from '../../types/commercial';
import type { CommercialJourneyService } from '../commercial/CommercialJourneyService';
import { productServiceName } from './productCopy';

export interface ProductActionView extends ActionCenterItem {
  missingInformation: string[];
  isHumanReview: boolean;
}

export interface ProductCommitmentView {
  id: string;
  contactId: string;
  customerName: string;
  serviceName: string;
  startsAt: string;
  kind: 'APPOINTMENT' | 'JOB';
}

export interface ProductTodayView {
  attention: ProductActionView[];
  payments: ProductActionView[];
  commitments: ProductCommitmentView[];
}

export interface ProductMessageView {
  id: string;
  body: string;
  sentAt: string;
  side: 'CUSTOMER' | 'BUSINESS' | 'SYSTEM';
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
}

export class ProductReadService {
  constructor(
    private readonly database: DatabasePort,
    private readonly commercialJourney: CommercialJourneyService,
    private readonly now: () => string,
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
    const business = repositories.businesses.get(businessId, businessId);
    const services = repositories.services.list(businessId);
    const actions = this.actionCenter(businessId).map((action) => {
      const conversation = repositories.conversations.get(businessId, action.conversationId);
      return {
        ...action,
        missingInformation: conversation?.missingInformation ?? [],
        isHumanReview: action.actionType === NextActionType.HumanReview,
      };
    });
    const timeZone = business?.timeZone ?? 'Asia/Jerusalem';
    const todayKey = calendarKey(this.now(), timeZone);
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
          return {
            id: job.id,
            contactId: job.contactId,
            customerName: contacts.find((contact) => contact.id === job.contactId)?.displayName ?? 'לקוח/ה',
            serviceName: service
              ? business
                ? productServiceName(business.kind, service.id, service.name)
                : service.name
              : quote?.items[0]?.description ?? 'עבודה',
            startsAt: job.scheduledStartAt ?? this.now(),
            kind: 'JOB' as const,
          };
        }),
    ].sort((first, second) => first.startsAt.localeCompare(second.startsAt));

    return {
      attention: actions.filter(
        (action) =>
          action.actionType !== NextActionType.CollectBalance &&
          action.actionType !== NextActionType.ServiceScheduled,
      ),
      payments: actions.filter((action) => action.actionType === NextActionType.CollectBalance),
      commitments,
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
              }
            : null,
          lastMessage: messages.at(-1) ?? null,
          messages,
          suggestedReply: latestDecision?.decision.suggestedReply ?? null,
          missingInformation: conversation.missingInformation,
          updatedAt: conversation.lastCustomerMessageAt ?? conversation.updatedAt,
        };
      })
      .filter((conversation): conversation is ProductInboxConversationView => conversation !== null)
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
    return { conversations };
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
