export interface ProductionTenantContract {
  tenantId: string;
  tenantName: string;
  role: 'owner' | 'admin' | 'member';
  active: boolean;
}

export interface ProductionCustomerContract {
  id: string;
  tenantId: string;
  displayName: string;
  phone: string;
  email: string | null;
  createdAt: string;
}

export interface ProductionConversationContract {
  id: string;
  tenantId: string;
  customerId: string;
  leadId: string;
  channel: string;
  mode: 'AI_ACTIVE' | 'HUMAN_ACTIVE' | 'PAUSED' | 'CLOSED';
  stage: string;
  lastCustomerMessageAt: string | null;
  lastBusinessResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionFollowUpContract {
  id: string;
  tenantId: string;
  conversationId: string;
  customerId: string;
  channel: string;
  reason: string;
  status: 'scheduled' | 'leased' | 'completed' | 'failed' | 'cancelled';
  dueAt: string;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  retryAt: string | null;
  lastError: string | null;
  stopReason: string | null;
  manualOverride: boolean;
  lastResponseAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  idempotencyKey: string;
  draftMessage: string | null;
  createdAt: string;
}

export interface ProductionRevenueSummaryContract {
  potentialCents: number;
  pipelineCents: number;
  bookedCents: number;
  collectedCents: number;
  refundedCents: number;
  recoveredCents: number;
}

export interface ProductionHandoffContract {
  id: string;
  tenantId: string;
  conversationId: string;
  reason: string;
  detail: string;
  startedAt: string;
  resolvedAt: string | null;
}

export interface ProductionConnectorContract {
  id: string;
  tenantId: string;
  provider: string;
  enabled: boolean;
  mode: 'mock' | 'disabled';
  secretConfigured: boolean;
  webhookEndpointId: string;
}

export interface ProductionLeadContract {
  id: string;
  tenantId: string;
  customerId: string;
  conversationId: string;
  serviceId: string | null;
  source: string;
  workflowType: 'APPOINTMENT_SERVICE' | 'QUOTE_JOB';
  salesState: string;
  status: 'NEW' | 'ACTIVE' | 'QUALIFIED' | 'WON' | 'LOST' | 'ARCHIVED';
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionPaymentContract {
  id: string;
  tenantId: string;
  customerId: string;
  leadId: string;
  conversationId: string;
  referenceType: 'APPOINTMENT' | 'QUOTE' | 'JOB';
  referenceId: string;
  kind: 'DEPOSIT' | 'BALANCE' | 'REFUND';
  status: 'COLLECTED' | 'FAILED' | 'VOIDED';
  amountCents: number;
  originalPaymentId: string | null;
  collectedAt: string;
}

export interface ProductionOwnerSnapshotContract {
  customers: ProductionCustomerContract[];
  conversations: ProductionConversationContract[];
  followUps: ProductionFollowUpContract[];
  activeHandoffs: ProductionHandoffContract[];
  revenue: ProductionRevenueSummaryContract;
}

export interface ProductionCustomerWorkspaceContract {
  customer: ProductionCustomerContract;
  opportunities: ProductionOpportunityContract[];
  lead: ProductionLeadContract | null;
  conversation: ProductionConversationContract | null;
  followUps: ProductionFollowUpContract[];
  activeHandoff: ProductionHandoffContract | null;
  payments: ProductionPaymentContract[];
}

export interface ProductionFollowUpCreationContract {
  idempotencyKey: string;
  conversationId: string;
  customerId: string;
  channel: 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL' | 'MANUAL';
  reason: string;
  dueAt: string;
  draftMessage: string | null;
}

export interface ProductionInvitationContract {
  id: string;
  tenantId: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ProductionJourneyCreationContract {
  idempotencyKey: string;
  customer: { displayName: string; phone: string; email: string | null };
  lead: {
    source: 'MISSED_CALL' | 'PHONE' | 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'EMAIL' | 'MANUAL' | 'IMPORT';
    workflowType: 'APPOINTMENT_SERVICE' | 'QUOTE_JOB';
    serviceId: string | null;
    opportunityType?: ProductionOpportunityType;
    estimatedValueCents?: number | null;
    autonomyLevel?: ProductionAutonomyLevel;
  };
  conversation: { channel: 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'EMAIL' | 'MANUAL' };
}

export interface ProductionJourneyResultContract {
  customerId: string;
  leadId: string;
  conversationId: string;
  opportunityId: string;
  replayed: boolean;
}

export interface ProductionOpportunityCreationContract {
  idempotencyKey: string;
  source: ProductionOpportunityContract['source'];
  workflowType: 'APPOINTMENT_SERVICE' | 'QUOTE_JOB';
  serviceId: string | null;
  opportunityType: ProductionOpportunityType;
  estimatedValueCents: number | null;
  autonomyLevel: ProductionAutonomyLevel;
  channel: 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'EMAIL' | 'MANUAL';
}

export interface ProductionOpportunityCreationResultContract {
  opportunityId: string;
  leadId: string;
  conversationId: string;
  replayed: boolean;
}

export interface ProductionCustomerResponseContract {
  idempotencyKey: string;
  providerMessageId: string;
  body: string;
}

export interface ProductionCustomerResponseResultContract {
  messageId: string;
  opportunityId: string;
  conversationId: string;
  providerReplay: boolean;
  replayed: boolean;
}

export type ProductionOpportunityStatus =
  | 'NEW' | 'CONTACTING' | 'ENGAGED' | 'QUALIFIED' | 'BOOKED' | 'ESTIMATE'
  | 'WON' | 'LOST' | 'SNOOZED' | 'DO_NOT_CONTACT';

export type ProductionRecoveryState =
  | 'NOT_AT_RISK' | 'AT_RISK' | 'RECOVERY_ACTIVE' | 'WAITING_FOR_CUSTOMER'
  | 'HUMAN_REQUIRED' | 'RECOVERED' | 'FAILED' | 'STOPPED';

export type ProductionOpportunityType =
  | 'EMERGENCY_REPAIR' | 'STANDARD_REPAIR' | 'MAINTENANCE' | 'TUNE_UP'
  | 'SYSTEM_REPLACEMENT' | 'INSTALLATION' | 'INDOOR_AIR_QUALITY' | 'DUCT_WORK'
  | 'COMMERCIAL_SERVICE' | 'OTHER';

export type ProductionAutonomyLevel = 'OBSERVE' | 'SUGGEST' | 'APPROVE_TO_SEND' | 'AUTOPILOT';

export interface ProductionExplainableScoreContract {
  value: number;
  reasonCodes: string[];
  explanation: string;
  version: string;
}

export interface ProductionOpportunityContract {
  id: string;
  tenantId: string;
  customerId: string;
  leadId: string | null;
  conversationId: string | null;
  source: 'MISSED_CALL' | 'PHONE' | 'WEBSITE_FORM' | 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL' | 'IMPORT' | 'MANUAL' | 'OTHER';
  opportunityType: ProductionOpportunityType;
  estimatedValueCents: number | null;
  currency: string;
  scores: {
    intent: ProductionExplainableScoreContract;
    revenue: ProductionExplainableScoreContract;
    recovery: ProductionExplainableScoreContract;
    urgency: ProductionExplainableScoreContract;
  };
  status: ProductionOpportunityStatus;
  recoveryState: ProductionRecoveryState;
  autonomyLevel: ProductionAutonomyLevel;
  assignedHumanId: string | null;
  lastCustomerActivityAt: string | null;
  lastBusinessActivityAt: string | null;
  nextActionAt: string | null;
  bookingId: string | null;
  estimateId: string | null;
  jobId: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  revenueAttributedCents: number;
  attributionType: 'GENERATED' | 'RECOVERED' | 'ASSISTED' | 'ORGANIC' | null;
  attributionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionRevenueCommandCenterContract {
  potentialRecoveredRevenueCents: number;
  actualRecoveredRevenueCents: number;
  influencedRevenueCents: number;
  revenueAtRiskCents: number;
  recoveredJobs: number;
  recoveredBookings: number;
  activeOpportunities: number;
  humanInterventionRequired: number;
  averageRecoveryTimeHours: number | null;
  opportunitiesAtRisk: ProductionOpportunityContract[];
}

export interface ProductionRecoveryDecisionContract {
  id: string;
  tenantId: string;
  opportunityId: string;
  playType: 'MISSED_CALL_RECOVERY' | 'NEW_LEAD_RECOVERY' | 'UNSOLD_ESTIMATE_RECOVERY' | 'OLD_LEAD_REACTIVATION' | null;
  eligible: boolean;
  suppressionReason: string | null;
  scores: ProductionOpportunityContract['scores'];
  nextBestAction: {
    kind: 'SEND_SMS' | 'SEND_EMAIL' | 'WAIT' | 'REQUEST_HUMAN' | 'ATTEMPT_BOOKING' | 'STOP_RECOVERY' | 'MARK_LOST' | 'ASK_QUALIFICATION';
    reasonCode: string;
    label: string;
    channel: 'SMS' | 'EMAIL' | 'MANUAL' | null;
    requiresApproval: boolean;
    dueAt: string | null;
  };
  policyVersion: string;
  idempotencyKey: string;
  decidedAt: string;
  executedAt: string | null;
  executionState: 'OBSERVED' | 'SUGGESTED' | 'PENDING_APPROVAL' | 'EXECUTED' | 'SUPPRESSED';
}

export interface ProductionRecoveryActionContract {
  id: string;
  tenantId: string;
  opportunityId: string;
  decisionId: string;
  actionKind: ProductionRecoveryDecisionContract['nextBestAction']['kind'];
  channel: 'SMS' | 'EMAIL' | 'MANUAL' | null;
  status: 'PENDING' | 'READY' | 'WAITING_APPROVAL' | 'EXECUTING' | 'COMPLETED'
    | 'WAITING_CUSTOMER' | 'HUMAN_REQUIRED' | 'CANCELLED' | 'FAILED' | 'SUPPRESSED';
  requiresApproval: boolean;
  requestedBy: 'POLICY' | 'COPILOT' | 'HUMAN';
  idempotencyKey: string;
  validUntil: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastError: string | null;
  deliveryState: 'PREPARED_ONLY' | 'MOCK_ONLY' | 'LIVE_DISABLED';
  createdAt: string;
  updatedAt: string;
}

export interface ProductionRevenueEventContract {
  id: string;
  tenantId: string;
  customerId: string;
  leadId: string;
  conversationId: string;
  paymentId: string | null;
  stage: 'potential' | 'pipeline' | 'booked' | 'collected' | 'refunded' | 'recovered';
  amountCents: number;
  causationKey: string;
  occurredAt: string;
  opportunityId?: string | null;
  eventType?: 'ESTIMATE_CREATED' | 'POTENTIAL_REVENUE_AT_RISK' | 'BOOKING_CREATED' | 'BOOKING_RECOVERED' | 'JOB_WON' | 'PAYMENT_RECEIVED' | 'REFUND' | 'ADJUSTMENT' | null;
  attributionType?: 'GENERATED' | 'RECOVERED' | 'ASSISTED' | 'ORGANIC' | null;
  attributionReason?: string | null;
}

export interface ProductionOpportunityDetailContract {
  opportunity: ProductionOpportunityContract;
  recoveryDecisions: ProductionRecoveryDecisionContract[];
  recoveryActions: ProductionRecoveryActionContract[];
  revenueEvents: ProductionRevenueEventContract[];
  customer: ProductionCustomerContract;
  conversation: ProductionConversationContract | null;
  booking: { id: string; status: string; startAt: string; endAt: string; totalCents: number } | null;
  estimate: { id: string; status: string; totalCents: number; createdAt: string } | null;
  job: { id: string; status: string; scheduledStartAt: string | null; totalCents: number } | null;
  activeHandoff: ProductionHandoffContract | null;
}

export interface ProductionCopilotExecutionContract {
  tool:
    | 'GET_HOT_LEADS'
    | 'GET_UNANSWERED_CONVERSATIONS'
    | 'GET_REVENUE_OVERVIEW'
    | 'GET_REACTIVATION_CANDIDATES'
    | 'GET_REVENUE_AT_RISK'
    | 'GET_PRIORITY_OPPORTUNITIES'
    | 'GET_HUMAN_REQUIRED_OPPORTUNITIES'
    | 'EXPLAIN_OPPORTUNITY_PRIORITY'
    | 'PREPARE_REACTIVATION'
    | 'PREPARE_OPPORTUNITY_RECOVERY';
  arguments: Record<string, unknown>;
  approved: boolean;
  idempotencyKey: string;
}

export interface ProductionCopilotResultContract {
  auditId: string;
  status: 'executed' | 'replayed';
  result: Record<string, unknown>;
}
