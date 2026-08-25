import type {
  AuthenticatedIdentity,
  BookingCreationInput,
  ConnectorConfigurationView,
  ConversationRecord,
  CopilotExecutionInput,
  CopilotExecutionResult,
  CustomerRecord,
  FollowUpJobRecord,
  JourneyCreationInput,
  JourneyCreationResult,
  OrganizationMembership,
  PaymentCreationInput,
  PaymentCreationResult,
  RevenueLedgerEntry,
  RevenueSummary,
  TenantProvisionInput,
  TenantProvisionResult,
  WebhookEndpoint,
  WebhookEventRecord,
} from '../domain/model.js';

export type IdempotencyBeginResult =
  | { state: 'started' }
  | { state: 'replay'; response: unknown }
  | { state: 'conflict' }
  | { state: 'in_progress' };

export interface ProductionStore {
  provisionTenant(
    actor: AuthenticatedIdentity,
    input: TenantProvisionInput,
    now: string,
  ): Promise<TenantProvisionResult>;
  listMemberships(userId: string): Promise<OrganizationMembership[]>;
  getMembership(userId: string, tenantId: string): Promise<OrganizationMembership | null>;
  listCustomers(tenantId: string): Promise<CustomerRecord[]>;
  listConversations(tenantId: string): Promise<ConversationRecord[]>;
  getRevenueSummary(tenantId: string): Promise<RevenueSummary>;
  listConnectorConfigurations(tenantId: string): Promise<ConnectorConfigurationView[]>;
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
