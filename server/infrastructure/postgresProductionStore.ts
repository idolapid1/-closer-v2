import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ApiError } from '../application/errors.js';
import { stableHash } from '../application/idempotency.js';
import type {
  AuthenticatedStoreExecutionOptions,
  IdempotencyBeginResult,
  ProductionStore,
  SystemDatabasePurpose,
} from '../application/store.js';
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
  HumanHandoffRecord,
  JourneyCreationInput,
  JourneyCreationResult,
  InvitationAcceptanceResult,
  LeadRecordView,
  OrganizationInvitationCreationRecord,
  OrganizationInvitationRecord,
  OrganizationMembership,
  OwnerSnapshotRecord,
  OpportunityCreationInput,
  OpportunityCreationResult,
  PaymentCreationInput,
  PaymentCreationResult,
  PaymentRecordView,
  RevenueLedgerEntry,
  RevenueSummary,
  TenantProvisionInput,
  TenantProvisionResult,
  WebhookEndpoint,
  WebhookEventRecord,
} from '../domain/model.js';
import type {
  OpportunityDetailRecord,
  OpportunityObservation,
  OpportunityRecord,
  OpportunitySource,
  RecoveryActionRecord,
  RecoveryDecisionRecord,
  RecoveryEvaluationRecord,
  RevenueCommandCenterRecord,
} from '../domain/opportunity.js';
import {
  RecoveryEngine,
  recoveryActionStatus,
  recoveryActionValidUntil,
  recoveryDecisionExecutionState,
  recoveryStateAfterDecision,
} from '../application/recoveryEngine.js';

type DatabaseExecutionMode = 'unscoped' | 'authenticated' | 'system';

export class PostgresProductionStore implements ProductionStore {
  constructor(
    private readonly pool: Pool,
    private readonly client: PoolClient | null = null,
    private readonly executionMode: DatabaseExecutionMode = 'unscoped',
  ) {}

  async runAsAuthenticated<T>(
    actor: AuthenticatedIdentity,
    operation: (store: ProductionStore) => Promise<T>,
    options: AuthenticatedStoreExecutionOptions = {},
  ): Promise<T> {
    this.assertRootExecutionBoundary();
    return this.executionTransaction('authenticated', async (client, scopedStore) => {
      await client.query('SET LOCAL ROLE closer_api');
      let appUser = await client.query(
        'SELECT id, email FROM public.app_users WHERE auth_subject = $1',
        [actor.userId],
      );
      if (!appUser.rows[0] && options.provisionAppUser !== false) {
        appUser = await client.query(
          `INSERT INTO public.app_users (id, auth_subject, email, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, now(), now())
           ON CONFLICT (auth_subject) DO UPDATE
             SET email = COALESCE(EXCLUDED.email, public.app_users.email)
           RETURNING id, email`,
          [actor.userId, actor.email],
        );
      } else if (appUser.rows[0] && actor.email && appUser.rows[0].email !== actor.email) {
        appUser = await client.query(
          `UPDATE public.app_users SET email = $2, updated_at = now()
           WHERE auth_subject = $1 RETURNING id, email`,
          [actor.userId, actor.email],
        );
      }
      const appUserId = appUser.rows[0]?.id;
      if (!appUserId) {
        throw new ApiError(401, 'ACTOR_NOT_PROVISIONED', 'Authenticated user is not provisioned');
      }
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(appUserId)]);
      return operation(scopedStore);
    });
  }

  async runAsSystem<T>(
    purpose: SystemDatabasePurpose,
    operation: (store: ProductionStore) => Promise<T>,
  ): Promise<T> {
    this.assertRootExecutionBoundary();
    return this.executionTransaction('system', async (client, scopedStore) => {
      await client.query('SET LOCAL ROLE closer_system');
      await client.query("SELECT set_config('app.user_id', '', true)");
      await client.query("SELECT set_config('app.system_purpose', $1, true)", [purpose]);
      return operation(scopedStore);
    });
  }

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
      await client.query(
        `INSERT INTO recovery_play_definitions (tenant_id, play_type)
         SELECT $1, play_type::recovery_play_type
         FROM unnest(ARRAY[
           'MISSED_CALL_RECOVERY', 'NEW_LEAD_RECOVERY',
           'UNSOLD_ESTIMATE_RECOVERY', 'OLD_LEAD_REACTIVATION'
         ]) AS play_type
         ON CONFLICT (tenant_id, play_type) DO NOTHING`,
        [tenantId],
      );
      await this.insertAudit(client, tenantId, actor, 'tenant.provisioned', 'tenant', tenantId, now);
      return { tenantId, role: 'owner', replayed: false };
    });
  }

  async listMemberships(userId: string): Promise<OrganizationMembership[]> {
    const result = await this.query(
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
    const result = await this.query(
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
    const result = await this.query(
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

  async listOpportunities(tenantId: string, limit = 50, offset = 0): Promise<OpportunityRecord[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const boundedOffset = Math.max(offset, 0);
    const result = await this.query(
      `SELECT * FROM opportunities
       WHERE tenant_id = $1
       ORDER BY updated_at DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, boundedLimit, boundedOffset],
    );
    return result.rows.map(opportunityRow);
  }

  async getOpportunity(tenantId: string, opportunityId: string): Promise<OpportunityRecord | null> {
    const result = await this.query(
      'SELECT * FROM opportunities WHERE tenant_id = $1 AND id = $2',
      [tenantId, opportunityId],
    );
    return result.rows[0] ? opportunityRow(result.rows[0]) : null;
  }

  async getOpportunityDetail(tenantId: string, opportunityId: string): Promise<OpportunityDetailRecord | null> {
    const [opportunityResult, decisions, actions, revenue] = await Promise.all([
      this.query(
        `SELECT opportunity.*,
                customer.display_name AS customer_display_name,
                customer.phone AS customer_phone,
                customer.email AS customer_email,
                customer.created_at AS customer_created_at,
                conversation.channel AS conversation_channel,
                conversation.mode AS conversation_mode,
                conversation.stage AS conversation_stage,
                conversation.last_customer_message_at AS conversation_last_customer_message_at,
                conversation.last_business_response_at AS conversation_last_business_response_at,
                conversation.created_at AS conversation_created_at,
                conversation.updated_at AS conversation_updated_at,
                booking.status AS booking_status,
                booking.start_at AS booking_start_at,
                booking.end_at AS booking_end_at,
                booking.total_cents AS booking_total_cents,
                estimate.status AS estimate_status,
                estimate.total_cents AS estimate_total_cents,
                estimate.created_at AS estimate_created_at,
                job.status AS job_status,
                job.scheduled_start_at AS job_scheduled_start_at,
                job.total_cents AS job_total_cents,
                handoff.id AS handoff_id,
                handoff.reason AS handoff_reason,
                handoff.detail AS handoff_detail,
                handoff.started_at AS handoff_started_at,
                handoff.resolved_at AS handoff_resolved_at
         FROM opportunities opportunity
         JOIN customers customer
           ON customer.tenant_id = opportunity.tenant_id AND customer.id = opportunity.customer_id
         LEFT JOIN conversations conversation
           ON conversation.tenant_id = opportunity.tenant_id AND conversation.id = opportunity.conversation_id
         LEFT JOIN bookings booking
           ON booking.tenant_id = opportunity.tenant_id AND booking.id = opportunity.booking_id
         LEFT JOIN quotes estimate
           ON estimate.tenant_id = opportunity.tenant_id AND estimate.id = opportunity.estimate_id
         LEFT JOIN jobs job
           ON job.tenant_id = opportunity.tenant_id AND job.id = opportunity.job_id
         LEFT JOIN LATERAL (
           SELECT item.* FROM human_handoffs item
           WHERE item.tenant_id = opportunity.tenant_id
             AND item.conversation_id = opportunity.conversation_id
             AND item.resolved_at IS NULL
           ORDER BY item.started_at DESC LIMIT 1
         ) handoff ON true
         WHERE opportunity.tenant_id = $1 AND opportunity.id = $2`,
        [tenantId, opportunityId],
      ),
      this.query(
        `SELECT * FROM recovery_decisions
         WHERE tenant_id = $1 AND opportunity_id = $2
         ORDER BY decided_at DESC`,
        [tenantId, opportunityId],
      ),
      this.query(
        `SELECT * FROM recovery_actions
         WHERE tenant_id = $1 AND opportunity_id = $2
         ORDER BY created_at DESC`,
        [tenantId, opportunityId],
      ),
      this.query(
        `SELECT id, tenant_id, customer_id, lead_id, conversation_id, payment_id, stage,
                amount_cents, causation_key, occurred_at, opportunity_id, event_type,
                attribution_type, attribution_reason
         FROM revenue_ledger_events
         WHERE tenant_id = $1 AND opportunity_id = $2
         ORDER BY occurred_at, created_at, id`,
        [tenantId, opportunityId],
      ),
    ]);
    const row = opportunityResult.rows[0];
    if (!row) return null;
    const opportunity = opportunityRow(row);
    return {
      opportunity,
      recoveryDecisions: decisions.rows.map(recoveryDecisionRow),
      recoveryActions: actions.rows.map(recoveryActionRow),
      revenueEvents: revenue.rows.map(revenueRow),
      customer: {
        id: opportunity.customerId,
        tenantId,
        displayName: String(row.customer_display_name),
        phone: String(row.customer_phone),
        email: nullableString(row.customer_email),
        createdAt: asIso(row.customer_created_at),
      },
      conversation: opportunity.conversationId && row.conversation_channel
        ? {
            id: opportunity.conversationId,
            tenantId,
            customerId: opportunity.customerId,
            leadId: opportunity.leadId ?? '',
            channel: String(row.conversation_channel),
            mode: row.conversation_mode as ConversationRecord['mode'],
            stage: String(row.conversation_stage),
            lastCustomerMessageAt: nullableIso(row.conversation_last_customer_message_at),
            lastBusinessResponseAt: nullableIso(row.conversation_last_business_response_at),
            createdAt: asIso(row.conversation_created_at),
            updatedAt: asIso(row.conversation_updated_at),
          }
        : null,
      booking: opportunity.bookingId && row.booking_status
        ? {
            id: opportunity.bookingId,
            status: String(row.booking_status),
            startAt: asIso(row.booking_start_at),
            endAt: asIso(row.booking_end_at),
            totalCents: Number(row.booking_total_cents),
          }
        : null,
      estimate: opportunity.estimateId && row.estimate_status
        ? {
            id: opportunity.estimateId,
            status: String(row.estimate_status),
            totalCents: Number(row.estimate_total_cents),
            createdAt: asIso(row.estimate_created_at),
          }
        : null,
      job: opportunity.jobId && row.job_status
        ? {
            id: opportunity.jobId,
            status: String(row.job_status),
            scheduledStartAt: nullableIso(row.job_scheduled_start_at),
            totalCents: Number(row.job_total_cents),
          }
        : null,
      activeHandoff: row.handoff_id
        ? {
            id: String(row.handoff_id),
            tenantId,
            conversationId: opportunity.conversationId ?? '',
            reason: String(row.handoff_reason),
            detail: String(row.handoff_detail),
            startedAt: asIso(row.handoff_started_at),
            resolvedAt: nullableIso(row.handoff_resolved_at),
          }
        : null,
    };
  }

  async getRevenueCommandCenter(tenantId: string): Promise<RevenueCommandCenterRecord> {
    const [metrics, opportunities] = await Promise.all([
      this.query(
        `SELECT
           COALESCE(SUM(revenue_attributed_cents) FILTER (WHERE attribution_type = 'RECOVERED'), 0)::bigint AS actual_recovered_revenue,
           COALESCE(SUM(revenue_attributed_cents) FILTER (WHERE attribution_type IN ('GENERATED','RECOVERED','ASSISTED')), 0)::bigint AS influenced_revenue,
           COALESCE(SUM(estimated_value_cents) FILTER (WHERE recovery_state IN ('RECOVERY_ACTIVE','WAITING_FOR_CUSTOMER')), 0)::bigint AS potential_recovered_revenue,
           COALESCE(SUM(estimated_value_cents) FILTER (WHERE recovery_state IN ('AT_RISK','RECOVERY_ACTIVE','WAITING_FOR_CUSTOMER','HUMAN_REQUIRED')), 0)::bigint AS revenue_at_risk,
           COUNT(*) FILTER (WHERE attribution_type = 'RECOVERED' AND job_id IS NOT NULL)::int AS recovered_jobs,
           COUNT(*) FILTER (WHERE attribution_type = 'RECOVERED' AND booking_id IS NOT NULL)::int AS recovered_bookings,
           COUNT(*) FILTER (WHERE status NOT IN ('WON','LOST','DO_NOT_CONTACT'))::int AS active_opportunities,
           COUNT(*) FILTER (WHERE recovery_state = 'HUMAN_REQUIRED')::int AS human_required,
           AVG(EXTRACT(EPOCH FROM (won_at - created_at)) / 3600)
             FILTER (WHERE attribution_type = 'RECOVERED' AND won_at IS NOT NULL) AS average_recovery_hours
         FROM opportunities WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.query(
        `SELECT * FROM opportunities
         WHERE tenant_id = $1
           AND recovery_state IN ('AT_RISK','RECOVERY_ACTIVE','WAITING_FOR_CUSTOMER','HUMAN_REQUIRED')
         ORDER BY CASE WHEN recovery_state = 'HUMAN_REQUIRED' THEN 0 ELSE 1 END,
                  recovery_score DESC, estimated_value_cents DESC NULLS LAST
         LIMIT 100`,
        [tenantId],
      ),
    ]);
    const row = metrics.rows[0] ?? {};
    return {
      actualRecoveredRevenueCents: Number(row.actual_recovered_revenue ?? 0),
      influencedRevenueCents: Number(row.influenced_revenue ?? 0),
      potentialRecoveredRevenueCents: Number(row.potential_recovered_revenue ?? 0),
      revenueAtRiskCents: Number(row.revenue_at_risk ?? 0),
      recoveredJobs: Number(row.recovered_jobs ?? 0),
      recoveredBookings: Number(row.recovered_bookings ?? 0),
      activeOpportunities: Number(row.active_opportunities ?? 0),
      humanInterventionRequired: Number(row.human_required ?? 0),
      averageRecoveryTimeHours: row.average_recovery_hours === null || row.average_recovery_hours === undefined
        ? null
        : Number(row.average_recovery_hours),
      opportunitiesAtRisk: opportunities.rows.map(opportunityRow),
    };
  }

  async evaluateOpportunityRecovery(
    tenantId: string,
    opportunityId: string,
    actor: AuthenticatedIdentity,
    idempotencyKey: string,
    now: string,
  ): Promise<RecoveryEvaluationRecord> {
    return this.transaction(async (client) => {
      const existing = await client.query(
        'SELECT * FROM recovery_decisions WHERE tenant_id = $1 AND idempotency_key = $2',
        [tenantId, idempotencyKey],
      );
      if (existing.rows[0]) {
        if (String(existing.rows[0].opportunity_id) !== opportunityId) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Recovery key was reused for another opportunity');
        }
        const action = await client.query(
          'SELECT * FROM recovery_actions WHERE tenant_id = $1 AND decision_id = $2',
          [tenantId, existing.rows[0].id],
        );
        if (!action.rows[0]) throw new ApiError(409, 'RECOVERY_ACTION_MISSING', 'Recovery action is missing');
        return { decision: recoveryDecisionRow(existing.rows[0]), action: recoveryActionRow(action.rows[0]) };
      }
      const context = await client.query(
        `SELECT opportunity.*,
                customer.opted_out, customer.operational_allowed,
                conversation.mode AS conversation_mode,
                conversation.last_customer_message_at AS conversation_customer_activity,
                conversation.last_business_response_at AS conversation_business_activity,
                COALESCE(follow_up.attempt_count, 0)::int AS follow_up_attempts,
                COALESCE(estimate.view_count, 0)::int AS estimate_view_count,
                estimate.created_at AS estimate_created_at,
                COALESCE(other_opportunity.active_count, 0)::int > 0 AS has_other_active_opportunity,
                CASE
                  WHEN recovery_policy.contact_window_start IS NULL THEN false
                  ELSE $3::timestamptz::time >= recovery_policy.contact_window_start
                    AND $3::timestamptz::time < recovery_policy.contact_window_end
                END AS within_contact_window
         FROM opportunities opportunity
         JOIN customers customer
           ON customer.tenant_id = opportunity.tenant_id AND customer.id = opportunity.customer_id
         LEFT JOIN conversations conversation
           ON conversation.tenant_id = opportunity.tenant_id AND conversation.id = opportunity.conversation_id
         LEFT JOIN LATERAL (
           SELECT SUM(attempt_count)::int AS attempt_count
           FROM follow_up_jobs item
           WHERE item.tenant_id = opportunity.tenant_id
             AND item.conversation_id = opportunity.conversation_id
         ) follow_up ON true
         LEFT JOIN LATERAL (
           SELECT item.created_at,
                  CASE WHEN item.status = 'VIEWED' THEN 1 ELSE 0 END AS view_count
           FROM quotes item
           WHERE item.tenant_id = opportunity.tenant_id AND item.id = opportunity.estimate_id
         ) estimate ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS active_count
           FROM opportunities item
           WHERE item.tenant_id = opportunity.tenant_id
             AND item.customer_id = opportunity.customer_id
             AND item.id <> opportunity.id
             AND item.status NOT IN ('WON','LOST','DO_NOT_CONTACT')
         ) other_opportunity ON true
         LEFT JOIN LATERAL (
           SELECT MIN(contact_window_start) AS contact_window_start,
                  MAX(contact_window_end) AS contact_window_end
           FROM recovery_play_definitions item
           WHERE item.tenant_id = opportunity.tenant_id AND item.enabled
         ) recovery_policy ON true
         WHERE opportunity.tenant_id = $1 AND opportunity.id = $2
         FOR UPDATE OF opportunity`,
        [tenantId, opportunityId, now],
      );
      const row = context.rows[0];
      if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
      const opportunity = opportunityRow(row);
      const currentAction = await client.query(
        `SELECT * FROM recovery_actions
         WHERE tenant_id = $1 AND opportunity_id = $2
           AND status IN ('PENDING','READY','WAITING_APPROVAL','EXECUTING','WAITING_CUSTOMER','HUMAN_REQUIRED')
         ORDER BY created_at DESC LIMIT 1
         FOR UPDATE`,
        [tenantId, opportunityId],
      );
      if (currentAction.rows[0]) {
        const action = recoveryActionRow(currentAction.rows[0]);
        if (action.validUntil && new Date(action.validUntil).getTime() <= new Date(now).getTime()) {
          await client.query(
            `UPDATE recovery_actions
             SET status = 'CANCELLED', cancelled_at = $3, updated_at = $3
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, action.id, now],
          );
        } else {
          const currentDecision = await client.query(
            'SELECT * FROM recovery_decisions WHERE tenant_id = $1 AND id = $2',
            [tenantId, action.decisionId],
          );
          if (!currentDecision.rows[0]) {
            throw new ApiError(409, 'RECOVERY_DECISION_MISSING', 'Recovery decision is missing');
          }
          return { decision: recoveryDecisionRow(currentDecision.rows[0]), action };
        }
      }
      const observation = opportunityObservationRow(row, opportunity, now);
      const decision = new RecoveryEngine().evaluate({ opportunity, observation, operationKey: idempotencyKey });
      const executionState = recoveryDecisionExecutionState(opportunity, decision);
      const recoveryState = recoveryStateAfterDecision(opportunity, decision);
      const reasonCodes = [...new Set([
        ...decision.scores.intent.reasonCodes,
        ...decision.scores.revenue.reasonCodes,
        ...decision.scores.recovery.reasonCodes,
        ...decision.scores.urgency.reasonCodes,
      ])];
      const inserted = await client.query(
        `INSERT INTO recovery_decisions (
           tenant_id, opportunity_id, play_type, eligible, suppression_reason,
           next_action_kind, next_action_label, action_channel, requires_approval, due_at,
           policy_version, score_version, intent_score, revenue_score, recovery_score,
           urgency_score, reason_codes, execution_state, idempotency_key, decided_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [tenantId, opportunityId, decision.playType, decision.eligible, decision.suppressionReason,
          decision.nextBestAction.kind, decision.nextBestAction.label, decision.nextBestAction.channel,
          decision.nextBestAction.requiresApproval, decision.nextBestAction.dueAt,
          decision.policyVersion, decision.scores.recovery.version, decision.scores.intent.value,
          decision.scores.revenue.value, decision.scores.recovery.value, decision.scores.urgency.value,
          reasonCodes, executionState, idempotencyKey, now],
      );
      const actionStatus = recoveryActionStatus(opportunity, decision);
      const actionInserted = await client.query(
        `INSERT INTO recovery_actions (
           tenant_id, opportunity_id, decision_id, action_kind, channel, status,
           requires_approval, requested_by, idempotency_key, valid_until,
           delivery_state, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'POLICY',$8,$9,'LIVE_DISABLED',$10,$10)
         RETURNING *`,
        [tenantId, opportunityId, inserted.rows[0]?.id, decision.nextBestAction.kind,
          decision.nextBestAction.channel, actionStatus, decision.nextBestAction.requiresApproval,
          `${idempotencyKey}:action`, recoveryActionValidUntil(decision), now],
      );
      await client.query(
        `UPDATE opportunities SET
           intent_score = $3, revenue_score = $4, recovery_score = $5, urgency_score = $6,
           score_version = $7, score_reason_codes = $8, recovery_state = $9,
           next_action_at = $10, updated_at = $11
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, opportunityId, decision.scores.intent.value, decision.scores.revenue.value,
          decision.scores.recovery.value, decision.scores.urgency.value,
          decision.scores.recovery.version, reasonCodes, recoveryState,
          decision.nextBestAction.dueAt, now],
      );
      await client.query(
        `INSERT INTO opportunity_score_snapshots (
           tenant_id, opportunity_id, intent_score, revenue_score, recovery_score,
           urgency_score, score_version, reason_codes, explanation, causation_key, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tenantId, opportunityId, decision.scores.intent.value, decision.scores.revenue.value,
          decision.scores.recovery.value, decision.scores.urgency.value,
          decision.scores.recovery.version, reasonCodes,
          [decision.scores.intent.explanation, decision.scores.revenue.explanation,
            decision.scores.recovery.explanation, decision.scores.urgency.explanation].join(' | '),
          idempotencyKey, now],
      );
      await this.insertAudit(client, tenantId, actor, 'opportunity.recovery_evaluated', 'opportunity', opportunityId, now);
      return {
        decision: recoveryDecisionRow(inserted.rows[0]),
        action: recoveryActionRow(actionInserted.rows[0]),
      };
    });
  }

  async approveRecoveryAction(
    tenantId: string,
    opportunityId: string,
    actionId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<RecoveryActionRecord> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `SELECT * FROM recovery_actions
         WHERE tenant_id = $1 AND opportunity_id = $2 AND id = $3
         FOR UPDATE`,
        [tenantId, opportunityId, actionId],
      );
      const row = result.rows[0];
      if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
      if (row.status === 'READY' && row.approved_at) return recoveryActionRow(row);
      if (row.status !== 'WAITING_APPROVAL') {
        throw new ApiError(409, 'RECOVERY_ACTION_NOT_APPROVABLE', 'Recovery action is not waiting for approval');
      }
      if (row.valid_until && new Date(row.valid_until).getTime() <= new Date(now).getTime()) {
        await client.query(
          `UPDATE recovery_actions
           SET status = 'CANCELLED', cancelled_at = $4, updated_at = $4
           WHERE tenant_id = $1 AND opportunity_id = $2 AND id = $3`,
          [tenantId, opportunityId, actionId, now],
        );
        throw new ApiError(409, 'RECOVERY_ACTION_EXPIRED', 'Recovery action has expired and must be recalculated');
      }
      const updated = await client.query(
        `UPDATE recovery_actions
         SET status = 'READY',
             approved_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid,
             approved_at = $4, updated_at = $4
         WHERE tenant_id = $1 AND opportunity_id = $2 AND id = $3
         RETURNING *`,
        [tenantId, opportunityId, actionId, now],
      );
      await client.query(
        `UPDATE opportunities
         SET recovery_state = 'RECOVERY_ACTIVE', next_action_at = $3, updated_at = $3
         WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('WON', 'DO_NOT_CONTACT')`,
        [tenantId, opportunityId, now],
      );
      await this.insertAudit(client, tenantId, actor, 'recovery_action.approved', 'recovery_action', actionId, now);
      return recoveryActionRow(updated.rows[0]);
    });
  }

  async recordCustomerOptOut(
    tenantId: string,
    customerId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<{ customerId: string; stoppedOpportunities: number; cancelledFollowUps: number }> {
    return this.transaction(async (client) => {
      const customer = await client.query(
        `UPDATE customers
         SET opted_out = true, operational_allowed = false, marketing_allowed = false, updated_at = $3
         WHERE tenant_id = $1 AND id = $2
         RETURNING id`,
        [tenantId, customerId, now],
      );
      if (!customer.rows[0]) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
      const opportunities = await client.query(
        `UPDATE opportunities
         SET status = 'DO_NOT_CONTACT', recovery_state = 'STOPPED', next_action_at = NULL, updated_at = $3
         WHERE tenant_id = $1 AND customer_id = $2
           AND status NOT IN ('WON', 'DO_NOT_CONTACT')
         RETURNING id, conversation_id`,
        [tenantId, customerId, now],
      );
      const opportunityIds = opportunities.rows.map((row) => String(row.id));
      if (opportunityIds.length > 0) {
        await client.query(
          `UPDATE recovery_actions
           SET status = 'CANCELLED', cancelled_at = $3, updated_at = $3
           WHERE tenant_id = $1 AND opportunity_id = ANY($2::uuid[])
             AND status IN ('PENDING','READY','WAITING_APPROVAL','EXECUTING','WAITING_CUSTOMER','HUMAN_REQUIRED')`,
          [tenantId, opportunityIds, now],
        );
      }
      const followUps = await client.query(
        `UPDATE follow_up_jobs
         SET status = 'cancelled', cancelled_at = $3, stop_reason = 'CONSENT_BLOCKED',
             lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
         WHERE tenant_id = $1 AND customer_id = $2
           AND status IN ('scheduled','failed','leased')
         RETURNING id`,
        [tenantId, customerId, now],
      );
      await this.insertAudit(client, tenantId, actor, 'customer.opted_out', 'customer', customerId, now);
      return {
        customerId,
        stoppedOpportunities: opportunities.rowCount ?? 0,
        cancelledFollowUps: followUps.rowCount ?? 0,
      };
    });
  }

  async recordCustomerResponse(
    tenantId: string,
    opportunityId: string,
    actor: AuthenticatedIdentity,
    input: CustomerResponseInput,
    now: string,
  ): Promise<CustomerResponseResult> {
    return this.transaction(async (client) => {
      const opportunity = await client.query(
        `SELECT id, conversation_id, status
         FROM opportunities
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [tenantId, opportunityId],
      );
      const row = opportunity.rows[0];
      if (!row || !row.conversation_id) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
      }
      if (row.status === 'DO_NOT_CONTACT') {
        throw new ApiError(409, 'OPPORTUNITY_CONTACT_STOPPED', 'Explicit re-consent is required before continuing');
      }
      const inserted = await client.query(
        `INSERT INTO messages (
           tenant_id, conversation_id, direction, author, purpose, body,
           provider_message_id, sent_at, created_at, updated_at
         ) VALUES ($1,$2,'INBOUND','CUSTOMER','OPERATIONAL',$3,$4,$5,$5,$5)
         ON CONFLICT (tenant_id, provider_message_id) DO NOTHING
         RETURNING id`,
        [tenantId, row.conversation_id, input.body, input.providerMessageId, now],
      );
      if (!inserted.rows[0]) {
        const existing = await client.query(
          `SELECT message.id, message.conversation_id, message.body, opportunity.id AS opportunity_id
           FROM messages message
           LEFT JOIN opportunities opportunity
             ON opportunity.tenant_id = message.tenant_id
             AND opportunity.conversation_id = message.conversation_id
           WHERE message.tenant_id = $1 AND message.provider_message_id = $2`,
          [tenantId, input.providerMessageId],
        );
        const existingRow = existing.rows[0];
        if (!existingRow
          || String(existingRow.opportunity_id) !== opportunityId
          || String(existingRow.body) !== input.body) {
          throw new ApiError(409, 'PROVIDER_MESSAGE_CONFLICT', 'Provider message ID was reused with different facts');
        }
        return {
          messageId: String(existingRow.id),
          opportunityId,
          conversationId: String(existingRow.conversation_id),
          providerReplay: true,
        };
      }
      await client.query(
        `UPDATE conversations
         SET last_customer_message_at = $3, updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, row.conversation_id, now],
      );
      await client.query(
        `UPDATE opportunities
         SET status = CASE WHEN status IN ('NEW','CONTACTING') THEN 'ENGAGED'::opportunity_status ELSE status END,
             recovery_state = CASE
               WHEN recovery_state = 'HUMAN_REQUIRED' THEN recovery_state
               ELSE 'NOT_AT_RISK'::recovery_state
             END,
             last_customer_activity_at = $3,
             next_action_at = $3,
             updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, opportunityId, now],
      );
      await client.query(
        `UPDATE follow_up_jobs
         SET status = 'cancelled', stop_reason = 'CUSTOMER_REPLIED', last_response_at = $3,
             cancelled_at = $3, lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
         WHERE tenant_id = $1 AND conversation_id = $2
           AND status IN ('scheduled','failed','leased')`,
        [tenantId, row.conversation_id, now],
      );
      await client.query(
        `UPDATE recovery_actions
         SET status = CASE
               WHEN status = 'WAITING_CUSTOMER' THEN 'COMPLETED'::recovery_action_status
               ELSE 'CANCELLED'::recovery_action_status
             END,
             completed_at = CASE WHEN status = 'WAITING_CUSTOMER' THEN COALESCE(completed_at, $3) ELSE completed_at END,
             cancelled_at = CASE WHEN status = 'WAITING_CUSTOMER' THEN cancelled_at ELSE $3 END,
             updated_at = $3
         WHERE tenant_id = $1 AND opportunity_id = $2
           AND status IN ('PENDING','READY','WAITING_APPROVAL','EXECUTING','WAITING_CUSTOMER')`,
        [tenantId, opportunityId, now],
      );
      const messageId = String(inserted.rows[0].id);
      await this.insertAudit(client, tenantId, actor, 'customer.response_recorded', 'message', messageId, now);
      return {
        messageId,
        opportunityId,
        conversationId: String(row.conversation_id),
        providerReplay: false,
      };
    });
  }

  async listConversations(tenantId: string): Promise<ConversationRecord[]> {
    const result = await this.query(
      `SELECT id, tenant_id, customer_id, lead_id, channel, mode, stage,
              last_customer_message_at, last_business_response_at, created_at, updated_at
       FROM conversations WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map(conversationRow);
  }

  async listFollowUps(tenantId: string): Promise<FollowUpJobRecord[]> {
    const result = await this.query(
      `SELECT * FROM follow_up_jobs
       WHERE tenant_id = $1 ORDER BY COALESCE(retry_at, due_at), created_at`,
      [tenantId],
    );
    return result.rows.map(followUpRow);
  }

  async getCustomerWorkspace(tenantId: string, customerId: string): Promise<CustomerWorkspaceRecord | null> {
    const customerResult = await this.query(
      `SELECT id, tenant_id, display_name, phone, email, created_at
       FROM customers WHERE tenant_id = $1 AND id = $2`,
      [tenantId, customerId],
    );
    const customerRow = customerResult.rows[0];
    if (!customerRow) return null;
    const leadResult = await this.query(
      `SELECT id, tenant_id, customer_id, conversation_id, service_id, source, workflow_type,
              sales_state, status, priority, created_at, updated_at
       FROM leads WHERE tenant_id = $1 AND customer_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, customerId],
    );
    const lead = leadResult.rows[0] ? leadRow(leadResult.rows[0]) : null;
    const conversationResult = lead?.conversationId
      ? await this.query(
        `SELECT id, tenant_id, customer_id, lead_id, channel, mode, stage,
                last_customer_message_at, last_business_response_at, created_at, updated_at
         FROM conversations WHERE tenant_id = $1 AND id = $2`,
        [tenantId, lead.conversationId],
      )
      : { rows: [] as Record<string, unknown>[] };
    const conversation = conversationResult.rows[0] ? conversationRow(conversationResult.rows[0]) : null;
    const followUps = await this.query(
      'SELECT * FROM follow_up_jobs WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC',
      [tenantId, customerId],
    );
    const handoff = conversation
      ? await this.query(
        `SELECT id, tenant_id, conversation_id, reason, detail, started_at, resolved_at
         FROM human_handoffs
         WHERE tenant_id = $1 AND conversation_id = $2 AND resolved_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
        [tenantId, conversation.id],
      )
      : { rows: [] as Record<string, unknown>[] };
    const payments = await this.query(
      `SELECT id, tenant_id, customer_id, lead_id, conversation_id, reference_type,
              reference_id, kind, status, amount_cents, original_payment_id, collected_at
       FROM payments WHERE tenant_id = $1 AND customer_id = $2 ORDER BY collected_at`,
      [tenantId, customerId],
    );
    const opportunities = await this.query(
      `SELECT * FROM opportunities
       WHERE tenant_id = $1 AND customer_id = $2
       ORDER BY created_at DESC`,
      [tenantId, customerId],
    );
    return {
      customer: customerRecordRow(customerRow),
      opportunities: opportunities.rows.map(opportunityRow),
      lead,
      conversation,
      followUps: followUps.rows.map(followUpRow),
      activeHandoff: handoff.rows[0] ? handoffRow(handoff.rows[0]) : null,
      payments: payments.rows.map(paymentViewRow),
    };
  }

  async getOwnerSnapshot(tenantId: string): Promise<OwnerSnapshotRecord> {
    const [customers, conversations, followUps, revenue, handoffs] = await Promise.all([
      this.listCustomers(tenantId),
      this.listConversations(tenantId),
      this.listFollowUps(tenantId),
      this.getRevenueSummary(tenantId),
      this.query(
        `SELECT id, tenant_id, conversation_id, reason, detail, started_at, resolved_at
         FROM human_handoffs WHERE tenant_id = $1 AND resolved_at IS NULL ORDER BY started_at`,
        [tenantId],
      ),
    ]);
    return {
      customers,
      conversations,
      followUps,
      activeHandoffs: handoffs.rows.map(handoffRow),
      revenue,
    };
  }

  async getRevenueSummary(tenantId: string): Promise<RevenueSummary> {
    const result = await this.query(
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
    const result = await this.query(
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

  async createInvitation(
    tenantId: string,
    actor: AuthenticatedIdentity,
    input: OrganizationInvitationCreationRecord,
    now: string,
  ): Promise<OrganizationInvitationRecord> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${tenantId}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query(
        `SELECT * FROM organization_invitations
         WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [tenantId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const record = invitationRow(existing.rows[0]);
        if (record.email !== input.email || record.role !== input.role) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Invitation key was reused with different input');
        }
        return { ...record, replayed: true };
      }
      const inserted = await client.query(
        `INSERT INTO organization_invitations
          (tenant_id, email, role, token_hash, idempotency_key, invited_by_user_id,
           expires_at, created_at, updated_at)
         SELECT $1,$2,$3,$4,$5,app_user.id,$6,$7,$7
         FROM app_users app_user WHERE app_user.auth_subject = $8
         RETURNING *`,
        [tenantId, input.email, input.role, input.tokenHash, input.idempotencyKey, input.expiresAt, now, actor.userId],
      );
      if (!inserted.rows[0]) throw new ApiError(403, 'ACTOR_NOT_PROVISIONED', 'Authenticated user is not provisioned');
      const record = invitationRow(inserted.rows[0]);
      await this.insertAudit(client, tenantId, actor, 'invitation.created', 'organization_invitation', record.id, now);
      return { ...record, replayed: false };
    });
  }

  async acceptInvitation(
    tokenHash: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<InvitationAcceptanceResult> {
    if (!actor.email) throw new ApiError(422, 'INVITATION_EMAIL_REQUIRED', 'The authenticated account has no email');
    const actorEmail = actor.email;
    return this.transaction(async (client) => {
      const invitation = await client.query(
        'SELECT * FROM organization_invitations WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      );
      const row = invitation.rows[0];
      if (!row) throw new ApiError(404, 'INVITATION_NOT_FOUND', 'Invitation is invalid');
      if (row.revoked_at) throw new ApiError(410, 'INVITATION_REVOKED', 'Invitation was revoked');
      if (row.accepted_at) throw new ApiError(409, 'INVITATION_ALREADY_USED', 'Invitation was already accepted');
      if (new Date(String(row.expires_at)).getTime() <= new Date(now).getTime()) {
        throw new ApiError(410, 'INVITATION_EXPIRED', 'Invitation expired');
      }
      if (String(row.email).toLowerCase() !== actorEmail.toLowerCase()) {
        throw new ApiError(403, 'INVITATION_EMAIL_MISMATCH', 'Invitation belongs to a different account');
      }
      const appUser = await client.query(
        `INSERT INTO app_users (id, auth_subject, email, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $3)
         ON CONFLICT (auth_subject) DO UPDATE SET email = EXCLUDED.email, updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [actor.userId, actorEmail, now],
      );
      const appUserId = String(appUser.rows[0]?.id);
      await client.query(
        `INSERT INTO organization_memberships (tenant_id, user_id, role, active, created_at, updated_at)
         VALUES ($1,$2,$3,true,$4,$4)
         ON CONFLICT (tenant_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, active = true, updated_at = EXCLUDED.updated_at`,
        [row.tenant_id, appUserId, row.role, now],
      );
      await client.query(
        `UPDATE organization_invitations
         SET accepted_by_user_id = $2, accepted_at = $3, updated_at = $3 WHERE id = $1`,
        [row.id, appUserId, now],
      );
      const tenantId = String(row.tenant_id);
      await this.insertAudit(client, tenantId, actor, 'invitation.accepted', 'organization_invitation', String(row.id), now);
      return { tenantId, role: row.role as InvitationAcceptanceResult['role'], replayed: false };
    });
  }

  async revokeInvitation(
    tenantId: string,
    invitationId: string,
    actor: AuthenticatedIdentity,
    now: string,
  ): Promise<OrganizationInvitationRecord | null> {
    return this.transaction(async (client) => {
      const locked = await client.query(
        'SELECT * FROM organization_invitations WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [tenantId, invitationId],
      );
      const row = locked.rows[0];
      if (!row) return null;
      if (row.accepted_at) throw new ApiError(409, 'INVITATION_ALREADY_USED', 'Accepted invitation cannot be revoked');
      if (!row.revoked_at) {
        const updated = await client.query(
          `UPDATE organization_invitations SET revoked_at = $3, updated_at = $3
           WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          [tenantId, invitationId, now],
        );
        await this.insertAudit(client, tenantId, actor, 'invitation.revoked', 'organization_invitation', invitationId, now);
        return invitationRow(updated.rows[0]);
      }
      return invitationRow(row);
    });
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
         SET status = 'cancelled', cancelled_at = $3, stop_reason = 'HUMAN_TAKEOVER',
             lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
         WHERE tenant_id = $1 AND conversation_id = $2 AND status IN ('scheduled','failed','leased')`,
        [tenantId, conversationId, now],
      );
      await client.query(
        `UPDATE opportunities
         SET recovery_state = 'HUMAN_REQUIRED',
             assigned_human_id = NULLIF(current_setting('app.user_id', true), '')::uuid,
             next_action_at = $3, updated_at = $3
         WHERE tenant_id = $1 AND conversation_id = $2
           AND status NOT IN ('WON', 'DO_NOT_CONTACT')`,
        [tenantId, conversationId, now],
      );
      await client.query(
        `UPDATE recovery_actions action
         SET status = 'CANCELLED', cancelled_at = $3, updated_at = $3
         FROM opportunities opportunity
         WHERE action.tenant_id = $1
           AND action.tenant_id = opportunity.tenant_id
           AND action.opportunity_id = opportunity.id
           AND opportunity.conversation_id = $2
           AND action.status IN ('PENDING','READY','WAITING_APPROVAL','EXECUTING','WAITING_CUSTOMER')`,
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
      await client.query(
        `UPDATE opportunities
         SET recovery_state = 'AT_RISK', assigned_human_id = NULL,
             next_action_at = $3, updated_at = $3
         WHERE tenant_id = $1 AND conversation_id = $2
           AND recovery_state = 'HUMAN_REQUIRED'
           AND status NOT IN ('WON', 'DO_NOT_CONTACT')`,
        [tenantId, conversationId, now],
      );
      await client.query(
        `UPDATE recovery_actions action
         SET status = 'CANCELLED', cancelled_at = $3, updated_at = $3
         FROM opportunities opportunity
         WHERE action.tenant_id = $1
           AND action.tenant_id = opportunity.tenant_id
           AND action.opportunity_id = opportunity.id
           AND opportunity.conversation_id = $2
           AND action.status = 'HUMAN_REQUIRED'`,
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
    await this.query(
      `UPDATE idempotency_records
       SET status = 'completed', response_json = $4, completed_at = $5
       WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3`,
      [tenantId, scope, key, JSON.stringify(response), now],
    );
  }

  async abandonIdempotency(tenantId: string, scope: string, key: string): Promise<void> {
    await this.query(
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
      const opportunity = await client.query(
        `INSERT INTO opportunities (
           tenant_id, customer_id, lead_id, conversation_id, source, opportunity_type,
           estimated_value_cents, autonomy_level, recovery_state, next_action_at,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,'AT_RISK',$9,$9,$9
         ) RETURNING id`,
        [tenantId, customerId, leadId, conversationId,
          normalizeOpportunitySource(input.lead.source), input.lead.opportunityType ?? 'OTHER',
          input.lead.estimatedValueCents ?? null, input.lead.autonomyLevel ?? 'SUGGEST', now],
      );
      const opportunityId = String(opportunity.rows[0]?.id);
      await this.insertAudit(client, tenantId, actor, 'journey.created', 'lead', leadId, now);
      await this.insertAudit(client, tenantId, actor, 'opportunity.created', 'opportunity', opportunityId, now);
      return { customerId, leadId, conversationId, opportunityId, replayed: false };
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
      const opportunity = await client.query(
        `SELECT id, conversation_id, recovery_state, status
         FROM opportunities
         WHERE tenant_id = $1 AND lead_id = $2
         FOR UPDATE`,
        [tenantId, input.leadId],
      );
      if (opportunity.rowCount !== 1) {
        throw new ApiError(422, 'INVALID_OPPORTUNITY_CONTEXT', 'Booking has no commercial opportunity');
      }
      if (!['NEW', 'CONTACTING', 'ENGAGED', 'QUALIFIED'].includes(String(opportunity.rows[0]?.status))) {
        throw new ApiError(409, 'OPPORTUNITY_NOT_BOOKABLE', 'Opportunity is not in a bookable state');
      }
      const service = await client.query(
        `SELECT service.id
         FROM services service
         JOIN leads lead ON lead.tenant_id = service.tenant_id AND lead.id = $3
         WHERE service.tenant_id = $1 AND service.id = $2 AND service.active
           AND service.workflow_type = 'APPOINTMENT_SERVICE'
           AND lead.workflow_type = 'APPOINTMENT_SERVICE'`,
        [tenantId, input.serviceId, input.leadId],
      );
      if (service.rowCount !== 1) {
        throw new ApiError(422, 'INVALID_BOOKING_WORKFLOW', 'Booking requires an active appointment service');
      }
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
      const opportunityId = String(opportunity.rows[0]?.id);
      const conversationId = String(opportunity.rows[0]?.conversation_id);
      const wasAtRisk = ['AT_RISK', 'RECOVERY_ACTIVE', 'WAITING_FOR_CUSTOMER'].includes(
        String(opportunity.rows[0]?.recovery_state),
      );
      const recoveryEvidence = await client.query(
        `SELECT status FROM recovery_actions
         WHERE tenant_id = $1 AND opportunity_id = $2
           AND status NOT IN ('FAILED','SUPPRESSED','CANCELLED','HUMAN_REQUIRED')
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, opportunityId],
      );
      const recoveryActionStatusValue = recoveryEvidence.rows[0]?.status
        ? String(recoveryEvidence.rows[0].status)
        : null;
      const attributionType = ['COMPLETED', 'WAITING_CUSTOMER'].includes(recoveryActionStatusValue ?? '')
        ? 'RECOVERED'
        : recoveryActionStatusValue ? 'ASSISTED' : 'ORGANIC';
      const attributionReason = attributionType === 'RECOVERED'
        ? 'VALIDATED_RECOVERY_ACTION_PRECEDED_BOOKING'
        : attributionType === 'ASSISTED'
          ? 'CLOSER_PREPARED_RECOVERY_BEFORE_BOOKING'
          : 'NO_MATERIAL_CLOSER_RECOVERY_EVIDENCE';
      await client.query(
        `UPDATE opportunities
         SET booking_id = $3, status = 'BOOKED',
             recovery_state = $4::recovery_state, next_action_at = NULL,
             attribution_type = $5::revenue_attribution_type,
             attribution_reason = $6,
             updated_at = $7
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, opportunityId, bookingId, wasAtRisk ? 'RECOVERED' : 'NOT_AT_RISK',
          attributionType, attributionReason, now],
      );
      await client.query(
        `INSERT INTO revenue_ledger_events (
           tenant_id, customer_id, lead_id, conversation_id, payment_id, stage,
           amount_cents, causation_key, occurred_at, opportunity_id, event_type,
           attribution_type, attribution_reason
         ) VALUES (
           $1,$2,$3,$4,NULL,'booked',$5,$6,$7,$8,$9,$10,$11
         ) ON CONFLICT (tenant_id, causation_key) DO NOTHING`,
        [tenantId, input.customerId, input.leadId, conversationId, input.totalCents,
          `booking:${bookingId}`, now, opportunityId,
          attributionType === 'RECOVERED' ? 'BOOKING_RECOVERED' : 'BOOKING_CREATED',
          attributionType, attributionReason],
      );
      await this.insertAudit(client, tenantId, actor, 'booking.created', 'booking', bookingId, now);
      return { bookingId };
    });
  }

  async createOpportunity(
    tenantId: string,
    customerId: string,
    actor: AuthenticatedIdentity,
    input: OpportunityCreationInput,
    now: string,
  ): Promise<OpportunityCreationResult> {
    return this.transaction(async (client) => {
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      const customer = await client.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [tenantId, customerId],
      );
      if (customer.rowCount !== 1) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
      const lead = await client.query(
        `INSERT INTO leads (
           tenant_id, customer_id, source, workflow_type, service_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [tenantId, customerId, input.source, input.workflowType, input.serviceId, now],
      );
      const leadId = String(lead.rows[0]?.id);
      const conversation = await client.query(
        `INSERT INTO conversations (
           tenant_id, customer_id, lead_id, channel, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [tenantId, customerId, leadId, input.channel, now],
      );
      const conversationId = String(conversation.rows[0]?.id);
      await client.query(
        'UPDATE leads SET conversation_id = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2',
        [tenantId, leadId, conversationId, now],
      );
      const opportunity = await client.query(
        `INSERT INTO opportunities (
           tenant_id, customer_id, lead_id, conversation_id, source, opportunity_type,
           estimated_value_cents, autonomy_level, recovery_state, next_action_at,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AT_RISK',$9,$9,$9)
         RETURNING id`,
        [tenantId, customerId, leadId, conversationId, input.source, input.opportunityType,
          input.estimatedValueCents, input.autonomyLevel, now],
      );
      const opportunityId = String(opportunity.rows[0]?.id);
      await this.insertAudit(client, tenantId, actor, 'opportunity.created', 'opportunity', opportunityId, now);
      return { opportunityId, leadId, conversationId, replayed: false };
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
      const opportunityContext = await client.query(
        `SELECT id, attribution_type, attribution_reason FROM opportunities
         WHERE tenant_id = $1 AND customer_id = $2 AND lead_id = $3 AND conversation_id = $4
           AND ($5::uuid IS NULL OR id = $5)
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, entry.customerId, entry.leadId, entry.conversationId, entry.opportunityId ?? null],
      );
      const resolvedOpportunityId = opportunityContext.rows[0]
        ? String(opportunityContext.rows[0].id)
        : null;
      const resolvedAttributionType = entry.attributionType
        ?? opportunityContext.rows[0]?.attribution_type
        ?? null;
      const resolvedAttributionReason = entry.attributionReason
        ?? opportunityContext.rows[0]?.attribution_reason
        ?? null;
      if (entry.opportunityId && !resolvedOpportunityId) {
        throw new ApiError(422, 'INVALID_OPPORTUNITY_CONTEXT', 'Revenue event is linked to a different opportunity');
      }
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
           amount_cents, causation_key, occurred_at, opportunity_id, event_type,
           attribution_type, attribution_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, tenant_id, customer_id, lead_id, conversation_id, payment_id,
                   stage, amount_cents, causation_key, occurred_at, opportunity_id,
                   event_type, attribution_type, attribution_reason`,
        [tenantId, entry.customerId, entry.leadId, entry.conversationId, entry.paymentId,
          entry.stage, entry.amountCents, entry.causationKey, now, resolvedOpportunityId,
          entry.eventType ?? revenueEventTypeForStage(entry.stage), resolvedAttributionType,
          resolvedAttributionReason],
      );
      const record = revenueRow(result.rows[0]);
      if (resolvedOpportunityId) {
        await client.query(
          `UPDATE opportunities opportunity SET
             revenue_attributed_cents = financial.net_collected,
             attribution_type = COALESCE($3::revenue_attribution_type, opportunity.attribution_type),
             attribution_reason = COALESCE($4, opportunity.attribution_reason),
             updated_at = $5
           FROM (
             SELECT GREATEST(0,
               COALESCE(SUM(amount_cents) FILTER (WHERE stage = 'collected'), 0)
               - COALESCE(SUM(amount_cents) FILTER (WHERE stage = 'refunded'), 0)
             )::bigint AS net_collected
             FROM revenue_ledger_events
             WHERE tenant_id = $1 AND opportunity_id = $2
           ) financial
           WHERE opportunity.tenant_id = $1 AND opportunity.id = $2`,
          [tenantId, resolvedOpportunityId, resolvedAttributionType,
            resolvedAttributionReason, now],
        );
      }
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
        `SELECT conversation.id, conversation.mode, customer.opted_out, customer.operational_allowed
         FROM conversations conversation
         JOIN customers customer
           ON customer.tenant_id = conversation.tenant_id AND customer.id = conversation.customer_id
         WHERE conversation.tenant_id = $1 AND conversation.id = $2 AND conversation.customer_id = $3`,
        [tenantId, input.conversationId, input.customerId],
      );
      if (context.rowCount !== 1) throw new ApiError(422, 'INVALID_FOLLOW_UP_CONTEXT', 'Follow-up context is invalid');
      if (context.rows[0].opted_out || !context.rows[0].operational_allowed) {
        throw new ApiError(409, 'FOLLOW_UP_CONTACT_BLOCKED', 'Customer communication is not allowed');
      }
      if (context.rows[0].mode !== 'AI_ACTIVE') {
        throw new ApiError(409, 'FOLLOW_UP_AUTOMATION_PAUSED', 'Conversation automation is not active');
      }
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
    this.assertExecutionMode('system');
    return this.transaction(async (client) => {
      const result = await client.query(
        'SELECT * FROM public.claim_follow_up_job($1, $2, $3)',
        [workerId, now, leaseUntil],
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
      if (input.tool === 'GET_REVENUE_AT_RISK') {
        mutationResult = { commandCenter: await this.getRevenueCommandCenter(tenantId) };
      }
      if (input.tool === 'GET_PRIORITY_OPPORTUNITIES') {
        const opportunities = await client.query(
          `SELECT * FROM opportunities
           WHERE tenant_id = $1
             AND recovery_state IN ('AT_RISK','RECOVERY_ACTIVE','WAITING_FOR_CUSTOMER')
           ORDER BY recovery_score DESC, estimated_value_cents DESC NULLS LAST
           LIMIT 25`,
          [tenantId],
        );
        mutationResult = { opportunities: opportunities.rows.map(opportunityRow) };
      }
      if (input.tool === 'GET_HUMAN_REQUIRED_OPPORTUNITIES') {
        const opportunities = await client.query(
          `SELECT * FROM opportunities
           WHERE tenant_id = $1 AND recovery_state = 'HUMAN_REQUIRED'
           ORDER BY estimated_value_cents DESC NULLS LAST, updated_at DESC
           LIMIT 100`,
          [tenantId],
        );
        mutationResult = { opportunities: opportunities.rows.map(opportunityRow) };
      }
      if (input.tool === 'EXPLAIN_OPPORTUNITY_PRIORITY') {
        const opportunityId = typeof input.arguments.opportunityId === 'string'
          ? input.arguments.opportunityId
          : '';
        const opportunity = await client.query(
          'SELECT * FROM opportunities WHERE tenant_id = $1 AND id = $2',
          [tenantId, opportunityId],
        );
        if (!opportunity.rows[0]) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found');
        const record = opportunityRow(opportunity.rows[0]);
        mutationResult = {
          opportunityId,
          scores: record.scores,
          recoveryState: record.recoveryState,
          valueCents: record.estimatedValueCents,
        };
      }
      if (input.tool === 'PREPARE_OPPORTUNITY_RECOVERY') {
        const opportunityId = typeof input.arguments.opportunityId === 'string'
          ? input.arguments.opportunityId
          : '';
        if (!opportunityId) throw new ApiError(400, 'INVALID_TOOL_ARGUMENTS', 'An opportunity is required');
        const evaluation = await this.evaluateOpportunityRecovery(
          tenantId,
          opportunityId,
          actor,
          `${input.idempotencyKey}:recovery`,
          now,
        );
        const action = evaluation.action.status === 'WAITING_APPROVAL'
          ? await this.approveRecoveryAction(tenantId, opportunityId, evaluation.action.id, actor, now)
          : evaluation.action;
        mutationResult = {
          decision: evaluation.decision,
          action,
          deliveryState: 'PREPARED_ONLY',
        };
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
    this.assertExecutionMode('system');
    const result = await this.query(
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
    this.assertExecutionMode('system');
    const inserted = await this.query(
      `INSERT INTO webhook_events
        (tenant_id, provider, provider_event_id, received_at, verified, payload_hash)
       VALUES ($1,$2,$3,$4,true,$5)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING *`,
      [endpoint.tenantId, endpoint.provider, providerEventId, now, payloadHash],
    );
    if (inserted.rows[0]) return webhookRow(inserted.rows[0], false);
    const existing = await this.query(
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
    this.assertExecutionMode('system');
    await this.query(
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
    this.assertExecutionMode('system');
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

  private async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    if (!this.client || this.executionMode === 'unscoped') {
      throw new Error('PostgreSQL access requires an explicit authenticated or system execution context');
    }
    return this.client.query<Row>(text, values);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.client || this.executionMode === 'unscoped') {
      throw new Error('PostgreSQL access requires an explicit authenticated or system execution context');
    }
    try {
      return await operation(this.client);
    } catch (error) {
      throw mapPostgresError(error);
    }
  }

  private async executionTransaction<T>(
    mode: Exclude<DatabaseExecutionMode, 'unscoped'>,
    operation: (client: PoolClient, store: PostgresProductionStore) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const scopedStore = new PostgresProductionStore(this.pool, client, mode);
      const result = await operation(client, scopedStore);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapPostgresError(error);
    } finally {
      client.release();
    }
  }

  private assertRootExecutionBoundary(): void {
    if (this.client || this.executionMode !== 'unscoped') {
      throw new Error('Nested database execution contexts are not allowed');
    }
  }

  private assertExecutionMode(expected: Exclude<DatabaseExecutionMode, 'unscoped'>): void {
    if (this.executionMode !== expected) {
      throw new Error(`Database operation requires ${expected} execution context`);
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

function customerRecordRow(row: Record<string, unknown>): CustomerRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    displayName: String(row.display_name),
    phone: String(row.phone),
    email: nullableString(row.email),
    createdAt: asIso(row.created_at),
  };
}

function conversationRow(row: Record<string, unknown>): ConversationRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    leadId: String(row.lead_id),
    channel: String(row.channel),
    mode: row.mode as ConversationRecord['mode'],
    stage: String(row.stage),
    lastCustomerMessageAt: nullableIso(row.last_customer_message_at),
    lastBusinessResponseAt: nullableIso(row.last_business_response_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function leadRow(row: Record<string, unknown>): LeadRecordView {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    conversationId: String(row.conversation_id),
    serviceId: nullableString(row.service_id),
    source: String(row.source),
    workflowType: row.workflow_type as LeadRecordView['workflowType'],
    salesState: String(row.sales_state),
    status: row.status as LeadRecordView['status'],
    priority: String(row.priority),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function handoffRow(row: Record<string, unknown>): HumanHandoffRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    conversationId: String(row.conversation_id),
    reason: String(row.reason),
    detail: String(row.detail),
    startedAt: asIso(row.started_at),
    resolvedAt: nullableIso(row.resolved_at),
  };
}

function paymentViewRow(row: Record<string, unknown>): PaymentRecordView {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    leadId: String(row.lead_id),
    conversationId: String(row.conversation_id),
    referenceType: row.reference_type as PaymentRecordView['referenceType'],
    referenceId: String(row.reference_id),
    kind: row.kind as PaymentRecordView['kind'],
    status: row.status as PaymentRecordView['status'],
    amountCents: Number(row.amount_cents),
    originalPaymentId: nullableString(row.original_payment_id),
    collectedAt: asIso(row.collected_at),
  };
}

function invitationRow(row: Record<string, unknown> | undefined): OrganizationInvitationRecord {
  if (!row) throw new Error('Invitation query did not return a row');
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    role: row.role as OrganizationInvitationRecord['role'],
    expiresAt: asIso(row.expires_at),
    acceptedAt: nullableIso(row.accepted_at),
    revokedAt: nullableIso(row.revoked_at),
    createdAt: asIso(row.created_at),
    replayed: false,
  };
}

function revenueRow(row: Record<string, unknown> | undefined): RevenueLedgerEntry {
  if (!row) throw new Error('Revenue insert did not return a row');
  const base: RevenueLedgerEntry = {
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
  if ('opportunity_id' in row) base.opportunityId = nullableString(row.opportunity_id);
  if ('event_type' in row) base.eventType = row.event_type as RevenueLedgerEntry['eventType'];
  if ('attribution_type' in row) base.attributionType = row.attribution_type as RevenueLedgerEntry['attributionType'];
  if ('attribution_reason' in row) base.attributionReason = nullableString(row.attribution_reason);
  return base;
}

function opportunityRow(row: Record<string, unknown>): OpportunityRecord {
  const reasonCodes = Array.isArray(row.score_reason_codes)
    ? row.score_reason_codes.map(String)
    : [];
  const version = String(row.score_version ?? 'unscored');
  const score = (value: unknown, label: string) => ({
    value: Number(value ?? 0),
    reasonCodes,
    explanation: `${label} calculated by ${version}`,
    version,
  });
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    leadId: nullableString(row.lead_id),
    conversationId: nullableString(row.conversation_id),
    source: normalizeOpportunitySource(String(row.source)),
    opportunityType: row.opportunity_type as OpportunityRecord['opportunityType'],
    estimatedValueCents: row.estimated_value_cents === null || row.estimated_value_cents === undefined
      ? null
      : Number(row.estimated_value_cents),
    currency: String(row.currency),
    scores: {
      intent: score(row.intent_score, 'Intent'),
      revenue: score(row.revenue_score, 'Revenue'),
      recovery: score(row.recovery_score, 'Recovery'),
      urgency: score(row.urgency_score, 'Urgency'),
    },
    status: row.status as OpportunityRecord['status'],
    recoveryState: row.recovery_state as OpportunityRecord['recoveryState'],
    autonomyLevel: row.autonomy_level as OpportunityRecord['autonomyLevel'],
    assignedHumanId: nullableString(row.assigned_human_id),
    lastCustomerActivityAt: nullableIso(row.last_customer_activity_at),
    lastBusinessActivityAt: nullableIso(row.last_business_activity_at),
    nextActionAt: nullableIso(row.next_action_at),
    bookingId: nullableString(row.booking_id),
    estimateId: nullableString(row.estimate_id),
    jobId: nullableString(row.job_id),
    wonAt: nullableIso(row.won_at),
    lostAt: nullableIso(row.lost_at),
    lostReason: nullableString(row.lost_reason),
    revenueAttributedCents: Number(row.revenue_attributed_cents ?? 0),
    attributionType: row.attribution_type as OpportunityRecord['attributionType'],
    attributionReason: nullableString(row.attribution_reason),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function recoveryDecisionRow(row: Record<string, unknown>): RecoveryDecisionRecord {
  const reasonCodes = Array.isArray(row.reason_codes) ? row.reason_codes.map(String) : [];
  const version = String(row.score_version);
  const score = (value: unknown, label: string) => ({
    value: Number(value),
    reasonCodes,
    explanation: `${label} calculated by ${version}`,
    version,
  });
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    opportunityId: String(row.opportunity_id),
    playType: row.play_type as RecoveryDecisionRecord['playType'],
    eligible: Boolean(row.eligible),
    suppressionReason: nullableString(row.suppression_reason),
    scores: {
      intent: score(row.intent_score, 'Intent'),
      revenue: score(row.revenue_score, 'Revenue'),
      recovery: score(row.recovery_score, 'Recovery'),
      urgency: score(row.urgency_score, 'Urgency'),
    },
    nextBestAction: {
      kind: row.next_action_kind as RecoveryDecisionRecord['nextBestAction']['kind'],
      reasonCode: reasonCodes[0] ?? String(row.suppression_reason ?? 'RECOVERY_DECISION'),
      label: String(row.next_action_label),
      channel: row.action_channel as RecoveryDecisionRecord['nextBestAction']['channel'],
      requiresApproval: Boolean(row.requires_approval),
      dueAt: nullableIso(row.due_at),
    },
    policyVersion: String(row.policy_version),
    idempotencyKey: String(row.idempotency_key),
    decidedAt: asIso(row.decided_at),
    executedAt: nullableIso(row.executed_at),
    executionState: row.execution_state as RecoveryDecisionRecord['executionState'],
  };
}

function recoveryActionRow(row: Record<string, unknown> | undefined): RecoveryActionRecord {
  if (!row) throw new Error('Recovery action query did not return a row');
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    opportunityId: String(row.opportunity_id),
    decisionId: String(row.decision_id),
    actionKind: row.action_kind as RecoveryActionRecord['actionKind'],
    channel: row.channel as RecoveryActionRecord['channel'],
    status: row.status as RecoveryActionRecord['status'],
    requiresApproval: Boolean(row.requires_approval),
    requestedBy: row.requested_by as RecoveryActionRecord['requestedBy'],
    idempotencyKey: String(row.idempotency_key),
    validUntil: nullableIso(row.valid_until),
    approvedByUserId: nullableString(row.approved_by_user_id),
    approvedAt: nullableIso(row.approved_at),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    cancelledAt: nullableIso(row.cancelled_at),
    lastError: nullableString(row.last_error),
    deliveryState: row.delivery_state as RecoveryActionRecord['deliveryState'],
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function opportunityObservationRow(
  row: Record<string, unknown>,
  opportunity: OpportunityRecord,
  now: string,
): OpportunityObservation {
  return {
    now,
    source: opportunity.source,
    status: opportunity.status,
    recoveryState: opportunity.recoveryState,
    opportunityType: opportunity.opportunityType,
    estimatedValueCents: opportunity.estimatedValueCents,
    averageTicketCents: null,
    lastCustomerActivityAt: nullableIso(row.conversation_customer_activity) ?? opportunity.lastCustomerActivityAt,
    lastBusinessActivityAt: nullableIso(row.conversation_business_activity) ?? opportunity.lastBusinessActivityAt,
    hasCustomerReply: row.conversation_customer_activity !== null && row.conversation_customer_activity !== undefined,
    hasExplicitServiceIntent: opportunity.opportunityType !== 'OTHER',
    hasBookingRequest: ['QUALIFIED', 'BOOKED'].includes(opportunity.status),
    hasEstimate: opportunity.estimateId !== null,
    estimateViewedCount: Number(row.estimate_view_count ?? 0),
    estimateCreatedAt: nullableIso(row.estimate_created_at),
    hasExplicitRejection: opportunity.status === 'LOST' && opportunity.lostReason === 'CUSTOMER_DECLINED',
    hasActiveHandoff: row.conversation_mode === 'HUMAN_ACTIVE',
    humanRequired: opportunity.recoveryState === 'HUMAN_REQUIRED',
    optedOut: Boolean(row.opted_out),
    operationalCommunicationAllowed: Boolean(row.operational_allowed),
    withinContactWindow: Boolean(row.within_contact_window),
    followUpAttempts: Number(row.follow_up_attempts ?? 0),
    hasOtherActiveOpportunity: Boolean(row.has_other_active_opportunity),
  };
}

function normalizeOpportunitySource(source: string): OpportunitySource {
  return ['MISSED_CALL', 'PHONE', 'WEBSITE_FORM', 'WHATSAPP', 'INSTAGRAM', 'EMAIL', 'IMPORT', 'MANUAL'].includes(source)
    ? source as OpportunitySource
    : 'OTHER';
}

function revenueEventTypeForStage(stage: RevenueLedgerEntry['stage']): NonNullable<RevenueLedgerEntry['eventType']> {
  const types: Record<RevenueLedgerEntry['stage'], NonNullable<RevenueLedgerEntry['eventType']>> = {
    potential: 'ESTIMATE_CREATED',
    pipeline: 'POTENTIAL_REVENUE_AT_RISK',
    booked: 'BOOKING_CREATED',
    collected: 'PAYMENT_RECEIVED',
    refunded: 'REFUND',
    recovered: 'BOOKING_RECOVERED',
  };
  return types[stage];
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
