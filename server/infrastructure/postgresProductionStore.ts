import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../application/errors.js';
import { stableHash } from '../application/idempotency.js';
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

export class PostgresProductionStore implements ProductionStore {
  constructor(private readonly pool: Pool) {}

  async provisionTenant(
    actor: AuthenticatedIdentity,
    input: TenantProvisionInput,
    now: string,
  ): Promise<TenantProvisionResult> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${actor.userId}:${input.idempotencyKey}`,
      ]);
      const appUser = await client.query(
        `INSERT INTO app_users (id, auth_subject, email, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $3)
         ON CONFLICT (auth_subject) DO UPDATE
           SET email = COALESCE(EXCLUDED.email, app_users.email), updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [actor.userId, actor.email, now],
      );
      const appUserId = String(appUser.rows[0]?.id);
      const requestHash = stableHash({ name: input.name });
      const existing = await client.query(
        `SELECT request_hash, tenant_id FROM organization_provisioning_requests
         WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [appUserId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Provisioning key was reused with different input');
        }
        return { tenantId: String(existing.rows[0].tenant_id), role: 'owner', replayed: true };
      }
      const tenant = await client.query(
        `INSERT INTO tenants (name, created_at, updated_at) VALUES ($1, $2, $2) RETURNING id`,
        [input.name, now],
      );
      const tenantId = String(tenant.rows[0]?.id);
      await client.query(
        `INSERT INTO organization_memberships
          (tenant_id, user_id, role, active, created_at, updated_at)
         VALUES ($1, $2, 'owner', true, $3, $3)`,
        [tenantId, appUserId, now],
      );
      await client.query(
        `INSERT INTO organization_provisioning_requests
          (user_id, idempotency_key, request_hash, tenant_id, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [appUserId, input.idempotencyKey, requestHash, tenantId, now],
      );
      return { tenantId, role: 'owner', replayed: false };
    });
  }

  async listMemberships(userId: string): Promise<OrganizationMembership[]> {
    const result = await this.pool.query(
      `SELECT membership.tenant_id, tenant.name, membership.role, membership.active
       FROM organization_memberships membership
       JOIN app_users app_user ON app_user.id = membership.user_id
       JOIN tenants tenant ON tenant.id = membership.tenant_id
       WHERE app_user.auth_subject = $1 AND membership.active
       ORDER BY tenant.name`,
      [userId],
    );
    return result.rows.map((row) => ({
      tenantId: String(row.tenant_id),
      tenantName: String(row.name),
      role: row.role as OrganizationMembership['role'],
      active: Boolean(row.active),
    }));
  }

  async getMembership(userId: string, tenantId: string): Promise<OrganizationMembership | null> {
    const result = await this.pool.query(
      `SELECT membership.tenant_id, tenant.name, membership.role, membership.active
       FROM organization_memberships membership
       JOIN app_users app_user ON app_user.id = membership.user_id
       JOIN tenants tenant ON tenant.id = membership.tenant_id
       WHERE app_user.auth_subject = $1 AND membership.tenant_id = $2`,
      [userId, tenantId],
    );
    const row = result.rows[0];
    return row
      ? {
          tenantId: String(row.tenant_id),
          tenantName: String(row.name),
          role: row.role as OrganizationMembership['role'],
          active: Boolean(row.active),
        }
      : null;
  }

  async listCustomers(tenantId: string): Promise<CustomerRecord[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, display_name, phone, email, created_at
       FROM customers WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      displayName: String(row.display_name),
      phone: String(row.phone),
      email: row.email === null ? null : String(row.email),
      createdAt: asIso(row.created_at),
    }));
  }

  async listConversations(tenantId: string): Promise<ConversationRecord[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, customer_id, lead_id, channel, mode, created_at
       FROM conversations WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      customerId: String(row.customer_id),
      leadId: String(row.lead_id),
      channel: String(row.channel),
      mode: row.mode as ConversationRecord['mode'],
      createdAt: asIso(row.created_at),
    }));
  }

  async getRevenueSummary(tenantId: string): Promise<RevenueSummary> {
    const result = await this.pool.query(
      `SELECT stage, COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
       FROM revenue_ledger_events WHERE tenant_id = $1 GROUP BY stage`,
      [tenantId],
    );
    const totals: RevenueSummary = {
      potentialCents: 0,
      pipelineCents: 0,
      bookedCents: 0,
      collectedCents: 0,
      refundedCents: 0,
      recoveredCents: 0,
    };
    for (const row of result.rows) {
      const amount = Number(row.amount_cents);
      if (row.stage === 'potential') totals.potentialCents = amount;
      if (row.stage === 'pipeline') totals.pipelineCents = amount;
      if (row.stage === 'booked') totals.bookedCents = amount;
      if (row.stage === 'collected') totals.collectedCents = amount;
      if (row.stage === 'refunded') totals.refundedCents = amount;
      if (row.stage === 'recovered') totals.recoveredCents = amount;
    }
    totals.collectedCents = Math.max(0, totals.collectedCents - totals.refundedCents);
    return totals;
  }

  async listConnectorConfigurations(tenantId: string): Promise<ConnectorConfigurationView[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, provider, enabled, execution_mode, webhook_endpoint_id,
              (credential_secret_reference IS NOT NULL) AS secret_configured
       FROM connector_configurations WHERE tenant_id = $1 ORDER BY provider`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      provider: String(row.provider),
      enabled: Boolean(row.enabled),
      mode: row.execution_mode as ConnectorConfigurationView['mode'],
      secretConfigured: Boolean(row.secret_configured),
      webhookEndpointId: String(row.webhook_endpoint_id),
    }));
  }

  async startHumanTakeover(
    tenantId: string,
    conversationId: string,
    actor: AuthenticatedIdentity,
    reason: string,
    now: string,
  ): Promise<{ conversationId: string; handoffId: string; mode: 'HUMAN_ACTIVE' }> {
    return this.transaction(async (client) => {
      const conversation = await client.query(
        `SELECT id, mode FROM conversations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, conversationId],
      );
      if (!conversation.rows[0]) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
      const active = await client.query(
        `SELECT id FROM human_handoffs
         WHERE tenant_id = $1 AND conversation_id = $2 AND resolved_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
        [tenantId, conversationId],
      );
      let handoffId = active.rows[0] ? String(active.rows[0].id) : '';
      if (!handoffId) {
        const handoff = await client.query(
          `INSERT INTO human_handoffs
            (tenant_id, conversation_id, reason, detail, responsible_state, started_by,
             started_at, created_at, updated_at)
           VALUES ($1,$2,'MANUAL',$3,'HUMAN_REVIEW','HUMAN',$4,$4,$4) RETURNING id`,
          [tenantId, conversationId, reason, now],
        );
        handoffId = String(handoff.rows[0]?.id);
      }
      await client.query(
        `UPDATE conversations
         SET mode = 'HUMAN_ACTIVE', automation_enabled = false, updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, conversationId, now],
      );
      await client.query(
        `UPDATE follow_up_jobs
         SET status = 'cancelled', cancelled_at = $3, stop_reason = 'HUMAN_TAKEOVER', updated_at = $3
         WHERE tenant_id = $1 AND conversation_id = $2 AND status IN ('scheduled','failed')`,
        [tenantId, conversationId, now],
      );
      await this.insertAudit(client, tenantId, actor, 'handoff.started', 'conversation', conversationId, now);
      return { conversationId, handoffId, mode: 'HUMAN_ACTIVE' };
    });
  }

  async resumeAssistant(
    tenantId: string,
    conversationId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<{ conversationId: string; mode: 'AI_ACTIVE' }> {
    return this.transaction(async (client) => {
      const conversation = await client.query(
        `SELECT id, mode FROM conversations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, conversationId],
      );
      if (!conversation.rows[0]) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
      const resolved = await client.query(
        `UPDATE human_handoffs SET resolved_at = $3, updated_at = $3
         WHERE tenant_id = $1 AND conversation_id = $2 AND resolved_at IS NULL
         RETURNING id`,
        [tenantId, conversationId, now],
      );
      if (conversation.rows[0].mode !== 'HUMAN_ACTIVE' || resolved.rowCount !== 1) {
        throw new ApiError(409, 'NO_ACTIVE_HANDOFF', 'No active Human Takeover can be resumed');
      }
      await client.query(
        `UPDATE conversations SET mode = 'AI_ACTIVE', automation_enabled = true, updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, conversationId, now],
      );
      await this.insertAudit(client, tenantId, actor, 'handoff.resumed', 'conversation', conversationId, now);
      return { conversationId, mode: 'AI_ACTIVE' };
    });
  }

  async beginIdempotency(
    tenantId: string,
    scope: string,
    key: string,
    requestHash: string,
    now: string,
  ): Promise<IdempotencyBeginResult> {
    return this.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO idempotency_records
          (tenant_id, scope, idempotency_key, request_hash, status, started_at)
         VALUES ($1, $2, $3, $4, 'started', $5)
         ON CONFLICT DO NOTHING
         RETURNING idempotency_key`,
        [tenantId, scope, key, requestHash, now],
      );
      if (inserted.rowCount === 1) return { state: 'started' };
      const existing = await client.query(
        `SELECT request_hash, status, response_json
         FROM idempotency_records
         WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3
         FOR UPDATE`,
        [tenantId, scope, key],
      );
      const row = existing.rows[0];
      if (!row || row.request_hash !== requestHash) return { state: 'conflict' };
      if (row.status !== 'completed') return { state: 'in_progress' };
      return { state: 'replay', response: row.response_json };
    });
  }

  async completeIdempotency(
    tenantId: string,
    scope: string,
    key: string,
    response: unknown,
    now: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_records
       SET status = 'completed', response_json = $4, completed_at = $5
       WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3`,
      [tenantId, scope, key, JSON.stringify(response), now],
    );
  }

  async abandonIdempotency(tenantId: string, scope: string, key: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM idempotency_records
       WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3 AND status = 'started'`,
      [tenantId, scope, key],
    );
  }

  async createJourney(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: JourneyCreationInput,
    now: string,
  ): Promise<JourneyCreationResult> {
    return this.transaction(async (client) => {
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      const customer = await client.query(
        `INSERT INTO customers (tenant_id, display_name, phone, email, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [tenantId, input.customer.displayName, input.customer.phone, input.customer.email, now],
      );
      const customerId = String(customer.rows[0]?.id);
      const lead = await client.query(
        `INSERT INTO leads
          (tenant_id, customer_id, source, workflow_type, service_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [tenantId, customerId, input.lead.source, input.lead.workflowType, input.lead.serviceId, now],
      );
      const leadId = String(lead.rows[0]?.id);
      const conversation = await client.query(
        `INSERT INTO conversations
          (tenant_id, customer_id, lead_id, channel, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [tenantId, customerId, leadId, input.conversation.channel, now],
      );
      const conversationId = String(conversation.rows[0]?.id);
      await client.query(
        'UPDATE leads SET conversation_id = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2',
        [tenantId, leadId, conversationId, now],
      );
      await this.insertAudit(client, tenantId, actor, 'journey.created', 'lead', leadId, now);
      return { customerId, leadId, conversationId, replayed: false };
    });
  }

  async createBooking(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: BookingCreationInput,
    now: string,
  ): Promise<{ bookingId: string }> {
    return this.transaction(async (client) => {
      await this.assertJourneyContext(client, tenantId, input.customerId, input.leadId);
      const service = await client.query(
        'SELECT id FROM services WHERE tenant_id = $1 AND id = $2 AND active',
        [tenantId, input.serviceId],
      );
      if (service.rowCount !== 1) throw new ApiError(422, 'INVALID_SERVICE', 'Service is not available');
      const overlap = await client.query(
        `SELECT id FROM bookings
         WHERE tenant_id = $1 AND staff_user_id = $2 AND status <> 'CANCELLED'
           AND start_at < $4 AND end_at > $3
         FOR UPDATE`,
        [tenantId, input.staffId, input.startAt, input.endAt],
      );
      if ((overlap.rowCount ?? 0) > 0) throw new ApiError(409, 'BOOKING_CONFLICT', 'The slot is no longer available');
      const result = await client.query(
        `INSERT INTO bookings
          (tenant_id, customer_id, lead_id, service_id, staff_user_id, start_at, end_at,
           total_cents, deposit_required_cents, idempotency_key, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
        [tenantId, input.customerId, input.leadId, input.serviceId, input.staffId,
          input.startAt, input.endAt, input.totalCents, input.depositRequiredCents,
          input.idempotencyKey, now],
      );
      const bookingId = String(result.rows[0]?.id);
      await this.insertAudit(client, tenantId, actor, 'booking.created', 'booking', bookingId, now);
      return { bookingId };
    });
  }

  async createPayment(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: PaymentCreationInput,
    now: string,
  ): Promise<PaymentCreationResult> {
    return this.transaction(async (client) => {
      await this.assertJourneyContext(client, tenantId, input.customerId, input.leadId, input.conversationId);
      await this.assertPaymentReference(client, tenantId, input.referenceType, input.referenceId, input.customerId, input.leadId);
      if (input.kind === 'REFUND') {
        const original = await client.query(
          `SELECT amount_cents, customer_id, kind FROM payments
           WHERE tenant_id = $1 AND id = $2 AND status = 'COLLECTED' FOR UPDATE`,
          [tenantId, input.originalPaymentId],
        );
        const row = original.rows[0];
        if (!row || row.kind === 'REFUND' || String(row.customer_id) !== input.customerId) {
          throw new ApiError(422, 'INVALID_REFUND_REFERENCE', 'Refund must reference a collected tenant payment');
        }
        const refunded = await client.query(
          `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS amount
           FROM payments WHERE tenant_id = $1 AND original_payment_id = $2 AND status = 'COLLECTED'`,
          [tenantId, input.originalPaymentId],
        );
        if (Number(refunded.rows[0]?.amount ?? 0) + input.amountCents > Number(row.amount_cents)) {
          throw new ApiError(422, 'REFUND_EXCEEDS_PAYMENT', 'Refund exceeds the collected payment');
        }
      }
      const result = await client.query(
        `INSERT INTO payments
          (tenant_id, customer_id, lead_id, conversation_id, reference_type, reference_id,
           kind, amount_cents, original_payment_id, idempotency_key, collected_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$11) RETURNING id`,
        [tenantId, input.customerId, input.leadId, input.conversationId, input.referenceType,
          input.referenceId, input.kind, input.amountCents, input.originalPaymentId,
          input.idempotencyKey, now],
      );
      const paymentId = String(result.rows[0]?.id);
      await this.insertAudit(client, tenantId, actor, 'payment.recorded', 'payment', paymentId, now);
      return { paymentId, replayed: false };
    });
  }

  async appendRevenueEntry(
    tenantId: string,
    actor: AuthenticatedIdentity,
    entry: Omit<RevenueLedgerEntry, 'id' | 'tenantId' | 'occurredAt'>,
    now: string,
  ): Promise<RevenueLedgerEntry> {
    return this.transaction(async (client) => {
      await this.assertJourneyContext(client, tenantId, entry.customerId, entry.leadId, entry.conversationId);
      if (['collected', 'refunded', 'recovered'].includes(entry.stage)) {
        const payment = await client.query(
          `SELECT amount_cents, kind FROM payments
           WHERE tenant_id = $1 AND id = $2 AND customer_id = $3 AND lead_id = $4 AND status = 'COLLECTED'`,
          [tenantId, entry.paymentId, entry.customerId, entry.leadId],
        );
        const row = payment.rows[0];
        if (!row || Number(row.amount_cents) !== entry.amountCents) {
          throw new ApiError(422, 'UNVERIFIED_REVENUE', 'Revenue requires a matching validated payment');
        }
        if ((entry.stage === 'refunded') !== (row.kind === 'REFUND')) {
          throw new ApiError(422, 'INVALID_REVENUE_STAGE', 'Revenue stage does not match payment truth');
        }
      }
      if (entry.paymentId && ['collected', 'refunded'].includes(entry.stage)) {
        const duplicateStage = await client.query(
          `SELECT id FROM revenue_ledger_events
           WHERE tenant_id = $1 AND payment_id = $2 AND stage = $3`,
          [tenantId, entry.paymentId, entry.stage],
        );
        if (duplicateStage.rowCount === 1) {
          throw new ApiError(409, 'DUPLICATE_FINANCIAL_EVENT', 'The payment already has this financial event');
        }
      }
      const result = await client.query(
        `INSERT INTO revenue_ledger_events
          (tenant_id, customer_id, lead_id, conversation_id, payment_id, stage,
           amount_cents, causation_key, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, tenant_id, customer_id, lead_id, conversation_id, payment_id,
                   stage, amount_cents, causation_key, occurred_at`,
        [tenantId, entry.customerId, entry.leadId, entry.conversationId, entry.paymentId,
          entry.stage, entry.amountCents, entry.causationKey, now],
      );
      const record = revenueRow(result.rows[0]);
      await this.insertAudit(client, tenantId, actor, 'revenue.appended', 'revenue_event', record.id, now);
      return record;
    });
  }

  async createFollowUp(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: Pick<FollowUpJobRecord, 'conversationId' | 'customerId' | 'channel' | 'reason' | 'dueAt' | 'idempotencyKey' | 'draftMessage'>,
    now: string,
  ): Promise<FollowUpJobRecord> {
    return this.transaction(async (client) => {
      const context = await client.query(
        `SELECT id FROM conversations WHERE tenant_id = $1 AND id = $2 AND customer_id = $3`,
        [tenantId, input.conversationId, input.customerId],
      );
      if (context.rowCount !== 1) throw new ApiError(422, 'INVALID_FOLLOW_UP_CONTEXT', 'Follow-up context is invalid');
      const result = await client.query(
        `INSERT INTO follow_up_jobs
          (tenant_id, conversation_id, customer_id, channel, reason, due_at,
           idempotency_key, draft_message, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [tenantId, input.conversationId, input.customerId, input.channel, input.reason,
          input.dueAt, input.idempotencyKey, input.draftMessage, now],
      );
      const record = followUpRow(result.rows[0]);
      await this.insertAudit(client, tenantId, actor, 'follow_up.created', 'follow_up', record.id, now);
      return record;
    });
  }

  async cancelFollowUp(
    tenantId: string,
    followUpId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<FollowUpJobRecord | null> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE follow_up_jobs
         SET status = CASE WHEN status = 'completed' THEN status ELSE 'cancelled' END,
             cancelled_at = CASE WHEN status = 'completed' THEN cancelled_at ELSE $3 END,
             stop_reason = CASE WHEN status = 'completed' THEN stop_reason ELSE 'MANUAL_OVERRIDE' END,
             manual_override = CASE WHEN status = 'completed' THEN manual_override ELSE true END,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, followUpId, now],
      );
      const row = result.rows[0];
      if (!row) return null;
      await this.insertAudit(client, tenantId, actor, 'follow_up.cancelled', 'follow_up', followUpId, now);
      return followUpRow(row);
    });
  }

  async claimDueFollowUp(workerId: string, now: string, leaseUntil: string): Promise<FollowUpJobRecord | null> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `WITH candidate AS (
           SELECT id FROM follow_up_jobs
           WHERE status IN ('scheduled', 'failed', 'leased')
             AND CASE WHEN status = 'leased' THEN lease_expires_at <= $1 ELSE COALESCE(retry_at, due_at) <= $1 END
             AND attempt_count < max_attempts
           ORDER BY COALESCE(retry_at, due_at), created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE follow_up_jobs job
         SET status = 'leased', lease_owner = $2, lease_expires_at = $3, updated_at = $1
         FROM candidate WHERE job.id = candidate.id
         RETURNING job.*`,
        [now, workerId, leaseUntil],
      );
      return result.rows[0] ? followUpRow(result.rows[0]) : null;
    });
  }

  async completeFollowUp(
    followUpId: string,
    workerId: string,
    attemptKey: string,
    now: string,
  ): Promise<void> {
    await this.finishFollowUp(followUpId, workerId, attemptKey, 'sent', null, null, now);
  }

  async failFollowUp(
    followUpId: string,
    workerId: string,
    attemptKey: string,
    errorCode: string,
    retryAt: string | null,
    now: string,
  ): Promise<void> {
    await this.finishFollowUp(followUpId, workerId, attemptKey, 'failed', errorCode, retryAt, now);
  }

  async executeCopilot(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: CopilotExecutionInput,
    now: string,
  ): Promise<CopilotExecutionResult> {
    return this.transaction(async (client) => {
      let mutationResult: Record<string, unknown> = {};
      if (input.tool === 'GET_REVENUE_OVERVIEW') {
        const revenue = await client.query(
          `SELECT stage, COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
           FROM revenue_ledger_events WHERE tenant_id = $1 GROUP BY stage`,
          [tenantId],
        );
        mutationResult = {
          revenue: Object.fromEntries(revenue.rows.map((row) => [String(row.stage), Number(row.amount_cents)])),
        };
      }
      if (input.tool === 'GET_REACTIVATION_CANDIDATES') {
        const candidates = await client.query(
          `SELECT lead.id AS lead_id, lead.customer_id
           FROM leads lead
           JOIN customers customer ON customer.tenant_id = lead.tenant_id AND customer.id = lead.customer_id
           WHERE lead.tenant_id = $1 AND lead.status = 'LOST'
             AND customer.marketing_allowed AND NOT customer.opted_out`,
          [tenantId],
        );
        mutationResult = {
          candidates: candidates.rows.map((row) => ({
            leadId: String(row.lead_id),
            customerId: String(row.customer_id),
          })),
        };
      }
      if (input.tool === 'GET_HOT_LEADS') {
        const leads = await client.query(
          `SELECT id AS lead_id, customer_id, conversation_id, priority
           FROM leads WHERE tenant_id = $1 AND status IN ('NEW','ACTIVE','QUALIFIED')
             AND priority IN ('HIGH','URGENT') ORDER BY updated_at DESC LIMIT 100`,
          [tenantId],
        );
        mutationResult = { leads: leads.rows.map((row) => ({
          leadId: String(row.lead_id),
          customerId: String(row.customer_id),
          conversationId: String(row.conversation_id),
          priority: String(row.priority),
        })) };
      }
      if (input.tool === 'GET_UNANSWERED_CONVERSATIONS') {
        const conversations = await client.query(
          `SELECT id AS conversation_id, customer_id, last_customer_message_at
           FROM conversations
           WHERE tenant_id = $1 AND mode <> 'CLOSED'
             AND last_customer_message_at IS NOT NULL
             AND (last_business_response_at IS NULL OR last_customer_message_at > last_business_response_at)
           ORDER BY last_customer_message_at LIMIT 100`,
          [tenantId],
        );
        mutationResult = { conversations: conversations.rows.map((row) => ({
          conversationId: String(row.conversation_id),
          customerId: String(row.customer_id),
          waitingSince: asIso(row.last_customer_message_at),
        })) };
      }
      if (input.tool === 'PREPARE_REACTIVATION') {
        const leadId = typeof input.arguments.leadId === 'string' ? input.arguments.leadId : null;
        if (!leadId) throw new ApiError(400, 'INVALID_TOOL_ARGUMENTS', 'A lead is required');
        const eligible = await client.query(
          `SELECT lead.id, lead.customer_id, lead.conversation_id, conversation.channel
           FROM leads lead
           JOIN customers customer ON customer.tenant_id = lead.tenant_id AND customer.id = lead.customer_id
           JOIN conversations conversation ON conversation.tenant_id = lead.tenant_id AND conversation.id = lead.conversation_id
           WHERE lead.tenant_id = $1 AND lead.id = $2 AND lead.status = 'LOST'
             AND customer.marketing_allowed AND NOT customer.opted_out
             AND conversation.mode NOT IN ('HUMAN_ACTIVE','PAUSED','CLOSED')
           FOR UPDATE OF lead`,
          [tenantId, leadId],
        );
        const row = eligible.rows[0];
        if (!row) throw new ApiError(422, 'REACTIVATION_NOT_ELIGIBLE', 'The opportunity is not eligible for reactivation');
        const followUp = await client.query(
          `INSERT INTO follow_up_jobs
            (tenant_id, conversation_id, customer_id, channel, reason, due_at,
             idempotency_key, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'Owner-approved reactivation',$5,$6,$5,$5)
           ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET updated_at = follow_up_jobs.updated_at
           RETURNING id`,
          [tenantId, row.conversation_id, row.customer_id, row.channel, now, `${input.idempotencyKey}:follow-up`],
        );
        await client.query(
          `UPDATE leads SET status = 'ACTIVE', sales_state = 'reactivation', closed_at = NULL,
             lost_reason = NULL, updated_at = $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, leadId, now],
        );
        mutationResult = { followUpId: String(followUp.rows[0]?.id), leadId };
      }
      const resultPayload = {
        tool: input.tool,
        acceptedAt: now,
        argumentKeys: Object.keys(input.arguments).sort(),
        ...mutationResult,
      };
      const result = await client.query(
        `INSERT INTO copilot_action_audits
          (tenant_id, actor_user_id, tool, arguments_json, authorization_decision,
           approval_state, execution_result, idempotency_key, created_at)
         SELECT $1, app_user.id, $3, $4, 'allowed', $5, $6, $7, $8
         FROM app_users app_user WHERE app_user.auth_subject = $2
         RETURNING id`,
        [tenantId, actor.userId, input.tool, JSON.stringify(redactArguments(input.arguments)),
          input.approved ? 'approved' : 'not_required', JSON.stringify(resultPayload),
          input.idempotencyKey, now],
      );
      if (result.rowCount !== 1) throw new ApiError(401, 'UNKNOWN_ACTOR', 'Authenticated actor is not provisioned');
      return { auditId: String(result.rows[0]?.id), status: 'executed', result: resultPayload };
    });
  }

  async findWebhookEndpoint(provider: string, endpointId: string): Promise<WebhookEndpoint | null> {
    const result = await this.pool.query(
      `SELECT tenant_id, provider, webhook_endpoint_id, signing_secret_reference, enabled
       FROM connector_configurations
       WHERE provider = $1 AND webhook_endpoint_id = $2`,
      [provider, endpointId],
    );
    const row = result.rows[0];
    return row && row.signing_secret_reference
      ? {
          tenantId: String(row.tenant_id),
          provider: String(row.provider),
          endpointId: String(row.webhook_endpoint_id),
          signingSecretReference: String(row.signing_secret_reference),
          enabled: Boolean(row.enabled),
        }
      : null;
  }

  async recordWebhookEvent(
    endpoint: WebhookEndpoint,
    providerEventId: string,
    payloadHash: string,
    now: string,
  ): Promise<WebhookEventRecord> {
    const inserted = await this.pool.query(
      `INSERT INTO webhook_events
        (tenant_id, provider, provider_event_id, received_at, verified, payload_hash)
       VALUES ($1,$2,$3,$4,true,$5)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING *`,
      [endpoint.tenantId, endpoint.provider, providerEventId, now, payloadHash],
    );
    if (inserted.rows[0]) return webhookRow(inserted.rows[0], false);
    const existing = await this.pool.query(
      `SELECT * FROM webhook_events WHERE provider = $1 AND provider_event_id = $2`,
      [endpoint.provider, providerEventId],
    );
    const row = existing.rows[0];
    if (!row || String(row.tenant_id) !== endpoint.tenantId || row.payload_hash !== payloadHash) {
      throw new ApiError(409, 'WEBHOOK_REPLAY_CONFLICT', 'Webhook event ID was reused');
    }
    return webhookRow(row, true);
  }

  async markWebhookProcessed(eventId: string, now: string): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_events
       SET processing_state = 'processed', processed_at = $2,
           processing_attempt_count = processing_attempt_count + 1, next_attempt_at = NULL
       WHERE id = $1`,
      [eventId, now],
    );
  }

  private async finishFollowUp(
    followUpId: string,
    workerId: string,
    attemptKey: string,
    result: 'sent' | 'failed',
    errorCode: string | null,
    retryAt: string | null,
    now: string,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const locked = await client.query(
        `SELECT * FROM follow_up_jobs WHERE id = $1 FOR UPDATE`,
        [followUpId],
      );
      const row = locked.rows[0];
      if (!row || row.status !== 'leased' || row.lease_owner !== workerId) {
        throw new ApiError(409, 'FOLLOW_UP_LEASE_LOST', 'Follow-up lease is no longer owned');
      }
      const inserted = await client.query(
        `INSERT INTO follow_up_attempts
          (tenant_id, follow_up_job_id, attempt_key, result, error_code, attempted_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [row.tenant_id, followUpId, attemptKey, result, errorCode, now],
      );
      if (inserted.rowCount !== 1) return;
      await client.query(
        `UPDATE follow_up_jobs
         SET status = $2, attempt_count = attempt_count + 1,
             completed_at = CASE WHEN $2 = 'completed' THEN $3 ELSE completed_at END,
             retry_at = $4, last_error = $5, lease_owner = NULL, lease_expires_at = NULL,
             updated_at = $3
         WHERE id = $1`,
        [followUpId, result === 'sent' ? 'completed' : 'failed', now, retryAt, errorCode],
      );
    });
  }

  private async assertJourneyContext(
    client: PoolClient,
    tenantId: string,
    customerId: string,
    leadId: string,
    conversationId?: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT lead.id
       FROM leads lead JOIN customers customer
         ON customer.tenant_id = lead.tenant_id AND customer.id = lead.customer_id
       WHERE lead.tenant_id = $1 AND customer.id = $2 AND lead.id = $3
         AND ($4::uuid IS NULL OR lead.conversation_id = $4)`,
      [tenantId, customerId, leadId, conversationId ?? null],
    );
    if (result.rowCount !== 1) throw new ApiError(422, 'INVALID_JOURNEY_CONTEXT', 'Commercial references do not belong together');
  }

  private async assertPaymentReference(
    client: PoolClient,
    tenantId: string,
    referenceType: PaymentCreationInput['referenceType'],
    referenceId: string,
    customerId: string,
    leadId: string,
  ): Promise<void> {
    const table = referenceType === 'APPOINTMENT' ? 'bookings' : referenceType === 'QUOTE' ? 'quotes' : 'jobs';
    const result = await client.query(
      `SELECT id FROM ${table} WHERE tenant_id = $1 AND id = $2 AND customer_id = $3 AND lead_id = $4`,
      [tenantId, referenceId, customerId, leadId],
    );
    if (result.rowCount !== 1) throw new ApiError(422, 'INVALID_PAYMENT_REFERENCE', 'Payment reference is not part of this journey');
  }

  private async insertAudit(
    client: PoolClient,
    tenantId: string,
    actor: AuthenticatedIdentity,
    action: string,
    entityType: string,
    entityId: string,
    now: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, outcome, created_at)
       SELECT $1, app_user.id, $3, $4, $5, 'success', $6
       FROM app_users app_user WHERE app_user.auth_subject = $2`,
      [tenantId, actor.userId, action, entityType, entityId, now],
    );
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapPostgresError(error);
    } finally {
      client.release();
    }
  }
}

function mapPostgresError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (!error || typeof error !== 'object') return error;
  const code = (error as Record<string, unknown>).code;
  if (code === '23P01') return new ApiError(409, 'BOOKING_CONFLICT', 'The slot is no longer available');
  if (code === '23505') return new ApiError(409, 'DUPLICATE_OPERATION', 'The operation already exists');
  if (code === '23503') return new ApiError(422, 'INVALID_REFERENCE', 'A referenced resource is invalid');
  if (code === '23514') return new ApiError(422, 'INVALID_DOMAIN_STATE', 'The requested state violates a business rule');
  return error;
}

function followUpRow(row: Record<string, unknown>): FollowUpJobRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    conversationId: String(row.conversation_id),
    customerId: String(row.customer_id),
    channel: String(row.channel),
    reason: String(row.reason),
    status: row.status as FollowUpJobRecord['status'],
    dueAt: asIso(row.due_at),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    leaseOwner: nullableString(row.lease_owner),
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    retryAt: nullableIso(row.retry_at),
    lastError: nullableString(row.last_error),
    stopReason: nullableString(row.stop_reason),
    manualOverride: Boolean(row.manual_override),
    lastResponseAt: nullableIso(row.last_response_at),
    completedAt: nullableIso(row.completed_at),
    cancelledAt: nullableIso(row.cancelled_at),
    idempotencyKey: String(row.idempotency_key),
    draftMessage: nullableString(row.draft_message),
    createdAt: asIso(row.created_at),
  };
}

function revenueRow(row: Record<string, unknown> | undefined): RevenueLedgerEntry {
  if (!row) throw new Error('Revenue insert did not return a row');
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    leadId: String(row.lead_id),
    conversationId: String(row.conversation_id),
    paymentId: nullableString(row.payment_id),
    stage: row.stage as RevenueLedgerEntry['stage'],
    amountCents: Number(row.amount_cents),
    causationKey: String(row.causation_key),
    occurredAt: asIso(row.occurred_at),
  };
}

function webhookRow(row: Record<string, unknown>, replayed: boolean): WebhookEventRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    provider: String(row.provider),
    providerEventId: String(row.provider_event_id),
    receivedAt: asIso(row.received_at),
    verified: Boolean(row.verified),
    payloadHash: String(row.payload_hash),
    processingState: row.processing_state as WebhookEventRecord['processingState'],
    replayed,
  };
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : asIso(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function redactArguments(argumentsValue: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(argumentsValue).map((key) => [key, '[recorded]']));
}
