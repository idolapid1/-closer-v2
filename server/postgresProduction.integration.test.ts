// @vitest-environment node

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
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
let pool: Pool;
let firstApp: FastifyInstance;
let restartedApp: FastifyInstance;

describe('real PostgreSQL production activation slice', () => {
  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    await runMigrations(DATABASE_URL);
    pool = createPostgresPool(DATABASE_URL);
    await verifyDatabaseSchema(pool);
    await seedIdentityAndTenant(pool, OWNER_A, TENANT_A, 'Integration Alpha');
    await seedIdentityAndTenant(pool, OWNER_B, TENANT_B, 'Integration Beta');
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
    expect(restored.json().workspace.followUps).toHaveLength(1);
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
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}
