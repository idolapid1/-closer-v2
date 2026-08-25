// @vitest-environment node

import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProductionServer } from './api/server.js';
import { JwtAuthenticator, StaticTokenAuthenticator } from './auth/authenticator.js';
import { loadServerConfig } from './config.js';
import type { AuthenticatedIdentity, FollowUpJobRecord } from './domain/model.js';
import { InMemoryProductionStore } from './infrastructure/inMemoryProductionStore.js';
import {
  DeterministicMockFollowUpDispatcher,
  FollowUpWorker,
} from './jobs/followUpWorker.js';
import { MapSecretProvider } from './security/secrets.js';
import { HmacWebhookAdapter } from './webhooks/webhookAdapter.js';
import { WebhookService } from './webhooks/webhookService.js';

const NOW = '2026-08-25T09:00:00.000Z';
const OWNER_A: AuthenticatedIdentity = { userId: 'user-owner-a', email: 'owner-a@example.test', tokenId: 'token-a' };
const ADMIN_A: AuthenticatedIdentity = { userId: 'user-admin-a', email: 'admin-a@example.test', tokenId: 'token-admin-a' };
const MEMBER_A: AuthenticatedIdentity = { userId: 'user-member-a', email: 'member-a@example.test', tokenId: 'token-member-a' };
const OWNER_B: AuthenticatedIdentity = { userId: 'user-owner-b', email: 'owner-b@example.test', tokenId: 'token-b' };

const runningApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.close()));
});

describe('production authentication and tenant authorization boundary', () => {
  it('fails closed when production database or authentication configuration is missing', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://closer:closer@localhost:5432/closer',
      AUTH_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
      AUTH_ISSUER: 'https://auth.example.test',
      CONNECTOR_EXECUTION_MODE: 'live',
    })).toThrow(/CONNECTOR_EXECUTION_MODE/);
  });

  it('verifies issuer, audience, signature, and subject on real JWTs', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = 'closer-test-key';
    publicJwk.alg = 'RS256';
    const authenticator = new JwtAuthenticator(
      createLocalJWKSet({ keys: [publicJwk] }),
      { issuer: 'https://auth.example.test', audience: 'closer-api' },
    );
    const token = await new SignJWT({ email: 'owner@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'closer-test-key' })
      .setSubject('user-jwt-owner')
      .setIssuer('https://auth.example.test')
      .setAudience('closer-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(authenticator.authenticate(`Bearer ${token}`)).resolves.toMatchObject({
      userId: 'user-jwt-owner',
      email: 'owner@example.test',
    });
    await expect(authenticator.authenticate(`Bearer ${token.slice(0, -2)}xx`)).resolves.toBeNull();
  });

  it('rejects unauthenticated API calls with a safe response', async () => {
    const { app } = harness();
    const response = await app.inject({ method: 'GET', url: '/api/v1/tenants/tenant-a/customers' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' },
    });
    expect(response.body).not.toContain('stack');
  });

  it.each([
    ['/customers', 'customers'],
    ['/conversations', 'conversations'],
    ['/revenue', 'revenue'],
  ])('prevents Tenant A from reading Tenant B%s', async (suffix) => {
    const { app } = harness();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/tenant-b${suffix}`,
      headers: authorization('owner-a'),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('returns only tenant-scoped customers and conversations to a valid member', async () => {
    const { app } = harness();
    const customers = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/customers',
      headers: authorization('member-a'),
    });
    const conversations = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/conversations',
      headers: authorization('member-a'),
    });
    expect(customers.statusCode).toBe(200);
    expect(customers.json().customers.map((customer: { id: string }) => customer.id)).toEqual(['customer-a']);
    expect(conversations.json().conversations.map((conversation: { id: string }) => conversation.id)).toEqual(['conversation-a']);
  });

  it('provisions an authenticated user as owner of a new tenant idempotently', async () => {
    const { app } = harness();
    const payload = { name: 'New Service Business', idempotencyKey: 'provision-business-001' };
    const first = await post(app, '/api/v1/organizations', 'member-a', payload);
    const replay = await post(app, '/api/v1/organizations', 'member-a', payload);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ role: 'owner', replayed: false });
    expect(replay.json()).toEqual({ ...first.json(), replayed: true });
    const tenants = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: authorization('member-a'),
    });
    expect(tenants.json().tenants).toContainEqual({
      tenantId: first.json().tenantId,
      tenantName: 'New Service Business',
      role: 'owner',
      active: true,
    });
  });

  it('enforces role permissions for connector configuration and never returns secret references', async () => {
    const { app } = harness();
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/connectors',
      headers: authorization('member-a'),
    });
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/connectors',
      headers: authorization('admin-a'),
    });
    expect(denied.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().connectors[0]).toMatchObject({
      provider: 'mock',
      mode: 'mock',
      secretConfigured: true,
    });
    expect(allowed.body).not.toContain('CLOSER_SECRET');
    expect(allowed.body).not.toContain('webhook-secret');
  });

  it('blocks cross-tenant follow-up mutations before inspecting the guessed resource ID', async () => {
    const { app } = harness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-b/follow-ups/follow-up-b/cancel',
      headers: authorization('admin-a'),
      payload: { idempotencyKey: 'cancel-cross-tenant-001' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('blocks members from mutating follow-ups while allowing tenant admins', async () => {
    const { app } = harness();
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-a/follow-ups/follow-up-a/cancel',
      headers: authorization('member-a'),
      payload: { idempotencyKey: 'cancel-follow-up-member' },
    });
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-a/follow-ups/follow-up-a/cancel',
      headers: authorization('admin-a'),
      payload: { idempotencyKey: 'cancel-follow-up-admin' },
    });
    expect(denied.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().followUp.status).toBe('cancelled');
  });

  it('enforces explicit Human Takeover and explicit Resume AI on the server', async () => {
    const { app } = harness();
    const takeoverPayload = {
      idempotencyKey: 'handoff-conversation-a-001',
      reason: 'Customer explicitly asked for a person',
    };
    const takeover = await post(
      app,
      '/api/v1/tenants/tenant-a/conversations/conversation-a/handoff',
      'admin-a',
      takeoverPayload,
    );
    const takeoverReplay = await post(
      app,
      '/api/v1/tenants/tenant-a/conversations/conversation-a/handoff',
      'admin-a',
      takeoverPayload,
    );
    expect(takeover.json()).toMatchObject({ mode: 'HUMAN_ACTIVE', replayed: false });
    expect(takeoverReplay.json()).toMatchObject({ handoffId: takeover.json().handoffId, replayed: true });

    const duringTakeover = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/conversations',
      headers: authorization('member-a'),
    });
    expect(duringTakeover.json().conversations[0].mode).toBe('HUMAN_ACTIVE');

    const resume = await post(
      app,
      '/api/v1/tenants/tenant-a/conversations/conversation-a/resume',
      'admin-a',
      { idempotencyKey: 'resume-conversation-a-001' },
    );
    expect(resume.json()).toMatchObject({ mode: 'AI_ACTIVE', replayed: false });
    const duplicateNewOperation = await post(
      app,
      '/api/v1/tenants/tenant-a/conversations/conversation-a/resume',
      'admin-a',
      { idempotencyKey: 'resume-conversation-a-002' },
    );
    expect(duplicateNewOperation.statusCode).toBe(409);
    expect(duplicateNewOperation.json().error.code).toBe('NO_ACTIVE_HANDOFF');
  });

  it('rejects malformed and guessed IDs without exposing database details', async () => {
    const { app } = harness();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/%2E%2E%2Ftenant-b/customers',
      headers: authorization('owner-a'),
    });
    expect([400, 404]).toContain(response.statusCode);
    expect(response.body).not.toMatch(/postgres|SELECT|stack/i);
  });
});

describe('server idempotency and complete authenticated revenue chain', () => {
  it('creates one customer, lead, and conversation and replays the same operation safely', async () => {
    const { app } = harness();
    const payload = journeyPayload('journey-idempotency-001');
    const first = await post(app, '/api/v1/tenants/tenant-a/journeys', 'member-a', payload);
    const second = await post(app, '/api/v1/tenants/tenant-a/journeys', 'member-a', payload);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ...first.json(), replayed: true });

    const customers = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/customers',
      headers: authorization('member-a'),
    });
    expect(customers.json().customers).toHaveLength(2);
  });

  it('rejects reuse of an idempotency key with different business facts', async () => {
    const { app } = harness();
    await post(app, '/api/v1/tenants/tenant-a/journeys', 'member-a', journeyPayload('journey-conflict-001'));
    const conflicting = journeyPayload('journey-conflict-001');
    conflicting.customer.displayName = 'Different customer';
    const response = await post(app, '/api/v1/tenants/tenant-a/journeys', 'member-a', conflicting);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('supports User → Tenant → Customer → Lead → Conversation → Follow-up → Booking → Payment → Revenue', async () => {
    const { app } = harness();
    const journey = await post(
      app,
      '/api/v1/tenants/tenant-a/journeys',
      'member-a',
      journeyPayload('journey-full-chain-001'),
    );
    const ids = journey.json();
    const followUp = await post(app, '/api/v1/tenants/tenant-a/follow-ups', 'admin-a', {
      idempotencyKey: 'follow-up-full-chain-001',
      conversationId: ids.conversationId,
      customerId: ids.customerId,
      channel: 'WHATSAPP',
      reason: 'Booking confirmation missing',
      dueAt: '2026-08-25T10:00:00.000Z',
      draftMessage: 'Would you like to confirm the appointment?',
    });
    expect(followUp.statusCode).toBe(200);

    const booking = await post(app, '/api/v1/tenants/tenant-a/bookings', 'admin-a', {
      idempotencyKey: 'booking-full-chain-001',
      customerId: ids.customerId,
      leadId: ids.leadId,
      serviceId: 'service-clinic',
      staffId: 'staff-clinic',
      startAt: '2026-08-26T09:00:00.000Z',
      endAt: '2026-08-26T10:00:00.000Z',
      totalCents: 80_000,
      depositRequiredCents: 20_000,
    });
    expect(booking.statusCode).toBe(200);

    const paymentPayload = {
      idempotencyKey: 'payment-full-chain-001',
      customerId: ids.customerId,
      leadId: ids.leadId,
      conversationId: ids.conversationId,
      referenceType: 'APPOINTMENT',
      referenceId: booking.json().bookingId,
      kind: 'BALANCE',
      amountCents: 80_000,
      originalPaymentId: null,
    };
    const payment = await post(app, '/api/v1/tenants/tenant-a/payments', 'admin-a', paymentPayload);
    const paymentReplay = await post(app, '/api/v1/tenants/tenant-a/payments', 'admin-a', paymentPayload);
    expect(payment.statusCode).toBe(200);
    expect(paymentReplay.json()).toEqual({ ...payment.json(), replayed: true });

    const revenue = await post(app, '/api/v1/tenants/tenant-a/revenue-events', 'admin-a', {
      idempotencyKey: 'revenue-full-chain-001',
      customerId: ids.customerId,
      leadId: ids.leadId,
      conversationId: ids.conversationId,
      paymentId: payment.json().paymentId,
      stage: 'collected',
      amountCents: 80_000,
      causationKey: 'payment-full-chain-001',
    });
    expect(revenue.statusCode).toBe(200);

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/revenue',
      headers: authorization('owner-a'),
    });
    expect(summary.json().revenue.collectedCents).toBe(80_000);
  });

  it('nets a validated refund from collected attribution without double counting', async () => {
    const { app } = harness();
    const context = await createPaidJourney(app, 'refund-case');
    const refund = await post(app, '/api/v1/tenants/tenant-a/payments', 'admin-a', {
      idempotencyKey: 'refund-payment-case-001',
      customerId: context.customerId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      referenceType: 'APPOINTMENT',
      referenceId: context.bookingId,
      kind: 'REFUND',
      amountCents: 20_000,
      originalPaymentId: context.paymentId,
    });
    expect(refund.statusCode).toBe(200);
    await post(app, '/api/v1/tenants/tenant-a/revenue-events', 'admin-a', {
      idempotencyKey: 'refund-revenue-case-001',
      customerId: context.customerId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      paymentId: refund.json().paymentId,
      stage: 'refunded',
      amountCents: 20_000,
      causationKey: 'refund-payment-case-001',
    });
    const replay = await post(app, '/api/v1/tenants/tenant-a/revenue-events', 'admin-a', {
      idempotencyKey: 'refund-revenue-case-001',
      customerId: context.customerId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      paymentId: refund.json().paymentId,
      stage: 'refunded',
      amountCents: 20_000,
      causationKey: 'refund-payment-case-001',
    });
    expect(replay.json().replayed).toBe(true);
    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-a/revenue',
      headers: authorization('owner-a'),
    });
    expect(summary.json().revenue).toMatchObject({ collectedCents: 60_000, refundedCents: 20_000 });
  });

  it('rejects a payment linked to a different tenant journey context', async () => {
    const { app } = harness();
    const response = await post(app, '/api/v1/tenants/tenant-a/payments', 'admin-a', {
      idempotencyKey: 'wrong-context-payment-001',
      customerId: 'customer-a',
      leadId: 'lead-guessed-from-b',
      conversationId: 'conversation-a',
      referenceType: 'APPOINTMENT',
      referenceId: 'booking-guessed-from-b',
      kind: 'BALANCE',
      amountCents: 1_000,
      originalPaymentId: null,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_JOURNEY_CONTEXT');
  });

  it('prevents concurrent booking side effects for the same staff time range', async () => {
    const { app } = harness();
    const firstJourney = await post(app, '/api/v1/tenants/tenant-a/journeys', 'member-a', journeyPayload('journey-booking-race-a'));
    const secondJourney = await post(app, '/api/v1/tenants/tenant-a/journeys', 'member-a', journeyPayload('journey-booking-race-b'));
    const bookingFor = (ids: Record<string, string>, key: string) => post(
      app,
      '/api/v1/tenants/tenant-a/bookings',
      'admin-a',
      {
        idempotencyKey: key,
        customerId: ids.customerId,
        leadId: ids.leadId,
        serviceId: 'service-clinic',
        staffId: 'staff-clinic',
        startAt: '2026-08-27T09:00:00.000Z',
        endAt: '2026-08-27T10:00:00.000Z',
        totalCents: 50_000,
        depositRequiredCents: 10_000,
      },
    );
    const [first, second] = await Promise.all([
      bookingFor(firstJourney.json(), 'booking-race-a-001'),
      bookingFor(secondJourney.json(), 'booking-race-b-001'),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
  });

  it('rejects over-refunds and duplicate collected ledger events with different operation keys', async () => {
    const { app } = harness();
    const context = await createPaidJourney(app, 'financial-adversarial');
    const duplicateRevenue = await post(app, '/api/v1/tenants/tenant-a/revenue-events', 'admin-a', {
      idempotencyKey: 'second-revenue-operation-001',
      customerId: context.customerId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      paymentId: context.paymentId,
      stage: 'collected',
      amountCents: 80_000,
      causationKey: 'different-causation-for-same-payment',
    });
    expect(duplicateRevenue.statusCode).toBe(409);
    expect(duplicateRevenue.json().error.code).toBe('DUPLICATE_FINANCIAL_EVENT');

    const overRefund = await post(app, '/api/v1/tenants/tenant-a/payments', 'admin-a', {
      idempotencyKey: 'over-refund-payment-001',
      customerId: context.customerId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      referenceType: 'APPOINTMENT',
      referenceId: context.bookingId,
      kind: 'REFUND',
      amountCents: 80_001,
      originalPaymentId: context.paymentId,
    });
    expect(overRefund.statusCode).toBe(422);
    expect(overRefund.json().error.code).toBe('REFUND_EXCEEDS_PAYMENT');
  });
});

describe('Copilot, webhook, and durable follow-up safety', () => {
  it('requires explicit owner approval for high-impact Copilot execution and replays audit safely', async () => {
    const { app } = harness();
    const deniedMember = await post(app, '/api/v1/tenants/tenant-a/copilot/execute', 'admin-a', {
      tool: 'PREPARE_REACTIVATION',
      arguments: { leadId: 'lead-a' },
      approved: true,
      idempotencyKey: 'copilot-role-check-001',
    });
    const deniedApproval = await post(app, '/api/v1/tenants/tenant-a/copilot/execute', 'owner-a', {
      tool: 'PREPARE_REACTIVATION',
      arguments: { leadId: 'lead-a' },
      approved: false,
      idempotencyKey: 'copilot-approval-check-001',
    });
    const approvedPayload = {
      tool: 'PREPARE_REACTIVATION',
      arguments: { leadId: 'lead-a' },
      approved: true,
      idempotencyKey: 'copilot-approved-001',
    };
    const approved = await post(app, '/api/v1/tenants/tenant-a/copilot/execute', 'owner-a', approvedPayload);
    const replay = await post(app, '/api/v1/tenants/tenant-a/copilot/execute', 'owner-a', approvedPayload);
    expect(deniedMember.statusCode).toBe(403);
    expect(deniedApproval.statusCode).toBe(409);
    expect(approved.json().status).toBe('executed');
    expect(approved.json().result).toMatchObject({ leadId: 'lead-a' });
    expect(approved.json().result.followUpId).toEqual(expect.any(String));
    expect(replay.json()).toMatchObject({ auditId: approved.json().auditId, status: 'replayed' });
  });

  it('does not allow Tenant A to run a Copilot tool against Tenant B', async () => {
    const { app } = harness();
    const response = await post(app, '/api/v1/tenants/tenant-b/copilot/execute', 'owner-a', {
      tool: 'GET_REVENUE_OVERVIEW',
      arguments: {},
      approved: false,
      idempotencyKey: 'copilot-cross-tenant-001',
    });
    expect(response.statusCode).toBe(404);
  });

  it('requires adapter-owned webhook signature verification and deduplicates provider events', async () => {
    const { app } = harness();
    const body = JSON.stringify({ eventId: 'provider-event-001', type: 'lead.created', customer: 'redacted' });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mock/endpoint-a',
      headers: { 'content-type': 'application/json', 'x-closer-signature': '0'.repeat(64) },
      payload: body,
    });
    const signature = createHmac('sha256', 'webhook-secret-a').update(body).digest('hex');
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mock/endpoint-a',
      headers: { 'content-type': 'application/json', 'x-closer-signature': signature },
      payload: body,
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mock/endpoint-a',
      headers: { 'content-type': 'application/json', 'x-closer-signature': signature },
      payload: body,
    });
    expect(invalid.statusCode).toBe(401);
    expect(first.json()).toMatchObject({ replayed: false, processingState: 'processed' });
    expect(duplicate.json()).toMatchObject({ eventId: first.json().eventId, replayed: true });
  });

  it('rejects replay of a provider event ID with a changed payload', async () => {
    const { app } = harness();
    const firstBody = JSON.stringify({ eventId: 'provider-event-conflict', type: 'lead.created' });
    const secondBody = JSON.stringify({ eventId: 'provider-event-conflict', type: 'payment.created' });
    for (const body of [firstBody, secondBody]) {
      const signature = createHmac('sha256', 'webhook-secret-a').update(body).digest('hex');
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mock/endpoint-a',
        headers: { 'content-type': 'application/json', 'x-closer-signature': signature },
        payload: body,
      });
      if (body === secondBody) {
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe('WEBHOOK_REPLAY_CONFLICT');
      }
    }
  });

  it('allows only one of two concurrent workers to execute a due follow-up', async () => {
    const due = followUp({ id: 'concurrent-follow-up', dueAt: '2026-08-25T08:00:00.000Z' });
    const { store } = harness({ followUps: [due] });
    const dispatcher = new DeterministicMockFollowUpDispatcher();
    const clock = () => new Date(NOW);
    const workerOne = new FollowUpWorker(store, dispatcher, { workerId: 'worker-one', now: clock });
    const workerTwo = new FollowUpWorker(store, dispatcher, { workerId: 'worker-two', now: clock });
    const results = await Promise.all([workerOne.runOnce(), workerTwo.runOnce()]);
    expect(results.sort()).toEqual(['completed', 'idle']);
    expect(dispatcher.sent).toHaveLength(1);
  });

  it('does not execute an already-due follow-up after Human Takeover cancels automation', async () => {
    const due = followUp({ id: 'handoff-due-follow-up', dueAt: '2026-08-25T08:00:00.000Z' });
    const { app, store } = harness({ followUps: [due] });
    await post(
      app,
      '/api/v1/tenants/tenant-a/conversations/conversation-a/handoff',
      'admin-a',
      { idempotencyKey: 'handoff-before-worker-001', reason: 'Owner took control' },
    );
    const dispatcher = new DeterministicMockFollowUpDispatcher();
    const worker = new FollowUpWorker(store, dispatcher, {
      workerId: 'handoff-test-worker',
      now: () => new Date(NOW),
    });
    await expect(worker.runOnce()).resolves.toBe('idle');
    expect(dispatcher.sent).toHaveLength(0);
  });

  it('keeps migration definitions source-controlled for every durable trust-boundary record', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'server/migrations/0001_production_foundation.sql'),
      'utf8',
    );
    for (const table of [
      'tenants',
      'app_users',
      'organization_memberships',
      'organization_provisioning_requests',
      'tenant_settings',
      'business_knowledge',
      'customers',
      'leads',
      'conversations',
      'messages',
      'consent_records',
      'next_actions',
      'activities',
      'assistant_decision_records',
      'follow_up_jobs',
      'follow_up_attempts',
      'human_handoffs',
      'bookings',
      'quotes',
      'jobs',
      'payments',
      'revenue_ledger_events',
      'reactivation_campaigns',
      'connector_configurations',
      'webhook_events',
      'idempotency_records',
      'copilot_action_audits',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).not.toMatch(/access[_-]?token\s*=|private[_-]?key\s*=/i);
  });
});

function harness(overrides: { followUps?: FollowUpJobRecord[] } = {}) {
  const store = new InMemoryProductionStore({
    memberships: [
      membership(OWNER_A.userId, 'tenant-a', 'Alpha Clinic', 'owner'),
      membership(ADMIN_A.userId, 'tenant-a', 'Alpha Clinic', 'admin'),
      membership(MEMBER_A.userId, 'tenant-a', 'Alpha Clinic', 'member'),
      membership(OWNER_B.userId, 'tenant-b', 'Beta Detailing', 'owner'),
    ],
    customers: [
      { id: 'customer-a', tenantId: 'tenant-a', displayName: 'Dana A', phone: '+972500000001', email: null, createdAt: NOW },
      { id: 'customer-b', tenantId: 'tenant-b', displayName: 'Dana B', phone: '+972500000002', email: null, createdAt: NOW },
    ],
    conversations: [
      { id: 'conversation-a', tenantId: 'tenant-a', customerId: 'customer-a', leadId: 'lead-a', channel: 'WHATSAPP', mode: 'AI_ACTIVE', createdAt: NOW },
      { id: 'conversation-b', tenantId: 'tenant-b', customerId: 'customer-b', leadId: 'lead-b', channel: 'WHATSAPP', mode: 'AI_ACTIVE', createdAt: NOW },
    ],
    leads: [
      { id: 'lead-a', tenantId: 'tenant-a', customerId: 'customer-a', conversationId: 'conversation-a', source: 'WHATSAPP', workflowType: 'APPOINTMENT_SERVICE', serviceId: null, status: 'LOST', marketingAllowed: true },
      { id: 'lead-b', tenantId: 'tenant-b', customerId: 'customer-b', conversationId: 'conversation-b', source: 'WHATSAPP', workflowType: 'QUOTE_JOB', serviceId: null, status: 'LOST', marketingAllowed: true },
    ],
    revenueEntries: [
      { id: 'revenue-a', tenantId: 'tenant-a', customerId: 'customer-a', leadId: 'lead-a', conversationId: 'conversation-a', paymentId: null, stage: 'pipeline', amountCents: 50_000, causationKey: 'seed-a', occurredAt: NOW },
      { id: 'revenue-b', tenantId: 'tenant-b', customerId: 'customer-b', leadId: 'lead-b', conversationId: 'conversation-b', paymentId: null, stage: 'pipeline', amountCents: 90_000, causationKey: 'seed-b', occurredAt: NOW },
    ],
    followUps: overrides.followUps ?? [
      followUp({ id: 'follow-up-a', tenantId: 'tenant-a', conversationId: 'conversation-a', customerId: 'customer-a' }),
      followUp({ id: 'follow-up-b', tenantId: 'tenant-b', conversationId: 'conversation-b', customerId: 'customer-b' }),
    ],
    connectors: [
      { id: 'connector-a', tenantId: 'tenant-a', provider: 'mock', enabled: true, mode: 'mock', secretConfigured: true, webhookEndpointId: 'endpoint-a' },
      { id: 'connector-b', tenantId: 'tenant-b', provider: 'mock', enabled: true, mode: 'mock', secretConfigured: true, webhookEndpointId: 'endpoint-b' },
    ],
    webhookEndpoints: [
      { tenantId: 'tenant-a', provider: 'mock', endpointId: 'endpoint-a', signingSecretReference: 'CLOSER_SECRET_WEBHOOK_A', enabled: true },
      { tenantId: 'tenant-b', provider: 'mock', endpointId: 'endpoint-b', signingSecretReference: 'CLOSER_SECRET_WEBHOOK_B', enabled: true },
    ],
  });
  const authenticator = new StaticTokenAuthenticator(new Map([
    ['owner-a', OWNER_A],
    ['admin-a', ADMIN_A],
    ['member-a', MEMBER_A],
    ['owner-b', OWNER_B],
  ]));
  const webhookService = new WebhookService(
    store,
    new MapSecretProvider(new Map([
      ['CLOSER_SECRET_WEBHOOK_A', 'webhook-secret-a'],
      ['CLOSER_SECRET_WEBHOOK_B', 'webhook-secret-b'],
    ])),
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
  });
  runningApps.push(app);
  return { app, store };
}

function membership(
  userId: string,
  tenantId: string,
  tenantName: string,
  role: 'owner' | 'admin' | 'member',
) {
  return { userId, membership: { tenantId, tenantName, role, active: true } };
}

function followUp(overrides: Partial<FollowUpJobRecord>): FollowUpJobRecord {
  return {
    id: 'follow-up-a',
    tenantId: 'tenant-a',
    conversationId: 'conversation-a',
    customerId: 'customer-a',
    channel: 'WHATSAPP',
    reason: 'Waiting for customer',
    status: 'scheduled',
    dueAt: '2026-08-25T10:00:00.000Z',
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
    idempotencyKey: `seed-${overrides.id ?? 'follow-up-a'}`,
    draftMessage: 'Can we help with the next step?',
    createdAt: NOW,
    ...overrides,
  };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function post(
  app: FastifyInstance,
  url: string,
  token: string,
  payload: Record<string, unknown>,
) {
  return app.inject({ method: 'POST', url, headers: authorization(token), payload });
}

function journeyPayload(idempotencyKey: string) {
  return {
    idempotencyKey,
    customer: { displayName: 'New Customer', phone: '+972501234567', email: null },
    lead: { source: 'WHATSAPP', workflowType: 'APPOINTMENT_SERVICE', serviceId: null },
    conversation: { channel: 'WHATSAPP' },
  };
}

async function createPaidJourney(app: FastifyInstance, suffix: string) {
  const journey = await post(
    app,
    '/api/v1/tenants/tenant-a/journeys',
    'member-a',
    journeyPayload(`journey-${suffix}-001`),
  );
  const ids = journey.json();
  const booking = await post(app, '/api/v1/tenants/tenant-a/bookings', 'admin-a', {
    idempotencyKey: `booking-${suffix}-001`,
    customerId: ids.customerId,
    leadId: ids.leadId,
    serviceId: 'service-clinic',
    staffId: 'staff-clinic',
    startAt: '2026-08-26T09:00:00.000Z',
    endAt: '2026-08-26T10:00:00.000Z',
    totalCents: 80_000,
    depositRequiredCents: 20_000,
  });
  const payment = await post(app, '/api/v1/tenants/tenant-a/payments', 'admin-a', {
    idempotencyKey: `payment-${suffix}-001`,
    customerId: ids.customerId,
    leadId: ids.leadId,
    conversationId: ids.conversationId,
    referenceType: 'APPOINTMENT',
    referenceId: booking.json().bookingId,
    kind: 'BALANCE',
    amountCents: 80_000,
    originalPaymentId: null,
  });
  await post(app, '/api/v1/tenants/tenant-a/revenue-events', 'admin-a', {
    idempotencyKey: `revenue-${suffix}-001`,
    customerId: ids.customerId,
    leadId: ids.leadId,
    conversationId: ids.conversationId,
    paymentId: payment.json().paymentId,
    stage: 'collected',
    amountCents: 80_000,
    causationKey: `payment-${suffix}-001`,
  });
  return {
    customerId: ids.customerId as string,
    leadId: ids.leadId as string,
    conversationId: ids.conversationId as string,
    bookingId: booking.json().bookingId as string,
    paymentId: payment.json().paymentId as string,
  };
}
