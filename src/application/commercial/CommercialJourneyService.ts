import {
  AppointmentStatus,
  ConversationMode,
  ConversationStage,
  JobStatus,
  LeadStatus,
  NextActionType,
  PaymentReferenceType,
  QuoteStatus,
  WorkflowType,
  type Lead,
} from '../../domain/entities';
import { collectedForReference, remainingBalance } from '../../domain/rules';
import type { DatabasePort } from '../../repositories/contracts';
import type {
  CommercialOpportunityView,
  JourneyActionRecommendation,
  JourneyReconciliation,
} from '../../types/commercial';

export class CommercialJourneyService {
  constructor(private readonly database: DatabasePort) {}

  evaluate(businessId: string, leadId: string): JourneyReconciliation {
    const repositories = this.database.repositories;
    const lead = required(repositories.leads.get(businessId, leadId), 'Lead not found');
    const conversation = required(
      repositories.conversations.get(businessId, lead.conversationId),
      'Conversation not found',
    );
    const appointment = newest(
      repositories.appointments.find(
        businessId,
        (candidate) =>
          candidate.leadId === lead.id && candidate.status !== AppointmentStatus.Cancelled,
      ),
    );
    const quote = newest(
      repositories.quotes.find(businessId, (candidate) => candidate.leadId === lead.id),
    );
    const job = newest(
      repositories.jobs.find(
        businessId,
        (candidate) => candidate.leadId === lead.id && candidate.status !== JobStatus.Cancelled,
      ),
    );
    const payments = repositories.payments.list(businessId);
    const reference = job
      ? { type: PaymentReferenceType.Job, id: job.id, totalCents: job.totalCents }
      : appointment
        ? { type: PaymentReferenceType.Appointment, id: appointment.id, totalCents: appointment.totalCents }
        : null;
    const collectedCents = reference
      ? collectedForReference(payments, reference.id, reference.type)
      : 0;
    const remainingBalanceCents = reference
      ? remainingBalance(reference.totalCents, payments, reference.id, reference.type)
      : null;
    const completed =
      appointment?.status === AppointmentStatus.Completed || job?.status === JobStatus.Completed;
    const shouldCloseWon = completed && remainingBalanceCents === 0;
    const stage = this.stage({
      lead,
      conversationMode: conversation.mode,
      appointmentStatus: appointment?.status ?? null,
      appointmentDepositRequired: appointment?.depositRequiredCents ?? 0,
      quoteStatus: quote?.status ?? null,
      jobStatus: job?.status ?? null,
      jobDepositRequired: job?.depositRequiredCents ?? 0,
      collectedCents,
      remainingBalanceCents,
      completed,
      fallbackStage: conversation.inferredStage,
    });
    const opportunity: CommercialOpportunityView = {
      businessId,
      leadId: lead.id,
      contactId: lead.contactId,
      conversationId: lead.conversationId,
      serviceId: lead.serviceId,
      workflowType: lead.workflowType,
      leadStatus: shouldCloseWon ? LeadStatus.Won : lead.status,
      lostReason: lead.lostReason,
      stage,
      appointmentId: appointment?.id ?? null,
      quoteId: quote?.id ?? null,
      jobId: job?.id ?? null,
      totalCents: reference?.totalCents ?? quote?.totalCents ?? null,
      collectedCents,
      remainingBalanceCents,
      nextActionId: lead.nextActionId,
    };
    return {
      opportunity,
      action: this.action(opportunity, {
        appointmentStatus: appointment?.status ?? null,
        appointmentDepositRequired: appointment?.depositRequiredCents ?? 0,
        appointmentStartAt: appointment?.startAt ?? null,
        quoteStatus: quote?.status ?? null,
        quoteUpdatedAt: quote?.updatedAt ?? null,
        jobStatus: job?.status ?? null,
        jobDepositRequired: job?.depositRequiredCents ?? 0,
        conversationMode: conversation.mode,
      }),
      shouldCloseWon,
      shouldRemainClosedLost: lead.status === LeadStatus.Lost,
    };
  }

  private stage(input: {
    lead: Lead;
    conversationMode: ConversationMode;
    appointmentStatus: AppointmentStatus | null;
    appointmentDepositRequired: number;
    quoteStatus: QuoteStatus | null;
    jobStatus: JobStatus | null;
    jobDepositRequired: number;
    collectedCents: number;
    remainingBalanceCents: number | null;
    completed: boolean;
    fallbackStage: ConversationStage;
  }): ConversationStage {
    if ([ConversationMode.HumanActive, ConversationMode.Paused].includes(input.conversationMode)) {
      return ConversationStage.HumanReview;
    }
    if (input.lead.status === LeadStatus.Lost) return ConversationStage.ClosedLost;
    if (input.completed) {
      return input.remainingBalanceCents === 0
        ? ConversationStage.ClosedWon
        : ConversationStage.AwaitingBalance;
    }
    if (input.jobStatus) {
      if (
        input.jobStatus === JobStatus.PendingDeposit ||
        input.collectedCents < input.jobDepositRequired
      ) return ConversationStage.AwaitingDeposit;
      if ([JobStatus.Scheduled, JobStatus.InProgress].includes(input.jobStatus)) {
        return ConversationStage.JobScheduled;
      }
      return ConversationStage.Booked;
    }
    if (input.appointmentStatus) {
      if (input.collectedCents < input.appointmentDepositRequired) {
        return ConversationStage.AwaitingDeposit;
      }
      return input.appointmentStatus === AppointmentStatus.Confirmed
        ? ConversationStage.Booked
        : ConversationStage.AwaitingConfirmation;
    }
    if (input.quoteStatus === QuoteStatus.Draft) return ConversationStage.QuotePreparation;
    if ([QuoteStatus.Sent, QuoteStatus.Viewed, QuoteStatus.ChangeRequested].includes(input.quoteStatus as QuoteStatus)) {
      return ConversationStage.QuoteSent;
    }
    if (input.lead.status === LeadStatus.Won) return ConversationStage.ClosedWon;
    return input.fallbackStage;
  }

  private action(
    opportunity: CommercialOpportunityView,
    state: {
      appointmentStatus: AppointmentStatus | null;
      appointmentDepositRequired: number;
      appointmentStartAt: string | null;
      quoteStatus: QuoteStatus | null;
      quoteUpdatedAt: string | null;
      jobStatus: JobStatus | null;
      jobDepositRequired: number;
      conversationMode: ConversationMode;
    },
  ): JourneyActionRecommendation | null {
    if (opportunity.leadStatus === LeadStatus.Lost || opportunity.stage === ConversationStage.ClosedWon) {
      return null;
    }
    if ([ConversationMode.HumanActive, ConversationMode.Paused].includes(state.conversationMode)) {
      return recommendation(NextActionType.HumanReview, 'Review the customer conversation.', null);
    }
    if (opportunity.stage === ConversationStage.AwaitingBalance) {
      return recommendation(
        NextActionType.CollectBalance,
        'Request the remaining balance.',
        null,
      );
    }
    if (state.jobStatus) {
      if (opportunity.collectedCents < state.jobDepositRequired) {
        return recommendation(NextActionType.RequestDeposit, 'Request the required job deposit.', null);
      }
      if ([JobStatus.ReadyToSchedule, JobStatus.PendingDeposit].includes(state.jobStatus)) {
        return recommendation(NextActionType.ScheduleJob, 'Schedule the accepted job.', null);
      }
      if ([JobStatus.Scheduled, JobStatus.InProgress].includes(state.jobStatus)) {
        return recommendation(NextActionType.ServiceScheduled, 'The job is scheduled.', null);
      }
    }
    if (state.appointmentStatus) {
      if (opportunity.collectedCents < state.appointmentDepositRequired) {
        return recommendation(NextActionType.RequestDeposit, 'Request the required appointment deposit.', null);
      }
      if (state.appointmentStatus === AppointmentStatus.Tentative) {
        return recommendation(NextActionType.ConfirmAppointment, 'Confirm the appointment.', null);
      }
      if (state.appointmentStatus === AppointmentStatus.Confirmed) {
        return recommendation(
          NextActionType.ServiceScheduled,
          'The appointment is scheduled.',
          state.appointmentStartAt,
        );
      }
    }
    if (state.quoteStatus === QuoteStatus.Draft) {
      return recommendation(NextActionType.SendQuote, 'Review and send the quote.', null);
    }
    if ([QuoteStatus.Sent, QuoteStatus.Viewed, QuoteStatus.ChangeRequested].includes(state.quoteStatus as QuoteStatus)) {
      return recommendation(
        NextActionType.FollowUpQuote,
        'Follow up on the quote if the customer has not replied.',
        state.quoteUpdatedAt,
        true,
      );
    }
    if (opportunity.stage === ConversationStage.ReadyToBook) {
      return recommendation(NextActionType.OfferAppointment, 'Offer validated appointment times.', null);
    }
    if (opportunity.stage === ConversationStage.ReadyForQuote) {
      return recommendation(NextActionType.PrepareQuote, 'Prepare a quote from the collected details.', null);
    }
    if (opportunity.stage === ConversationStage.InformationCollection) {
      return recommendation(NextActionType.CollectInformation, 'Collect the missing customer details.', null);
    }
    if ([ConversationStage.NewInquiry, ConversationStage.Discovery].includes(opportunity.stage)) {
      return recommendation(NextActionType.ReplyToCustomer, 'Reply to the customer.', null);
    }
    if (opportunity.workflowType === WorkflowType.AppointmentService) {
      return recommendation(NextActionType.OfferAppointment, 'Offer validated appointment times.', null);
    }
    return recommendation(NextActionType.PrepareQuote, 'Prepare a quote from the collected details.', null);
  }
}

function recommendation(
  type: NextActionType,
  reason: string,
  dueAt: string | null,
  automatic = false,
): JourneyActionRecommendation {
  return { type, reason, dueAt, automatic };
}

function newest<T extends { updatedAt: string }>(items: T[]): T | null {
  return items.reduce<T | null>(
    (latest, candidate) =>
      latest === null || candidate.updatedAt >= latest.updatedAt ? candidate : latest,
    null,
  );
}

function required<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}
