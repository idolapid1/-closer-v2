import type {
  AuthenticatedIdentity,
  BookingCreationInput,
  ConnectorConfigurationView,
  ConversationRecord,
  CopilotExecutionInput,
  CopilotExecutionResult,
  CustomerRecord,
  CustomerResponseInput,
  CustomerResponseResult,
  CustomerWorkspaceRecord,
  FollowUpJobRecord,
  JourneyCreationInput,
  JourneyCreationResult,
  InvitationAcceptanceResult,
  OrganizationInvitationCreationRecord,
  OrganizationInvitationRecord,
  OrganizationMembership,
  PaymentCreationInput,
  PaymentCreationResult,
  OwnerSnapshotRecord,
  OpportunityCreationInput,
  OpportunityCreationResult,
  RevenueLedgerEntry,
  RevenueSummary,
  TenantProvisionInput,
  TenantProvisionResult,
  WebhookEndpoint,
  WebhookEventRecord,
} from '../domain/model.js';
import type {
  OpportunityRecord,
  OpportunityDetailRecord,
  RecoveryActionRecord,
  RecoveryEvaluationRecord,
  RevenueCommandCenterRecord,
} from '../domain/opportunity.js';

export type IdempotencyBeginResult =
  | { state: 'started' }
  | { state: 'replay'; response: unknown }
  | { state: 'conflict' }
  | { state: 'in_progress' };

export type SystemDatabasePurpose = 'follow-up-worker' | 'webhook-ingestion';

export interface AuthenticatedStoreExecutionOptions {
  /**
   * A verified authentication subject may reach CLOSER before an app_users row exists.
   * The request boundary creates that row from the verified identity before setting RLS context.
   */
  provisionAppUser?: boolean;
}

export interface ProductionStore {
  runAsAuthenticated<T>(
    actor: AuthenticatedIdentity,
    operation: (store: ProductionStore) => Promise<T>,
    options?: AuthenticatedStoreExecutionOptions,
  ): Promise<T>;
  runAsSystem<T>(
    purpose: SystemDatabasePurpose,
    operation: (store: ProductionStore) => Promise<T>,
  ): Promise<T>;

  provisionTenant(
    actor: AuthenticatedIdentity,
    input: TenantProvisionInput,
    now: string,
  ): Promise<TenantProvisionResult>;
  listMemberships(userId: string): Promise<OrganizationMembership[]>;
  getMembership(userId: string, tenantId: string): Promise<OrganizationMembership | null>;
  listCustomers(tenantId: string): Promise<CustomerRecord[]>;
  listOpportunities(tenantId: string, limit?: number, offset?: number): Promise<OpportunityRecord[]>;
  getOpportunity(tenantId: string, opportunityId: string): Promise<OpportunityRecord | null>;
  getOpportunityDetail(tenantId: string, opportunityId: string): Promise<OpportunityDetailRecord | null>;
  getRevenueCommandCenter(tenantId: string): Promise<RevenueCommandCenterRecord>;
  evaluateOpportunityRecovery(
    tenantId: string,
    opportunityId: string,
    actor: AuthenticatedIdentity,
    idempotencyKey: string,
    now: string,
  ): Promise<RecoveryEvaluationRecord>;
  approveRecoveryAction(
    tenantId: string,
    opportunityId: string,
    actionId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<RecoveryActionRecord>;
  recordCustomerOptOut(
    tenantId: string,
    customerId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<{ customerId: string; stoppedOpportunities: number; cancelledFollowUps: number }>;
  recordCustomerResponse(
    tenantId: string,
    opportunityId: string,
    actor: AuthenticatedIdentity,
    input: CustomerResponseInput,
    now: string,
  ): Promise<CustomerResponseResult>;
  listConversations(tenantId: string): Promise<ConversationRecord[]>;
  listFollowUps(tenantId: string): Promise<FollowUpJobRecord[]>;
  getCustomerWorkspace(tenantId: string, customerId: string): Promise<CustomerWorkspaceRecord | null>;
  getOwnerSnapshot(tenantId: string): Promise<OwnerSnapshotRecord>;
  getRevenueSummary(tenantId: string): Promise<RevenueSummary>;
  listConnectorConfigurations(tenantId: string): Promise<ConnectorConfigurationView[]>;
  createInvitation(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: OrganizationInvitationCreationRecord,
    now: string,
  ): Promise<OrganizationInvitationRecord>;
  acceptInvitation(
    tokenHash: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<InvitationAcceptanceResult>;
  revokeInvitation(
    tenantId: string,
    invitationId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<OrganizationInvitationRecord | null>;
  startHumanTakeover(
    tenantId: string,
    conversationId: string,
    actor: AuthenticatedIdentity,
    reason: string,
    now: string,
  ): Promise<{ conversationId: string; handoffId: string; mode: 'HUMAN_ACTIVE' }>;
  resumeAssistant(
    tenantId: string,
    conversationId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<{ conversationId: string; mode: 'AI_ACTIVE' }>;

  beginIdempotency(
    tenantId: string,
    scope: string,
    key: string,
    requestHash: string,
    now: string,
  ): Promise<IdempotencyBeginResult>;
  completeIdempotency(
    tenantId: string,
    scope: string,
    key: string,
    response: unknown,
    now: string,
  ): Promise<void>;
  abandonIdempotency(tenantId: string, scope: string, key: string): Promise<void>;

  createJourney(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: JourneyCreationInput,
    now: string,
  ): Promise<JourneyCreationResult>;
  createOpportunity(
    tenantId: string,
    customerId: string,
    actor: AuthenticatedIdentity,
    input: OpportunityCreationInput,
    now: string,
  ): Promise<OpportunityCreationResult>;
  createBooking(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: BookingCreationInput,
    now: string,
  ): Promise<{ bookingId: string }>;
  createPayment(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: PaymentCreationInput,
    now: string,
  ): Promise<PaymentCreationResult>;
  appendRevenueEntry(
    tenantId: string,
    actor: AuthenticatedIdentity,
    entry: Omit<RevenueLedgerEntry, 'id' | 'tenantId' | 'occurredAt'>,
    now: string,
  ): Promise<RevenueLedgerEntry>;

  createFollowUp(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: Pick<FollowUpJobRecord, 'conversationId' | 'customerId' | 'channel' | 'reason' | 'dueAt' | 'idempotencyKey' | 'draftMessage'>,
    now: string,
  ): Promise<FollowUpJobRecord>;
  cancelFollowUp(
    tenantId: string,
    followUpId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<FollowUpJobRecord | null>;
  claimDueFollowUp(workerId: string, now: string, leaseUntil: string): Promise<FollowUpJobRecord | null>;
  completeFollowUp(
    followUpId: string,
    workerId: string,
    attemptKey: string,
    now: string,
  ): Promise<void>;
  failFollowUp(
    followUpId: string,
    workerId: string,
    attemptKey: string,
    errorCode: string,
    retryAt: string | null,
    now: string,
  ): Promise<void>;

  executeCopilot(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: CopilotExecutionInput,
    now: string,
  ): Promise<CopilotExecutionResult>;

  findWebhookEndpoint(provider: string, endpointId: string): Promise<WebhookEndpoint | null>;
  recordWebhookEvent(
    endpoint: WebhookEndpoint,
    providerEventId: string,
    payloadHash: string,
    now: string,
  ): Promise<WebhookEventRecord>;
  markWebhookProcessed(eventId: string, now: string): Promise<void>;
}
