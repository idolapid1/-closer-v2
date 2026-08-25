// @vitest-environment node

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProductionServer } from './api/server.js';
import { InvitationService } from './application/invitations.js';
import { StaticTokenAuthenticator } from './auth/authenticator.js';
import { loadServerConfig } from './config.js';
import type { AuthenticatedIdentity, FollowUpJobRecord } from './domain/model.js';
import { InMemoryProductionStore } from './infrastructure/inMemoryProductionStore.js';
import { DistributedRateLimiter } from './security/rateLimiter.js';
import { MapSecretProvider } from './security/secrets.js';
import { HmacWebhookAdapter } from './webhooks/webhookAdapter.js';
import { WebhookService } from './webhooks/webhookService.js';

const NOW = '2026-08-25T09:00:00.000Z';
const OWNER: AuthenticatedIdentity = { userId: 'owner-subject', email: 'owner@example.test', tokenId: 'owner-token' };
const MEMBER: AuthenticatedIdentity = { userId: 'member-subject', email: 'member@example.test', tokenId: 'member-token' };
const INVITEE: AuthenticatedIdentity = { userId: 'invitee-subject', email: 'invitee@example.test', tokenId: 'invitee-token' };
const OTHER: AuthenticatedIdentity = { userId: 'other-subject', email: 'other@example.test', tokenId: 'other-token' };
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('production activation environment and lifecycle boundary', () => {
  it('requires HTTPS origins and forbids development invitation links in production', () => {
    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://closer:secret@db.example.test/postgres',
      AUTH_JWKS_URL: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
      AUTH_ISSUER: 'https://project.supabase.co/auth/v1',
      AUTH_AUDIENCE: 'authenticated',
      FRONTEND_ORIGIN: 'http://app.example.test',
      CONNECTOR_EXECUTION_MODE: 'mock',
      ALLOW_DEVELOPMENT_INVITE_LINKS: 'true',
      DEVELOPMENT_INVITE_BASE_URL: 'https://app.example.test/accept-invite',
    })).toThrow(/FRONTEND_ORIGIN.*ALLOW_DEVELOPMENT_INVITE_LINKS/);
  });

  it('keeps liveness separate from readiness and returns safe readiness reasons', async () => {
    const unavailable = activationHarness({ readiness: undefined }).app;
    expect((await unavailable.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ status: 'ok' });
    const notConfigured = await unavailable.inject({ method: 'GET', url: '/ready' });
    expect(notConfigured.statusCode).toBe(503);
    expect(notConfigured.json()).toEqual({ status: 'not_ready', reason: 'READINESS_NOT_CONFIGURED' });

    const ready = activationHarness({ readiness: async () => ({ status: 'ready' as const }) }).app;
    const response = await ready.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it('delegates distributed rate decisions without pretending memory is shared', async () => {
    const increment = vi.fn(async () => true);
    const limiter = new DistributedRateLimiter({ increment }, 50, 5_000);
    await expect(limiter.allow('tenant:user', 123)).resolves.toBe(true);
    expect(increment).toHaveBeenCalledWith('tenant:user', 5_000, 50, 123);
  });
});

describe('production owner read models remain tenant scoped', () => {
  it('returns one authenticated tenant snapshot and customer workspace only', async () => {
    const { app } = activationHarness();
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/owner-snapshot',
      headers: bearer('owner'),
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().snapshot.customers.map((customer: { id: string }) => customer.id)).toEqual(['customer-a']);
    expect(snapshot.json().snapshot.followUps.map((followUp: { id: string }) => followUp.id)).toEqual(['followup-a']);

    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/customers/customer-a',
      headers: bearer('member'),
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json().workspace.customer.id).toBe('customer-a');

    const guessedTenant = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-b/customers/customer-b',
      headers: bearer('owner'),
    });
    expect(guessedTenant.statusCode).toBe(404);
  });

  it('does not expose another tenant customer through a valid tenant route', async () => {
    const { app } = activationHarness();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/customers/customer-b',
      headers: bearer('owner'),
    });
    expect(response.statusCode).toBe(404);
  });

  it('denies a user whose membership is no longer active', async () => {
    const inactiveStore = new InMemoryProductionStore({
      memberships: [{ userId: OWNER.userId, membership: { tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: false } }],
    });
    const { app } = activationHarness({ store: inactiveStore });
    const response = await app.inject({ method: 'GET', url: '/api/v1/tenants/tenant-a/owner-snapshot', headers: bearer('owner') });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('persists one logical customer-to-follow-up slice across repeated API reads', async () => {
    const { app } = activationHarness();
    const payload = {
      idempotencyKey: 'activation-journey-001',
      customer: { displayName: 'New Production Customer', phone: '+972501234567', email: null },
      lead: { source: 'MANUAL', workflowType: 'QUOTE_JOB', serviceId: null },
      conversation: { channel: 'MANUAL' },
    };
    const first = await app.inject({ method: 'POST', url: '/api/v1/tenants/tenant-a/journeys', headers: bearer('member'), payload });
    const replay = await app.inject({ method: 'POST', url: '/api/v1/tenants/tenant-a/journeys', headers: bearer('member'), payload });
    expect(replay.json()).toEqual({ ...first.json(), replayed: true });
    const ids = first.json();
    const scheduled = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-a/follow-ups',
      headers: bearer('owner'),
      payload: {
        idempotencyKey: 'activation-follow-up-001',
        conversationId: ids.conversationId,
        customerId: ids.customerId,
        channel: 'MANUAL',
        reason: 'Continue qualification',
        dueAt: '2026-08-26T09:00:00.000Z',
        draftMessage: null,
      },
    });
    expect(scheduled.statusCode).toBe(200);
    const workspace = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/tenant-a/customers/${ids.customerId}`,
      headers: bearer('member'),
    });
    expect(workspace.json().workspace).toMatchObject({
      customer: { displayName: 'New Production Customer' },
      lead: { workflowType: 'QUOTE_JOB' },
      conversation: { channel: 'MANUAL' },
    });
    expect(workspace.json().workspace.followUps).toHaveLength(1);
    const snapshot = await app.inject({ method: 'GET', url: '/api/v1/tenants/tenant-a/owner-snapshot', headers: bearer('owner') });
    expect(snapshot.json().snapshot.customers.filter((customer: { phone: string }) => customer.phone === '+972501234567')).toHaveLength(1);
  });
});

describe('organization invitations', () => {
  it('fails closed when no invitation delivery boundary is configured', async () => {
    const invitations = new InvitationService(activationStore(), { now: () => new Date(NOW) });
    await expect(invitations.create('tenant-a', OWNER, {
      email: INVITEE.email!,
      role: 'member',
      idempotencyKey: 'invite-disabled-001',
    })).rejects.toMatchObject({ statusCode: 503, code: 'INVITATION_DELIVERY_DISABLED' });
  });

  it('allows owner invitation, stores only a hash, accepts once, and grants only that tenant', async () => {
    const { app, store } = activationHarness();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-a/invitations',
      headers: bearer('owner'),
      payload: { email: INVITEE.email, role: 'member', idempotencyKey: 'invite-create-001' },
    });
    expect(created.statusCode).toBe(200);
    const developmentUrl = created.json().developmentAcceptanceUrl as string;
    const token = new URL(developmentUrl).searchParams.get('token');
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(created.json())).not.toContain('tokenHash');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: bearer('invitee'),
      payload: { token },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ tenantId: 'tenant-a', role: 'member' });
    await expect(store.getMembership(INVITEE.userId, 'tenant-a')).resolves.toMatchObject({ role: 'member', active: true });
    await expect(store.getMembership(INVITEE.userId, 'tenant-b')).resolves.toBeNull();

    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: bearer('invitee'),
      payload: { token },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('INVITATION_ALREADY_USED');
  });

  it('blocks members from inviting and blocks acceptance by a different email', async () => {
    const { app } = activationHarness();
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-a/invitations',
      headers: bearer('member'),
      payload: { email: INVITEE.email, role: 'member', idempotencyKey: 'invite-denied-001' },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-a/invitations',
      headers: bearer('owner'),
      payload: { email: INVITEE.email, role: 'admin', idempotencyKey: 'invite-email-001' },
    });
    const token = new URL(created.json().developmentAcceptanceUrl as string).searchParams.get('token');
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: bearer('other'),
      payload: { token },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().error.code).toBe('INVITATION_EMAIL_MISMATCH');
  });

  it('does not return a newly generated invalid development token on idempotent replay', async () => {
    const { app } = activationHarness();
    const payload = { email: INVITEE.email, role: 'member', idempotencyKey: 'invite-replay-001' };
    const first = await app.inject({ method: 'POST', url: '/api/v1/tenants/tenant-a/invitations', headers: bearer('owner'), payload });
    const replay = await app.inject({ method: 'POST', url: '/api/v1/tenants/tenant-a/invitations', headers: bearer('owner'), payload });
    expect(first.json().developmentAcceptanceUrl).toBeTypeOf('string');
    expect(replay.json().invitation.replayed).toBe(true);
    expect(replay.json()).not.toHaveProperty('developmentAcceptanceUrl');
  });

  it('rejects expired invitation tokens deterministically', async () => {
    const store = activationStore();
    let current = new Date(NOW);
    const invitations = new InvitationService(store, {
      lifetimeMilliseconds: 1_000,
      now: () => current,
      exposeDevelopmentLink: true,
      developmentAcceptanceBaseUrl: 'http://127.0.0.1:5173/accept-invite',
    });
    const created = await invitations.create('tenant-a', OWNER, {
      email: INVITEE.email!,
      role: 'member',
      idempotencyKey: 'invite-expiry-001',
    });
    current = new Date(current.getTime() + 1_001);
    const token = new URL(created.developmentAcceptanceUrl!).searchParams.get('token')!;
    await expect(invitations.accept(token, INVITEE)).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
  });
});

function activationHarness(options: {
  readiness?: (() => Promise<{ status: 'ready' } | { status: 'not_ready'; reason: string }>) | undefined;
  store?: InMemoryProductionStore;
} = {}) {
  const store = options.store ?? activationStore();
  const authenticator = new StaticTokenAuthenticator(new Map([
    ['owner', OWNER],
    ['member', MEMBER],
    ['invitee', INVITEE],
    ['other', OTHER],
  ]));
  const webhookService = new WebhookService(
    store,
    new MapSecretProvider(new Map()),
    [new HmacWebhookAdapter('mock')],
    () => new Date(NOW),
  );
  const app = buildProductionServer({
    store,
    authenticator,
    webhookService,
    now: () => new Date(NOW),
    requestRateLimit: 1_000,
    webhookRateLimit: 1_000,
    exposeDevelopmentInviteLinks: true,
    developmentInviteBaseUrl: 'http://127.0.0.1:5173/accept-invite',
    ...(options.readiness ? { readiness: options.readiness } : {}),
  });
  apps.push(app);
  return { app, store };
}

function activationStore() {
  return new InMemoryProductionStore({
    memberships: [
      { userId: OWNER.userId, membership: { tenantId: 'tenant-a', tenantName: 'Alpha', role: 'owner', active: true } },
      { userId: MEMBER.userId, membership: { tenantId: 'tenant-a', tenantName: 'Alpha', role: 'member', active: true } },
      { userId: OTHER.userId, membership: { tenantId: 'tenant-b', tenantName: 'Beta', role: 'owner', active: true } },
    ],
    customers: [
      { id: 'customer-a', tenantId: 'tenant-a', displayName: 'Dana A', phone: '+972500000001', email: null, createdAt: NOW },
      { id: 'customer-b', tenantId: 'tenant-b', displayName: 'Dana B', phone: '+972500000002', email: null, createdAt: NOW },
    ],
    leads: [
      { id: 'lead-a', tenantId: 'tenant-a', customerId: 'customer-a', conversationId: 'conversation-a', source: 'WHATSAPP', workflowType: 'APPOINTMENT_SERVICE', serviceId: null, status: 'ACTIVE', marketingAllowed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'lead-b', tenantId: 'tenant-b', customerId: 'customer-b', conversationId: 'conversation-b', source: 'WHATSAPP', workflowType: 'QUOTE_JOB', serviceId: null, status: 'ACTIVE', marketingAllowed: false, createdAt: NOW, updatedAt: NOW },
    ],
    conversations: [
      conversation('conversation-a', 'tenant-a', 'customer-a', 'lead-a'),
      conversation('conversation-b', 'tenant-b', 'customer-b', 'lead-b'),
    ],
    followUps: [followUp('followup-a', 'tenant-a', 'customer-a', 'conversation-a'), followUp('followup-b', 'tenant-b', 'customer-b', 'conversation-b')],
  });
}

function conversation(id: string, tenantId: string, customerId: string, leadId: string) {
  return { id, tenantId, customerId, leadId, channel: 'WHATSAPP', mode: 'AI_ACTIVE' as const, stage: 'NEW_INQUIRY', lastCustomerMessageAt: null, lastBusinessResponseAt: null, createdAt: NOW, updatedAt: NOW };
}

function followUp(id: string, tenantId: string, customerId: string, conversationId: string): FollowUpJobRecord {
  return { id, tenantId, customerId, conversationId, channel: 'WHATSAPP', reason: 'Follow up', status: 'scheduled', dueAt: NOW, attemptCount: 0, maxAttempts: 5, leaseOwner: null, leaseExpiresAt: null, retryAt: null, lastError: null, stopReason: null, manualOverride: false, lastResponseAt: null, completedAt: null, cancelledAt: null, idempotencyKey: id, draftMessage: null, createdAt: NOW };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}
