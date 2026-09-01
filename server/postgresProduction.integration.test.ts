// @vitest-environment node

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProductionServer } from './api/server.js';
import { StaticTokenAuthenticator } from './auth/authenticator.js';
import type { AuthenticatedIdentity } from './domain/model.js';
import { createPostgresPool } from './infrastructure/postgres.js';
import { PostgresProductionStore } from './infrastructure/postgresProductionStore.js';
import { runMigrations } from './migrate.js';
import { MapSecretProvider } from './security/secrets.js';
import { verifyDatabaseSchema } from './verifyDatabase.js';
import { HmacWebhookAdapter } from './webhooks/webhookAdapter.js';
import { WebhookService } from './webhooks/webhookService.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL!;
const OWNER_A: AuthenticatedIdentity = { userId: `integration-owner-a-${randomUUID()}`, email: 'integration-a@example.test', tokenId: null };
const OWNER_B: AuthenticatedIdentity = { userId: `integration-owner-b-${randomUUID()}`, email: 'integration-b@example.test', tokenId: null };
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const CUSTOMER_A = randomUUID();
const CUSTOMER_B = randomUUID();
const SERVICE_A = randomUUID();
let pool: Pool;
let firstApp: FastifyInstance;
let restartedApp: FastifyInstance;
let persistedOpportunityA: string;
let persistedOpportunityB: string;
let persistedRecoveryActionA: string;
let ownerAppUserA: string;

describe('real PostgreSQL production activation slice', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    await runMigrations(DATABASE_URL);
    pool = createPostgresPool(DATABASE_URL);
    await verifyDatabaseSchema(pool);
    await seedIdentityAndTenant(pool, OWNER_A, TENANT_A, 'Integration Alpha');
    await seedIdentityAndTenant(pool, OWNER_B, TENANT_B, 'Integration Beta');
    ownerAppUserA = await appUserId(OWNER_A);
    await pool.query(
      `INSERT INTO services (id, tenant_id, name, workflow_type, duration_minutes, fixed_price_cents, requires_deposit)
       VALUES ($1,$2,'Emergency HVAC repair','APPOINTMENT_SERVICE',60,940000,true)`,
      [SERVICE_A, TENANT_A],
    );
    await pool.query(
      `INSERT INTO customers (id, tenant_id, display_name, phone)
       VALUES ($1,$2,'RLS Customer A',$3), ($4,$5,'RLS Customer B',$6)`,
      [CUSTOMER_A, TENANT_A, `+97250${Date.now()}`, CUSTOMER_B, TENANT_B, `+97251${Date.now()}`],
    );
    firstApp = server(pool);
  }, 30_000);

  afterAll(async () => {
    await firstApp?.close();
    await restartedApp?.close();
    if (pool) {
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
      await pool.query('DELETE FROM app_users WHERE auth_subject = ANY($1::text[])', [[OWNER_A.userId, OWNER_B.userId]]);
      await pool.end();
    }
  });

  it('persists authenticated customer, lead, conversation and follow-up after API restart', async () => {
    const journey = await firstApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/journeys`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-journey-${randomUUID()}`,
        customer: { displayName: 'Persisted Customer', phone: `+972${Date.now()}`, email: null },
        lead: { source: 'MANUAL', workflowType: 'QUOTE_JOB', serviceId: null },
        conversation: { channel: 'MANUAL' },
      },
    });
    expect(journey.statusCode).toBe(200);
    const ids = journey.json();
    persistedOpportunityA = String(ids.opportunityId);
    const followUp = await firstApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/follow-ups`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-followup-${randomUUID()}`,
        conversationId: ids.conversationId,
        customerId: ids.customerId,
        channel: 'MANUAL',
        reason: 'Persist after restart',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        draftMessage: null,
      },
    });
    expect(followUp.statusCode).toBe(200);

    await firstApp.close();
    restartedApp = server(pool);
    const restored = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/customers/${ids.customerId}`,
      headers: bearer('owner-a'),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().workspace).toMatchObject({
      customer: { displayName: 'Persisted Customer' },
      lead: { workflowType: 'QUOTE_JOB' },
      conversation: { channel: 'MANUAL' },
    });
    expect(restored.json().workspace.opportunities).toHaveLength(1);
    expect(restored.json().workspace.opportunities[0].id).toBe(persistedOpportunityA);
    expect(restored.json().workspace.followUps).toHaveLength(1);
  });

  it('reconciles a validated PostgreSQL booking into the opportunity and non-cash ledger', async () => {
    const journey = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/journeys`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-booking-journey-${randomUUID()}`,
        customer: { displayName: 'HVAC Booking Customer', phone: `+974${Date.now()}`, email: null },
        lead: {
          source: 'MISSED_CALL', workflowType: 'APPOINTMENT_SERVICE', serviceId: SERVICE_A,
          opportunityType: 'EMERGENCY_REPAIR', estimatedValueCents: 940_000, autonomyLevel: 'SUGGEST',
        },
        conversation: { channel: 'MANUAL' },
      },
    });
    expect(journey.statusCode).toBe(200);
    const journeyIds = journey.json();
    const startAt = new Date(Date.now() + 7 * 86_400_000);
    const booking = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/bookings`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-booking-${randomUUID()}`,
        customerId: journeyIds.customerId,
        leadId: journeyIds.leadId,
        serviceId: SERVICE_A,
        staffId: ownerAppUserA,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + 60 * 60 * 1000).toISOString(),
        totalCents: 940_000,
        depositRequiredCents: 200_000,
      },
    });
    expect(booking.statusCode).toBe(200);
    const detail = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${journeyIds.opportunityId}`,
      headers: bearer('owner-a'),
    });
    expect(detail.json().opportunity).toMatchObject({
      bookingId: booking.json().bookingId,
      status: 'BOOKED',
      recoveryState: 'RECOVERED',
      revenueAttributedCents: 0,
      attributionType: 'ORGANIC',
    });
    expect(detail.json().revenueEvents).toEqual([
      expect.objectContaining({
        stage: 'booked',
        eventType: 'BOOKING_CREATED',
        amountCents: 940_000,
        attributionType: 'ORGANIC',
      }),
    ]);
  });

  it('persists policy-bound recovery actions and enforces approval, STOP, and tenant scope', async () => {
    const journey = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/journeys`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-recovery-journey-${randomUUID()}`,
        customer: { displayName: 'Recovery Customer', phone: `+971${Date.now()}`, email: null },
        lead: {
          source: 'MISSED_CALL',
          workflowType: 'APPOINTMENT_SERVICE',
          serviceId: null,
          opportunityType: 'STANDARD_REPAIR',
          estimatedValueCents: 250_000,
          autonomyLevel: 'APPROVE_TO_SEND',
        },
        conversation: { channel: 'MANUAL' },
      },
    });
    const ids = journey.json();
    const evaluation = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/evaluate-recovery`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-recovery-evaluate-${randomUUID()}` },
    });
    expect(evaluation.statusCode).toBe(200);
    expect(evaluation.json().action).toMatchObject({
      status: 'WAITING_APPROVAL',
      deliveryState: 'LIVE_DISABLED',
    });
    persistedRecoveryActionA = String(evaluation.json().action.id);

    const hostileApproval = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/recovery-actions/${persistedRecoveryActionA}/approve`,
      headers: bearer('owner-b'),
      payload: { idempotencyKey: `integration-hostile-approval-${randomUUID()}` },
    });
    expect([403, 404]).toContain(hostileApproval.statusCode);

    const [approvalOne, approvalTwo] = await Promise.all([
      restartedApp.inject({
        method: 'POST',
        url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/recovery-actions/${persistedRecoveryActionA}/approve`,
        headers: bearer('owner-a'),
        payload: { idempotencyKey: `integration-approval-${randomUUID()}` },
      }),
      restartedApp.inject({
        method: 'POST',
        url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/recovery-actions/${persistedRecoveryActionA}/approve`,
        headers: bearer('owner-a'),
        payload: { idempotencyKey: `integration-approval-${randomUUID()}` },
      }),
    ]);
    expect(approvalOne.statusCode).toBe(200);
    expect(approvalTwo.statusCode).toBe(200);
    expect(approvalOne.json().action).toMatchObject({
      id: persistedRecoveryActionA,
      status: 'READY',
      deliveryState: 'LIVE_DISABLED',
    });
    expect(approvalTwo.json().action).toMatchObject({
      id: persistedRecoveryActionA,
      status: 'READY',
      deliveryState: 'LIVE_DISABLED',
    });

    const reevaluation = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/evaluate-recovery`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-recovery-reevaluate-${randomUUID()}` },
    });
    expect(reevaluation.statusCode).toBe(200);
    expect(reevaluation.json().action).toMatchObject({ id: persistedRecoveryActionA, status: 'READY' });
    const activeDetail = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}`,
      headers: bearer('owner-a'),
    });
    expect(activeDetail.json().opportunity.recoveryState).toBe('RECOVERY_ACTIVE');
    expect(activeDetail.json().recoveryActions).toHaveLength(1);
    expect(activeDetail.json().recoveryDecisions).toHaveLength(1);
    const commandCenter = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/revenue-command-center`,
      headers: bearer('owner-a'),
    });
    expect(commandCenter.json().commandCenter).toMatchObject({
      potentialRecoveredRevenueCents: 250_000,
      actualRecoveredRevenueCents: 0,
      recoveredBookings: 0,
    });

    const takeover = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/conversations/${ids.conversationId}/handoff`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-recovery-handoff-${randomUUID()}`, reason: 'Owner review' },
    });
    expect(takeover.json().mode).toBe('HUMAN_ACTIVE');
    const humanEvaluation = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/evaluate-recovery`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-recovery-human-evaluate-${randomUUID()}` },
    });
    expect(humanEvaluation.json()).toMatchObject({
      decision: { eligible: false, suppressionReason: 'HUMAN_TAKEOVER_ACTIVE' },
      action: { status: 'HUMAN_REQUIRED' },
    });
    const resume = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/conversations/${ids.conversationId}/resume`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-recovery-resume-${randomUUID()}` },
    });
    expect(resume.json().mode).toBe('AI_ACTIVE');
    const resumedDetail = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}`,
      headers: bearer('owner-a'),
    });
    expect(resumedDetail.json().opportunity.recoveryState).toBe('AT_RISK');
    expect(resumedDetail.json().recoveryActions).toContainEqual(
      expect.objectContaining({ id: humanEvaluation.json().action.id, status: 'CANCELLED' }),
    );
    const afterResumeEvaluation = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/evaluate-recovery`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-recovery-after-resume-${randomUUID()}` },
    });
    expect(afterResumeEvaluation.json().action.status).toBe('WAITING_APPROVAL');

    await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/follow-ups`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-recovery-follow-up-${randomUUID()}`,
        conversationId: ids.conversationId,
        customerId: ids.customerId,
        channel: 'MANUAL',
        reason: 'Awaiting response',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        draftMessage: null,
      },
    });
    const optOut = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/customers/${ids.customerId}/opt-out`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-opt-out-${randomUUID()}` },
    });
    expect(optOut.json()).toMatchObject({ stoppedOpportunities: 1, cancelledFollowUps: 1 });
    const detail = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}`,
      headers: bearer('owner-a'),
    });
    expect(detail.json().opportunity).toMatchObject({ status: 'DO_NOT_CONTACT', recoveryState: 'STOPPED' });
    expect(detail.json().recoveryActions[0].status).toBe('CANCELLED');

    const blockedFollowUp = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/follow-ups`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-recovery-blocked-follow-up-${randomUUID()}`,
        conversationId: ids.conversationId,
        customerId: ids.customerId,
        channel: 'MANUAL',
        reason: 'Must remain stopped',
        dueAt: new Date(Date.now() + 172_800_000).toISOString(),
        draftMessage: null,
      },
    });
    expect(blockedFollowUp.statusCode).toBe(409);
    expect(blockedFollowUp.json().error.code).toBe('FOLLOW_UP_CONTACT_BLOCKED');
  });

  it('deduplicates a PostgreSQL customer response and reconciles stale automation', async () => {
    const journey = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/journeys`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-response-journey-${randomUUID()}`,
        customer: { displayName: 'Reply Customer', phone: `+970${Date.now()}`, email: null },
        lead: {
          source: 'MISSED_CALL', workflowType: 'APPOINTMENT_SERVICE', serviceId: null,
          opportunityType: 'STANDARD_REPAIR', estimatedValueCents: 300_000, autonomyLevel: 'SUGGEST',
        },
        conversation: { channel: 'MANUAL' },
      },
    });
    const ids = journey.json();
    const evaluation = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/evaluate-recovery`,
      headers: bearer('owner-a'),
      payload: { idempotencyKey: `integration-response-evaluate-${randomUUID()}` },
    });
    expect(evaluation.json().decision.executionState).toBe('SUGGESTED');
    expect(evaluation.json().action.status).toBe('PENDING');
    const providerMessageId = `integration-provider-${randomUUID()}`;
    const first = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/customer-responses`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-response-operation-${randomUUID()}`,
        providerMessageId,
        body: 'Please book the visit.',
      },
    });
    const replay = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}/customer-responses`,
      headers: bearer('owner-a'),
      payload: {
        idempotencyKey: `integration-response-operation-${randomUUID()}`,
        providerMessageId,
        body: 'Please book the visit.',
      },
    });
    expect(first.json()).toMatchObject({ providerReplay: false });
    expect(replay.json()).toMatchObject({ messageId: first.json().messageId, providerReplay: true });
    const detail = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${ids.opportunityId}`,
      headers: bearer('owner-a'),
    });
    expect(detail.json().opportunity).toMatchObject({ status: 'ENGAGED', recoveryState: 'NOT_AT_RISK' });
    expect(detail.json().recoveryActions[0].status).toBe('CANCELLED');
    const messageCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM messages WHERE tenant_id = $1 AND provider_message_id = $2',
      [TENANT_A, providerMessageId],
    );
    expect(messageCount.rows[0]?.count).toBe(1);
  });

  it('denies cross-tenant customer ID guessing in PostgreSQL', async () => {
    const tenantBCustomer = await restartedApp.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_B}/journeys`,
      headers: bearer('owner-b'),
      payload: {
        idempotencyKey: `integration-b-${randomUUID()}`,
        customer: { displayName: 'Tenant B Customer', phone: `+973${Date.now()}`, email: null },
        lead: { source: 'MANUAL', workflowType: 'APPOINTMENT_SERVICE', serviceId: null },
        conversation: { channel: 'MANUAL' },
      },
    });
    const guessed = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/customers/${tenantBCustomer.json().customerId}`,
      headers: bearer('owner-a'),
    });
    expect(guessed.statusCode).toBe(404);
    persistedOpportunityB = String(tenantBCustomer.json().opportunityId);
    const guessedOpportunity = await restartedApp.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_A}/opportunities/${persistedOpportunityB}`,
      headers: bearer('owner-a'),
    });
    expect(guessedOpportunity.statusCode).toBe(404);
  });

  it('enforces hostile tenant reads under the NOBYPASSRLS API role', async () => {
    const appUserA = await appUserId(OWNER_A);
    const appUserB = await appUserId(OWNER_B);

    const visibleToA = await queryAsAppUser(appUserA, async (client) => client.query(
      'SELECT id, tenant_id FROM customers WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[CUSTOMER_A, CUSTOMER_B]],
    ));
    expect(visibleToA.rows).toEqual([{ id: CUSTOMER_A, tenant_id: TENANT_A }]);

    const tenantRowsA = await queryAsAppUser(appUserA, async (client) => client.query(
      'SELECT id FROM tenants WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[TENANT_A, TENANT_B]],
    ));
    expect(tenantRowsA.rows).toEqual([{ id: TENANT_A }]);

    const visibleToB = await queryAsAppUser(appUserB, async (client) => client.query(
      'SELECT id, tenant_id FROM customers WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[CUSTOMER_A, CUSTOMER_B]],
    ));
    expect(visibleToB.rows).toEqual([{ id: CUSTOMER_B, tenant_id: TENANT_B }]);

    const opportunityA = await queryAsAppUser(appUserA, async (client) => client.query(
      'SELECT id FROM opportunities WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[persistedOpportunityA, persistedOpportunityB]],
    ));
    expect(opportunityA.rows).toEqual([{ id: persistedOpportunityA }]);
    const opportunityB = await queryAsAppUser(appUserB, async (client) => client.query(
      'SELECT id FROM opportunities WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[persistedOpportunityA, persistedOpportunityB]],
    ));
    expect(opportunityB.rows).toEqual([{ id: persistedOpportunityB }]);

    const recoveryActionA = await queryAsAppUser(appUserA, async (client) => client.query(
      'SELECT id FROM recovery_actions WHERE id = $1',
      [persistedRecoveryActionA],
    ));
    expect(recoveryActionA.rows).toEqual([{ id: persistedRecoveryActionA }]);
    const recoveryActionB = await queryAsAppUser(appUserB, async (client) => client.query(
      'SELECT id FROM recovery_actions WHERE id = $1',
      [persistedRecoveryActionA],
    ));
    expect(recoveryActionB.rows).toEqual([]);
  });

  it('does not retain request identity when a pooled connection is reused', async () => {
    const appUserA = await appUserId(OWNER_A);
    const appUserB = await appUserId(OWNER_B);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE closer_api');
      await client.query("SELECT set_config('app.user_id', $1, true)", [appUserA]);
      const firstRequest = await client.query('SELECT id FROM customers WHERE id = ANY($1::uuid[])', [
        [CUSTOMER_A, CUSTOMER_B],
      ]);
      expect(firstRequest.rows).toEqual([{ id: CUSTOMER_A }]);
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE closer_api');
      const clearedIdentity = await client.query("SELECT current_setting('app.user_id', true) AS app_user_id");
      expect([null, '']).toContain(clearedIdentity.rows[0]?.app_user_id ?? null);
      await client.query("SELECT set_config('app.user_id', $1, true)", [appUserB]);
      const secondRequest = await client.query('SELECT id FROM customers WHERE id = ANY($1::uuid[])', [
        [CUSTOMER_A, CUSTOMER_B],
      ]);
      expect(secondRequest.rows).toEqual([{ id: CUSTOMER_B }]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('refuses tenant queries outside an explicit database execution context', async () => {
    const store = new PostgresProductionStore(pool);
    await expect(store.listCustomers(TENANT_A)).rejects.toThrow(/explicit authenticated or system execution context/);
  });
});

function server(databasePool: Pool): FastifyInstance {
  const store = new PostgresProductionStore(databasePool);
  const authenticator = new StaticTokenAuthenticator(new Map([['owner-a', OWNER_A], ['owner-b', OWNER_B]]));
  return buildProductionServer({
    store,
    authenticator,
    webhookService: new WebhookService(store, new MapSecretProvider(new Map()), [new HmacWebhookAdapter('mock')]),
    requestRateLimit: 1_000,
    webhookRateLimit: 1_000,
    now: () => new Date('2026-08-30T14:00:00.000Z'),
  });
}

async function seedIdentityAndTenant(databasePool: Pool, identity: AuthenticatedIdentity, tenantId: string, name: string) {
  const userId = randomUUID();
  await databasePool.query(
    `INSERT INTO app_users (id, auth_subject, email) VALUES ($1,$2,$3)
     ON CONFLICT (auth_subject) DO UPDATE SET email = EXCLUDED.email`,
    [userId, identity.userId, identity.email],
  );
  const user = await databasePool.query('SELECT id FROM app_users WHERE auth_subject = $1', [identity.userId]);
  await databasePool.query('INSERT INTO tenants (id, name) VALUES ($1,$2)', [tenantId, name]);
  await databasePool.query(
    `INSERT INTO organization_memberships (tenant_id, user_id, role, active)
     VALUES ($1,$2,'owner',true)`,
    [tenantId, user.rows[0]!.id],
  );
  await databasePool.query(
    `INSERT INTO recovery_play_definitions (tenant_id, play_type)
     SELECT $1, play_type::recovery_play_type
     FROM unnest(ARRAY[
       'MISSED_CALL_RECOVERY', 'NEW_LEAD_RECOVERY',
       'UNSOLD_ESTIMATE_RECOVERY', 'OLD_LEAD_REACTIVATION'
     ]) AS play_type`,
    [tenantId],
  );
}

async function appUserId(identity: AuthenticatedIdentity): Promise<string> {
  const result = await pool.query('SELECT id FROM app_users WHERE auth_subject = $1', [identity.userId]);
  return String(result.rows[0]!.id);
}

async function queryAsAppUser<T>(
  userId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE closer_api');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}
