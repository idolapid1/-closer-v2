import type {
  ConversationStage,
  LeadStatus,
  NextActionType,
  OpportunityLostReason,
  WorkflowType,
} from '../domain/entities';

export interface CommercialOpportunityView {
  businessId: string;
  leadId: string;
  contactId: string;
  conversationId: string;
  serviceId: string | null;
  workflowType: WorkflowType;
  leadStatus: LeadStatus;
  lostReason: OpportunityLostReason | null;
  stage: ConversationStage;
  appointmentId: string | null;
  quoteId: string | null;
  jobId: string | null;
  totalCents: number | null;
  collectedCents: number;
  remainingBalanceCents: number | null;
  nextActionId: string | null;
}

export interface JourneyActionRecommendation {
  type: NextActionType;
  reason: string;
  dueAt: string | null;
  automatic: boolean;
}

export interface JourneyReconciliation {
  opportunity: CommercialOpportunityView;
  action: JourneyActionRecommendation | null;
  shouldCloseWon: boolean;
  shouldRemainClosedLost: boolean;
}

export interface ActionCenterItem {
  id: string;
  businessId: string;
  leadId: string;
  contactId: string;
  conversationId: string;
  customerName: string;
  actionType: NextActionType;
  reason: string;
  amountCents: number | null;
  dueAt: string | null;
  createdAt: string;
}
