import type {
  HvacOpportunityType,
  OpportunityAutonomyLevel,
  OpportunityRecord,
  OpportunitySource,
  RevenueAttributionType,
} from './opportunity.js';

export type OrganizationRole = 'owner' | 'admin' | 'member';

export interface AuthenticatedIdentity {
  userId: string;
  email: string | null;
  tokenId: string | null;
}

export interface OrganizationMembership {
  tenantId: string;
  tenantName: string;
  role: OrganizationRole;
  active: boolean;
}

export interface TenantProvisionInput {
  name: string;
  idempotencyKey: string;
}

export interface TenantProvisionResult {
  tenantId: string;
  role: 'owner';
  replayed: boolean;
}

export interface OrganizationInvitationRecord {
  id: string;
  tenantId: string;
  email: string;
  role: Exclude<OrganizationRole, 'owner'>;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  replayed: boolean;
}

export interface OrganizationInvitationCreationInput {
  email: string;
  role: Exclude<OrganizationRole, 'owner'>;
  idempotencyKey: string;
}

export interface OrganizationInvitationCreationRecord extends OrganizationInvitationCreationInput {
  tokenHash: string;
  expiresAt: string;
}

export interface InvitationAcceptanceResult {
  tenantId: string;
  role: Exclude<OrganizationRole, 'owner'>;
  replayed: boolean;
}

export interface CustomerRecord {
  id: string;
  tenantId: string;
  displayName: string;
  phone: string;
  email: string | null;
  createdAt: string;
}

export interface ConversationRecord {
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

export interface LeadRecordView {
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

export interface HumanHandoffRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  reason: string;
  detail: string;
  startedAt: string;
  resolvedAt: string | null;
}

export interface PaymentRecordView {
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

export interface RevenueSummary {
  potentialCents: number;
  pipelineCents: number;
  bookedCents: number;
  collectedCents: number;
  refundedCents: number;
  recoveredCents: number;
}

export type FollowUpJobStatus =
  | 'scheduled'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface FollowUpJobRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  customerId: string;
  channel: string;
  reason: string;
  status: FollowUpJobStatus;
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

export interface CustomerWorkspaceRecord {
  customer: CustomerRecord;
  opportunities: OpportunityRecord[];
  lead: LeadRecordView | null;
  conversation: ConversationRecord | null;
  followUps: FollowUpJobRecord[];
  activeHandoff: HumanHandoffRecord | null;
  payments: PaymentRecordView[];
}

export interface OwnerSnapshotRecord {
  customers: CustomerRecord[];
  conversations: ConversationRecord[];
  followUps: FollowUpJobRecord[];
  activeHandoffs: HumanHandoffRecord[];
  revenue: RevenueSummary;
}

export interface ConnectorConfigurationView {
  id: string;
  tenantId: string;
  provider: string;
  enabled: boolean;
  mode: 'mock' | 'disabled';
  secretConfigured: boolean;
  webhookEndpointId: string;
}

export interface JourneyCreationInput {
  idempotencyKey: string;
  customer: {
    displayName: string;
    phone: string;
    email: string | null;
  };
  lead: {
    source: string;
    workflowType: 'APPOINTMENT_SERVICE' | 'QUOTE_JOB';
    serviceId: string | null;
    opportunityType?: HvacOpportunityType | undefined;
    estimatedValueCents?: number | null | undefined;
    autonomyLevel?: OpportunityAutonomyLevel | undefined;
  };
  conversation: {
    channel: string;
  };
}

export interface JourneyCreationResult {
  customerId: string;
  leadId: string;
  conversationId: string;
  opportunityId: string;
  replayed: boolean;
}

export interface OpportunityCreationInput {
  idempotencyKey: string;
  source: OpportunitySource;
  workflowType: 'APPOINTMENT_SERVICE' | 'QUOTE_JOB';
  serviceId: string | null;
  opportunityType: HvacOpportunityType;
  estimatedValueCents: number | null;
  autonomyLevel: OpportunityAutonomyLevel;
  channel: string;
}

export interface OpportunityCreationResult {
  opportunityId: string;
  leadId: string;
  conversationId: string;
  replayed: boolean;
}

export interface BookingCreationInput {
  idempotencyKey: string;
  customerId: string;
  leadId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  totalCents: number;
  depositRequiredCents: number;
}

export interface PaymentCreationInput {
  idempotencyKey: string;
  customerId: string;
  leadId: string;
  conversationId: string;
  referenceType: 'APPOINTMENT' | 'QUOTE' | 'JOB';
  referenceId: string;
  kind: 'DEPOSIT' | 'BALANCE' | 'REFUND';
  amountCents: number;
  originalPaymentId: string | null;
}

export interface PaymentCreationResult {
  paymentId: string;
  replayed: boolean;
}

export interface CustomerResponseInput {
  providerMessageId: string;
  body: string;
}

export interface CustomerResponseResult {
  messageId: string;
  opportunityId: string;
  conversationId: string;
  providerReplay: boolean;
}

export type RevenueLedgerStage =
  | 'potential'
  | 'pipeline'
  | 'booked'
  | 'collected'
  | 'refunded'
  | 'recovered';

export interface RevenueLedgerEntry {
  id: string;
  tenantId: string;
  customerId: string;
  leadId: string;
  conversationId: string;
  paymentId: string | null;
  stage: RevenueLedgerStage;
  amountCents: number;
  causationKey: string;
  occurredAt: string;
  opportunityId?: string | null | undefined;
  eventType?: 'ESTIMATE_CREATED' | 'POTENTIAL_REVENUE_AT_RISK' | 'BOOKING_CREATED' | 'BOOKING_RECOVERED' | 'JOB_WON' | 'PAYMENT_RECEIVED' | 'REFUND' | 'ADJUSTMENT' | null | undefined;
  attributionType?: RevenueAttributionType | null | undefined;
  attributionReason?: string | null | undefined;
}

export interface CopilotExecutionInput {
  tool: string;
  arguments: Record<string, unknown>;
  approved: boolean;
  idempotencyKey: string;
}

export interface CopilotExecutionResult {
  auditId: string;
  status: 'executed' | 'replayed';
  result: Record<string, unknown>;
}

export interface WebhookEndpoint {
  tenantId: string;
  provider: string;
  endpointId: string;
  signingSecretReference: string;
  enabled: boolean;
}

export interface WebhookEventRecord {
  id: string;
  tenantId: string;
  provider: string;
  providerEventId: string;
  receivedAt: string;
  verified: boolean;
  payloadHash: string;
  processingState: 'received' | 'processed' | 'failed';
  replayed: boolean;
}

export type CommercialEntityKind = 'booking';
