import {
  AppointmentStatus,
  ConversationMode,
  ConversationStage,
  FollowUpStatus,
  JobStatus,
  LeadStatus,
  QuoteStatus,
  WorkflowType,
  type Appointment,
  type BusinessKnowledge,
  type Conversation,
  type CustomerFactKey,
  type CustomerMemoryItem,
  type Job,
  type Lead,
  type Payment,
  type Quote,
  type ScheduledFollowUp,
} from '../../domain/entities';
import { remainingBalance } from '../../domain/rules';

export interface StageContext {
  lead: Lead;
  conversation: Conversation;
  knowledge: BusinessKnowledge;
  memory: CustomerMemoryItem[];
  appointments: Appointment[];
  quotes: Quote[];
  jobs: Job[];
  payments: Payment[];
  followUps?: ScheduledFollowUp[];
}

export class ConversationStageService {
  infer(context: StageContext): ConversationStage {
    const { lead, conversation } = context;
    if (
      conversation.mode === ConversationMode.HumanActive ||
      conversation.mode === ConversationMode.Paused
    ) {
      return ConversationStage.HumanReview;
    }
    if (lead.status === LeadStatus.Won) return ConversationStage.ClosedWon;
    if ([LeadStatus.Lost, LeadStatus.Archived].includes(lead.status)) {
      return ConversationStage.ClosedLost;
    }

    const appointment = newest(context.appointments);
    if (appointment) {
      const balance = remainingBalance(
        appointment.totalCents,
        context.payments,
        appointment.id,
      );
      if (appointment.status === AppointmentStatus.Completed) {
        return balance > 0 ? ConversationStage.AwaitingBalance : ConversationStage.ClosedWon;
      }
      const collected = appointment.totalCents - balance;
      if (collected < appointment.depositRequiredCents) return ConversationStage.AwaitingDeposit;
      if (appointment.status === AppointmentStatus.Confirmed) return ConversationStage.Booked;
      return ConversationStage.AwaitingConfirmation;
    }

    const job = newest(context.jobs);
    if (job) {
      const balance = remainingBalance(job.totalCents, context.payments, job.id);
      if (job.status === JobStatus.Completed) {
        return balance > 0 ? ConversationStage.AwaitingBalance : ConversationStage.ClosedWon;
      }
      if (job.status === JobStatus.PendingDeposit) return ConversationStage.AwaitingDeposit;
      if (job.status === JobStatus.Scheduled || job.status === JobStatus.InProgress) {
        return ConversationStage.JobScheduled;
      }
      return ConversationStage.Booked;
    }

    const quote = newest(context.quotes);
    if (quote) {
      if ([QuoteStatus.Sent, QuoteStatus.Viewed, QuoteStatus.ChangeRequested].includes(quote.status)) {
        return ConversationStage.QuoteSent;
      }
      if (quote.status === QuoteStatus.Draft) return ConversationStage.QuotePreparation;
    }

    const required = this.requiredFacts(context);
    const known = new Set(context.memory.map((fact) => fact.key));
    const hasAllRequired = required.length > 0 && required.every((key) => known.has(key));
    if (hasAllRequired) {
      return lead.workflowType === WorkflowType.AppointmentService
        ? ConversationStage.ReadyToBook
        : ConversationStage.ReadyForQuote;
    }
    if (context.memory.length > 0) return ConversationStage.InformationCollection;
    const pendingFollowUp = context.followUps?.some(
      (followUp) => followUp.status === FollowUpStatus.Scheduled,
    );
    if (pendingFollowUp) return ConversationStage.Discovery;
    return conversation.lastCustomerMessageAt
      ? ConversationStage.Discovery
      : ConversationStage.NewInquiry;
  }

  requiredFacts(context: Pick<StageContext, 'lead' | 'knowledge'>): CustomerFactKey[] {
    if (context.lead.serviceId) {
      return context.knowledge.serviceQualificationFields[context.lead.serviceId] ?? [];
    }
    const configured = Object.values(context.knowledge.serviceQualificationFields)[0];
    return configured ?? [];
  }
}

function newest<T extends { updatedAt: string }>(items: T[]): T | null {
  return [...items].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))[0] ?? null;
}
