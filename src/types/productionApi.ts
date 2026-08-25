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
    source: 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'EMAIL' | 'MANUAL' | 'IMPORT';
    workflowType: 'APPOINTMENT_SERVICE' | 'QUOTE_JOB';
    serviceId: string | null;
  };
  conversation: { channel: 'WHATSAPP' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'EMAIL' | 'MANUAL' };
}

export interface ProductionJourneyResultContract {
  customerId: string;
  leadId: string;
  conversationId: string;
  replayed: boolean;
}

export interface ProductionCopilotExecutionContract {
  tool:
    | 'GET_HOT_LEADS'
    | 'GET_UNANSWERED_CONVERSATIONS'
    | 'GET_REVENUE_OVERVIEW'
    | 'GET_REACTIVATION_CANDIDATES'
    | 'PREPARE_REACTIVATION';
  arguments: Record<string, unknown>;
  approved: boolean;
  idempotencyKey: string;
}

export interface ProductionCopilotResultContract {
  auditId: string;
  status: 'executed' | 'replayed';
  result: Record<string, unknown>;
}
