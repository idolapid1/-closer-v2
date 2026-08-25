import { randomUUID } from 'node:crypto';
import { ApiError } from '../application/errors.js';
import type { IdempotencyBeginResult, ProductionStore } from '../application/store.js';
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

interface LeadRecord {
  id: string;
  tenantId: string;
  customerId: string;
  conversationId: string;
  source: string;
  workflowType: string;
  serviceId: string | null;
  status: 'NEW' | 'ACTIVE' | 'LOST' | 'WON';
  marketingAllowed: boolean;
}

interface BookingRecord {
  id: string;
  tenantId: string;
  customerId: string;
  leadId: string;
  totalCents: number;
  idempotencyKey: string;
  staffId: string;
  startAt: string;
  endAt: string;
}

interface PaymentRecord extends PaymentCreationInput {
  id: string;
  tenantId: string;
  createdAt: string;
}

interface IdempotencyRecord {
  requestHash: string;
  status: 'started' | 'completed';
  response: unknown;
}

export interface InMemoryProductionSeed {
  memberships?: Array<{ userId: string; membership: OrganizationMembership }>;
  customers?: CustomerRecord[];
  conversations?: ConversationRecord[];
  leads?: LeadRecord[];
  revenueEntries?: RevenueLedgerEntry[];
  followUps?: FollowUpJobRecord[];
  connectors?: ConnectorConfigurationView[];
  webhookEndpoints?: WebhookEndpoint[];
}

export class InMemoryProductionStore implements ProductionStore {
  private readonly memberships: Array<{ userId: string; membership: OrganizationMembership }>;
  private readonly customers: CustomerRecord[];
  private readonly leads: LeadRecord[];
  private readonly conversations: ConversationRecord[];
  private readonly bookings: BookingRecord[] = [];
  private readonly payments: PaymentRecord[] = [];
  private readonly revenueEntries: RevenueLedgerEntry[];
  private readonly followUps: FollowUpJobRecord[];
  private readonly connectors: ConnectorConfigurationView[];
  private readonly webhookEndpoints: WebhookEndpoint[];
  private readonly webhookEvents: WebhookEventRecord[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly copilotAudits = new Map<string, CopilotExecutionResult>();
  private readonly followUpAttempts = new Set<string>();
  private readonly humanHandoffs = new Map<string, { id: string; resolvedAt: string | null }>();
  private readonly tenantProvisions = new Map<string, { name: string; result: TenantProvisionResult }>();

  constructor(seed: InMemoryProductionSeed = {}) {
    this.memberships = structuredClone(seed.memberships ?? []);
    this.customers = structuredClone(seed.customers ?? []);
    this.leads = structuredClone(seed.leads ?? []);
    this.conversations = structuredClone(seed.conversations ?? []);
    this.revenueEntries = structuredClone(seed.revenueEntries ?? []);
    this.followUps = structuredClone(seed.followUps ?? []);
    this.connectors = structuredClone(seed.connectors ?? []);
    this.webhookEndpoints = structuredClone(seed.webhookEndpoints ?? []);
  }

  async provisionTenant(
    actor: AuthenticatedIdentity,
    input: TenantProvisionInput,
  ): Promise<TenantProvisionResult> {
    const key = `${actor.userId}:${input.idempotencyKey}`;
    const existing = this.tenantProvisions.get(key);
    if (existing) {
      if (existing.name !== input.name) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Provisioning key was reused with different input');
      }
      return { ...existing.result, replayed: true };
    }
    const tenantId = randomUUID();
    const result: TenantProvisionResult = { tenantId, role: 'owner', replayed: false };
    this.memberships.push({
      userId: actor.userId,
      membership: { tenantId, tenantName: input.name, role: 'owner', active: true },
    });
    this.tenantProvisions.set(key, { name: input.name, result });
    return structuredClone(result);
  }

  async listMemberships(userId: string): Promise<OrganizationMembership[]> {
    return structuredClone(
      this.memberships.filter((entry) => entry.userId === userId).map((entry) => entry.membership),
    );
  }

  async getMembership(userId: string, tenantId: string): Promise<OrganizationMembership | null> {
    return structuredClone(
      this.memberships.find(
        (entry) => entry.userId === userId && entry.membership.tenantId === tenantId,
      )?.membership ?? null,
    );
  }

  async listCustomers(tenantId: string): Promise<CustomerRecord[]> {
    return structuredClone(this.customers.filter((customer) => customer.tenantId === tenantId));
  }

  async listConversations(tenantId: string): Promise<ConversationRecord[]> {
    return structuredClone(
      this.conversations.filter((conversation) => conversation.tenantId === tenantId),
    );
  }

  async getRevenueSummary(tenantId: string): Promise<RevenueSummary> {
    const totals: RevenueSummary = {
      potentialCents: 0,
      pipelineCents: 0,
      bookedCents: 0,
      collectedCents: 0,
      refundedCents: 0,
      recoveredCents: 0,
    };
    for (const entry of this.revenueEntries.filter((candidate) => candidate.tenantId === tenantId)) {
      if (entry.stage === 'potential') totals.potentialCents += entry.amountCents;
      if (entry.stage === 'pipeline') totals.pipelineCents += entry.amountCents;
      if (entry.stage === 'booked') totals.bookedCents += entry.amountCents;
      if (entry.stage === 'collected') totals.collectedCents += entry.amountCents;
      if (entry.stage === 'refunded') totals.refundedCents += entry.amountCents;
      if (entry.stage === 'recovered') totals.recoveredCents += entry.amountCents;
    }
    totals.collectedCents = Math.max(0, totals.collectedCents - totals.refundedCents);
    return totals;
  }

  async listConnectorConfigurations(tenantId: string): Promise<ConnectorConfigurationView[]> {
    return structuredClone(this.connectors.filter((connector) => connector.tenantId === tenantId));
  }

  async startHumanTakeover(
    tenantId: string,
    conversationId: string,
  ): Promise<{ conversationId: string; handoffId: string; mode: 'HUMAN_ACTIVE' }> {
    const conversation = this.conversations.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === conversationId,
    );
    if (!conversation) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
    const existing = this.humanHandoffs.get(conversationId);
    const handoffId = existing?.resolvedAt === null ? existing.id : randomUUID();
    this.humanHandoffs.set(conversationId, { id: handoffId, resolvedAt: null });
    conversation.mode = 'HUMAN_ACTIVE';
    for (const followUp of this.followUps.filter(
      (candidate) => candidate.tenantId === tenantId && candidate.conversationId === conversationId,
    )) {
      if (followUp.status === 'scheduled' || followUp.status === 'failed') {
        followUp.status = 'cancelled';
        followUp.stopReason = 'HUMAN_TAKEOVER';
      }
    }
    return { conversationId, handoffId, mode: 'HUMAN_ACTIVE' };
  }

  async resumeAssistant(
    tenantId: string,
    conversationId: string,
    _actor: AuthenticatedIdentity,
    now: string,
  ): Promise<{ conversationId: string; mode: 'AI_ACTIVE' }> {
    const conversation = this.conversations.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === conversationId,
    );
    if (!conversation) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
    const handoff = this.humanHandoffs.get(conversationId);
    if (!handoff || handoff.resolvedAt !== null || conversation.mode !== 'HUMAN_ACTIVE') {
      throw new ApiError(409, 'NO_ACTIVE_HANDOFF', 'No active Human Takeover can be resumed');
    }
    handoff.resolvedAt = now;
    conversation.mode = 'AI_ACTIVE';
    return { conversationId, mode: 'AI_ACTIVE' };
  }

  async beginIdempotency(
    tenantId: string,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyBeginResult> {
    const composite = `${tenantId}:${scope}:${key}`;
    const existing = this.idempotency.get(composite);
    if (!existing) {
      this.idempotency.set(composite, { requestHash, status: 'started', response: null });
      return { state: 'started' };
    }
    if (existing.requestHash !== requestHash) return { state: 'conflict' };
    if (existing.status === 'started') return { state: 'in_progress' };
    return { state: 'replay', response: structuredClone(existing.response) };
  }

  async completeIdempotency(
    tenantId: string,
    scope: string,
    key: string,
    response: unknown,
  ): Promise<void> {
    const record = this.idempotency.get(`${tenantId}:${scope}:${key}`);
    if (!record) throw new Error('Missing idempotency record');
    record.status = 'completed';
    record.response = structuredClone(response);
  }

  async abandonIdempotency(tenantId: string, scope: string, key: string): Promise<void> {
    this.idempotency.delete(`${tenantId}:${scope}:${key}`);
  }

  async createJourney(
    tenantId: string,
    _actor: AuthenticatedIdentity,
    input: JourneyCreationInput,
    now: string,
  ): Promise<JourneyCreationResult> {
    const customerId = randomUUID();
    const leadId = randomUUID();
    const conversationId = randomUUID();
    this.customers.push({
      id: customerId,
      tenantId,
      displayName: input.customer.displayName,
      phone: input.customer.phone,
      email: input.customer.email,
      createdAt: now,
    });
    this.leads.push({
      id: leadId,
      tenantId,
      customerId,
      conversationId,
      source: input.lead.source,
      workflowType: input.lead.workflowType,
      serviceId: input.lead.serviceId,
      status: 'NEW',
      marketingAllowed: false,
    });
    this.conversations.push({
      id: conversationId,
      tenantId,
      customerId,
      leadId,
      channel: input.conversation.channel,
      mode: 'AI_ACTIVE',
      createdAt: now,
    });
    return { customerId, leadId, conversationId, replayed: false };
  }

  async createBooking(
    tenantId: string,
    _actor: AuthenticatedIdentity,
    input: BookingCreationInput,
  ): Promise<{ bookingId: string }> {
    this.requireCustomerAndLead(tenantId, input.customerId, input.leadId);
    const conflict = this.bookings.find(
      (booking) => booking.tenantId === tenantId && booking.idempotencyKey === input.idempotencyKey,
    );
    if (conflict) return { bookingId: conflict.id };
    const overlap = this.bookings.find(
      (booking) =>
        booking.tenantId === tenantId &&
        booking.staffId === input.staffId &&
        booking.startAt < input.endAt &&
        booking.endAt > input.startAt,
    );
    if (overlap) throw new ApiError(409, 'BOOKING_CONFLICT', 'The slot is no longer available');
    const bookingId = randomUUID();
    this.bookings.push({
      id: bookingId,
      tenantId,
      customerId: input.customerId,
      leadId: input.leadId,
      totalCents: input.totalCents,
      idempotencyKey: input.idempotencyKey,
      staffId: input.staffId,
      startAt: input.startAt,
      endAt: input.endAt,
    });
    return { bookingId };
  }

  async createPayment(
    tenantId: string,
    _actor: AuthenticatedIdentity,
    input: PaymentCreationInput,
    now: string,
  ): Promise<PaymentCreationResult> {
    this.requireCustomerAndLead(tenantId, input.customerId, input.leadId);
    const conversation = this.conversations.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === input.conversationId,
    );
    if (!conversation || conversation.customerId !== input.customerId || conversation.leadId !== input.leadId) {
      throw new ApiError(422, 'INVALID_PAYMENT_CONTEXT', 'Payment context does not match the tenant journey');
    }
    if (input.referenceType === 'APPOINTMENT') {
      const booking = this.bookings.find(
        (candidate) =>
          candidate.tenantId === tenantId &&
          candidate.id === input.referenceId &&
          candidate.customerId === input.customerId &&
          candidate.leadId === input.leadId,
      );
      if (!booking) throw new ApiError(422, 'INVALID_PAYMENT_REFERENCE', 'Payment reference is not part of this journey');
    }
    if (input.kind === 'REFUND') {
      const original = this.payments.find(
        (payment) => payment.tenantId === tenantId && payment.id === input.originalPaymentId,
      );
      if (!original || original.kind === 'REFUND' || original.customerId !== input.customerId) {
        throw new ApiError(422, 'INVALID_REFUND_REFERENCE', 'Refund must reference a collected tenant payment');
      }
      const refundedCents = this.payments
        .filter(
          (payment) =>
            payment.tenantId === tenantId &&
            payment.kind === 'REFUND' &&
            payment.originalPaymentId === original.id,
        )
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      if (refundedCents + input.amountCents > original.amountCents) {
        throw new ApiError(422, 'REFUND_EXCEEDS_PAYMENT', 'Refund exceeds the collected payment');
      }
    }
    const paymentId = randomUUID();
    this.payments.push({ ...structuredClone(input), id: paymentId, tenantId, createdAt: now });
    return { paymentId, replayed: false };
  }

  async appendRevenueEntry(
    tenantId: string,
    _actor: AuthenticatedIdentity,
    entry: Omit<RevenueLedgerEntry, 'id' | 'tenantId' | 'occurredAt'>,
    now: string,
  ): Promise<RevenueLedgerEntry> {
    this.requireCustomerAndLead(tenantId, entry.customerId, entry.leadId);
    const existing = this.revenueEntries.find(
      (candidate) => candidate.tenantId === tenantId && candidate.causationKey === entry.causationKey,
    );
    if (existing) {
      if (
        existing.stage !== entry.stage ||
        existing.amountCents !== entry.amountCents ||
        existing.paymentId !== entry.paymentId
      ) {
        throw new ApiError(409, 'REVENUE_CAUSATION_CONFLICT', 'Revenue causation was reused with different facts');
      }
      return structuredClone(existing);
    }
    const paymentStage = this.revenueEntries.find(
      (candidate) =>
        candidate.tenantId === tenantId &&
        candidate.paymentId === entry.paymentId &&
        candidate.stage === entry.stage &&
        ['collected', 'refunded'].includes(entry.stage),
    );
    if (paymentStage) {
      throw new ApiError(409, 'DUPLICATE_FINANCIAL_EVENT', 'The payment already has this financial event');
    }
    if (entry.stage === 'collected' || entry.stage === 'refunded' || entry.stage === 'recovered') {
      const payment = this.payments.find(
        (candidate) => candidate.tenantId === tenantId && candidate.id === entry.paymentId,
      );
      if (!payment || payment.amountCents !== entry.amountCents) {
        throw new ApiError(422, 'UNVERIFIED_REVENUE', 'Collected revenue requires a matching validated payment');
      }
      if (entry.stage === 'refunded' && payment.kind !== 'REFUND') {
        throw new ApiError(422, 'UNVERIFIED_REFUND', 'Refunded revenue requires a validated refund');
      }
      if ((entry.stage === 'collected' || entry.stage === 'recovered') && payment.kind === 'REFUND') {
        throw new ApiError(422, 'UNVERIFIED_COLLECTION', 'Collected revenue cannot reference a refund');
      }
    }
    const record: RevenueLedgerEntry = {
      ...structuredClone(entry),
      id: randomUUID(),
      tenantId,
      occurredAt: now,
    };
    this.revenueEntries.push(record);
    return structuredClone(record);
  }

  async createFollowUp(
    tenantId: string,
    _actor: AuthenticatedIdentity,
    input: Pick<FollowUpJobRecord, 'conversationId' | 'customerId' | 'channel' | 'reason' | 'dueAt' | 'idempotencyKey' | 'draftMessage'>,
    now: string,
  ): Promise<FollowUpJobRecord> {
    const conversation = this.conversations.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === input.conversationId,
    );
    if (!conversation || conversation.customerId !== input.customerId) {
      throw new ApiError(422, 'INVALID_FOLLOW_UP_CONTEXT', 'Follow-up context does not match the tenant conversation');
    }
    const existing = this.followUps.find(
      (candidate) => candidate.tenantId === tenantId && candidate.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return structuredClone(existing);
    const followUp: FollowUpJobRecord = {
      id: randomUUID(),
      tenantId,
      conversationId: input.conversationId,
      customerId: input.customerId,
      channel: input.channel,
      reason: input.reason,
      status: 'scheduled',
      dueAt: input.dueAt,
      attemptCount: 0,
      maxAttempts: 5,
      leaseOwner: null,
      leaseExpiresAt: null,
      retryAt: null,
      lastError: null,
      stopReason: null,
      manualOverride: false,
      lastResponseAt: null,
      completedAt: null,
      cancelledAt: null,
      idempotencyKey: input.idempotencyKey,
      draftMessage: input.draftMessage,
      createdAt: now,
    };
    this.followUps.push(followUp);
    return structuredClone(followUp);
  }

  async cancelFollowUp(
    tenantId: string,
    followUpId: string,
    _actor: AuthenticatedIdentity,
    now: string,
  ): Promise<FollowUpJobRecord | null> {
    const followUp = this.followUps.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === followUpId,
    );
    if (!followUp) return null;
    if (followUp.status !== 'completed') {
      followUp.status = 'cancelled';
      followUp.cancelledAt = now;
      followUp.stopReason = 'MANUAL_OVERRIDE';
      followUp.manualOverride = true;
      followUp.leaseOwner = null;
      followUp.leaseExpiresAt = null;
    }
    return structuredClone(followUp);
  }

  async claimDueFollowUp(workerId: string, now: string, leaseUntil: string): Promise<FollowUpJobRecord | null> {
    const due = this.followUps
      .filter(
        (candidate) =>
          (candidate.status === 'scheduled' || candidate.status === 'failed' ||
            (candidate.status === 'leased' && Boolean(candidate.leaseExpiresAt && candidate.leaseExpiresAt <= now))) &&
          (candidate.retryAt ?? candidate.dueAt) <= now &&
          candidate.attemptCount < candidate.maxAttempts,
      )
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))[0];
    if (!due) return null;
    due.status = 'leased';
    due.leaseOwner = workerId;
    due.leaseExpiresAt = leaseUntil;
    return structuredClone(due);
  }

  async completeFollowUp(
    followUpId: string,
    workerId: string,
    attemptKey: string,
    now: string,
  ): Promise<void> {
    if (this.followUpAttempts.has(attemptKey)) return;
    const followUp = this.requireLeasedFollowUp(followUpId, workerId);
    this.followUpAttempts.add(attemptKey);
    followUp.attemptCount += 1;
    followUp.status = 'completed';
    followUp.completedAt = now;
    followUp.leaseOwner = null;
    followUp.leaseExpiresAt = null;
  }

  async failFollowUp(
    followUpId: string,
    workerId: string,
    attemptKey: string,
    errorCode: string,
    retryAt: string | null,
  ): Promise<void> {
    if (this.followUpAttempts.has(attemptKey)) return;
    const followUp = this.requireLeasedFollowUp(followUpId, workerId);
    this.followUpAttempts.add(attemptKey);
    followUp.attemptCount += 1;
    followUp.status = 'failed';
    followUp.lastError = errorCode;
    followUp.retryAt = retryAt;
    followUp.leaseOwner = null;
    followUp.leaseExpiresAt = null;
  }

  async executeCopilot(
    tenantId: string,
    _actor: AuthenticatedIdentity,
    input: CopilotExecutionInput,
    now: string,
  ): Promise<CopilotExecutionResult> {
    const existing = this.copilotAudits.get(`${tenantId}:${input.idempotencyKey}`);
    if (existing) return { ...structuredClone(existing), status: 'replayed' };
    let mutationResult: Record<string, unknown> = {};
    if (input.tool === 'GET_REVENUE_OVERVIEW') {
      mutationResult = { revenue: await this.getRevenueSummary(tenantId) };
    }
    if (input.tool === 'GET_REACTIVATION_CANDIDATES') {
      mutationResult = {
        candidates: this.leads
          .filter((lead) => lead.tenantId === tenantId && lead.status === 'LOST' && lead.marketingAllowed)
          .map((lead) => ({ leadId: lead.id, customerId: lead.customerId })),
      };
    }
    if (input.tool === 'GET_HOT_LEADS') {
      mutationResult = {
        leads: this.leads
          .filter((lead) => lead.tenantId === tenantId && ['NEW', 'ACTIVE'].includes(lead.status))
          .map((lead) => ({ leadId: lead.id, customerId: lead.customerId, conversationId: lead.conversationId })),
      };
    }
    if (input.tool === 'GET_UNANSWERED_CONVERSATIONS') {
      mutationResult = {
        conversations: this.conversations
          .filter((conversation) => conversation.tenantId === tenantId && conversation.mode !== 'CLOSED')
          .map((conversation) => ({ conversationId: conversation.id, customerId: conversation.customerId })),
      };
    }
    if (input.tool === 'PREPARE_REACTIVATION') {
      const leadId = input.arguments.leadId;
      const lead = this.leads.find(
        (candidate) => candidate.tenantId === tenantId && candidate.id === leadId,
      );
      if (!lead || lead.status !== 'LOST' || !lead.marketingAllowed) {
        throw new ApiError(422, 'REACTIVATION_NOT_ELIGIBLE', 'The opportunity is not eligible for reactivation');
      }
      const conversation = this.conversations.find(
        (candidate) => candidate.tenantId === tenantId && candidate.id === lead.conversationId,
      );
      if (!conversation || conversation.mode === 'HUMAN_ACTIVE') {
        throw new ApiError(422, 'REACTIVATION_NOT_ELIGIBLE', 'The opportunity is not eligible for reactivation');
      }
      const followUp = await this.createFollowUp(
        tenantId,
        _actor,
        {
          conversationId: lead.conversationId,
          customerId: lead.customerId,
          channel: conversation.channel,
          reason: 'Owner-approved reactivation',
          dueAt: now,
          idempotencyKey: `${input.idempotencyKey}:follow-up`,
          draftMessage: null,
        },
        now,
      );
      lead.status = 'ACTIVE';
      mutationResult = { followUpId: followUp.id, leadId: lead.id };
    }
    const result: CopilotExecutionResult = {
      auditId: randomUUID(),
      status: 'executed',
      result: {
        tool: input.tool,
        acceptedAt: now,
        argumentKeys: Object.keys(input.arguments).sort(),
        ...mutationResult,
      },
    };
    this.copilotAudits.set(`${tenantId}:${input.idempotencyKey}`, result);
    return structuredClone(result);
  }

  async findWebhookEndpoint(provider: string, endpointId: string): Promise<WebhookEndpoint | null> {
    return structuredClone(
      this.webhookEndpoints.find(
        (endpoint) => endpoint.provider === provider && endpoint.endpointId === endpointId,
      ) ?? null,
    );
  }

  async recordWebhookEvent(
    endpoint: WebhookEndpoint,
    providerEventId: string,
    payloadHash: string,
    now: string,
  ): Promise<WebhookEventRecord> {
    const existing = this.webhookEvents.find(
      (event) => event.provider === endpoint.provider && event.providerEventId === providerEventId,
    );
    if (existing) {
      if (existing.tenantId !== endpoint.tenantId || existing.payloadHash !== payloadHash) {
        throw new ApiError(409, 'WEBHOOK_REPLAY_CONFLICT', 'Webhook event ID was reused');
      }
      return { ...structuredClone(existing), replayed: true };
    }
    const event: WebhookEventRecord = {
      id: randomUUID(),
      tenantId: endpoint.tenantId,
      provider: endpoint.provider,
      providerEventId,
      receivedAt: now,
      verified: true,
      payloadHash,
      processingState: 'received',
      replayed: false,
    };
    this.webhookEvents.push(event);
    return structuredClone(event);
  }

  async markWebhookProcessed(eventId: string): Promise<void> {
    const event = this.webhookEvents.find((candidate) => candidate.id === eventId);
    if (event) event.processingState = 'processed';
  }

  private requireCustomerAndLead(tenantId: string, customerId: string, leadId: string): void {
    const customer = this.customers.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === customerId,
    );
    const lead = this.leads.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === leadId,
    );
    if (!customer || !lead || lead.customerId !== customerId) {
      throw new ApiError(422, 'INVALID_JOURNEY_CONTEXT', 'Commercial references do not belong together');
    }
  }

  private requireLeasedFollowUp(followUpId: string, workerId: string): FollowUpJobRecord {
    const followUp = this.followUps.find((candidate) => candidate.id === followUpId);
    if (!followUp || followUp.status !== 'leased' || followUp.leaseOwner !== workerId) {
      throw new ApiError(409, 'FOLLOW_UP_LEASE_LOST', 'Follow-up lease is no longer owned by this worker');
    }
    return followUp;
  }
}
