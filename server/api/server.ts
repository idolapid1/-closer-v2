import Fastify, { type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { Authenticator } from '../auth/authenticator.js';
import { ApiError, assertFound } from '../application/errors.js';
import { AuthorizationService } from '../application/authorization.js';
import { IdempotencyService } from '../application/idempotency.js';
import type { ProductionStore } from '../application/store.js';
import type { AuthenticatedIdentity, OrganizationRole } from '../domain/model.js';
import { FixedWindowRateLimiter } from '../security/rateLimiter.js';
import type { WebhookService } from '../webhooks/webhookService.js';
import {
  bookingCreationSchema,
  cancellationSchema,
  copilotExecutionSchema,
  followUpCreationSchema,
  handoffSchema,
  journeyCreationSchema,
  paymentCreationSchema,
  resourceIdSchema,
  revenueEntrySchema,
  resumeSchema,
  tenantProvisionSchema,
} from './schemas.js';

export interface ProductionServerDependencies {
  store: ProductionStore;
  authenticator: Authenticator;
  webhookService: WebhookService;
  now?: () => Date;
  requestRateLimit?: number;
  webhookRateLimit?: number;
}

const tenantParamsSchema = z.object({ tenantId: resourceIdSchema });
const followUpParamsSchema = z.object({ tenantId: resourceIdSchema, followUpId: resourceIdSchema });
const conversationParamsSchema = z.object({ tenantId: resourceIdSchema, conversationId: resourceIdSchema });
const webhookParamsSchema = z.object({ provider: resourceIdSchema, endpointId: resourceIdSchema });

export function buildProductionServer(dependencies: ProductionServerDependencies) {
  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024,
  });
  const authorization = new AuthorizationService(dependencies.store);
  const now = dependencies.now ?? (() => new Date());
  const idempotency = new IdempotencyService(dependencies.store, now);
  const apiLimiter = new FixedWindowRateLimiter(dependencies.requestRateLimit ?? 240);
  const webhookLimiter = new FixedWindowRateLimiter(dependencies.webhookRateLimit ?? 600);

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ZodError) {
      void reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: 'Request validation failed' } });
      return;
    }
    void reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' } });
  });

  app.get('/health', async () => ({ status: 'ok', mode: 'production-boundary' }));

  app.get('/api/v1/tenants', async (request) => {
    const identity = await authenticate(request, dependencies.authenticator, apiLimiter);
    return { tenants: await dependencies.store.listMemberships(identity.userId) };
  });

  app.post('/api/v1/organizations', async (request) => {
    const identity = await authenticate(request, dependencies.authenticator, apiLimiter);
    const input = tenantProvisionSchema.parse(parseJsonBody(request.body));
    return dependencies.store.provisionTenant(identity, input, now().toISOString());
  });

  app.get('/api/v1/tenants/:tenantId/customers', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'member');
    void identity;
    return { customers: await dependencies.store.listCustomers(tenantId) };
  });

  app.get('/api/v1/tenants/:tenantId/conversations', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    await authorize(request, tenantId, 'member');
    return { conversations: await dependencies.store.listConversations(tenantId) };
  });

  app.get('/api/v1/tenants/:tenantId/revenue', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    await authorize(request, tenantId, 'member');
    return { revenue: await dependencies.store.getRevenueSummary(tenantId) };
  });

  app.get('/api/v1/tenants/:tenantId/connectors', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    await authorize(request, tenantId, 'admin');
    return { connectors: await dependencies.store.listConnectorConfigurations(tenantId) };
  });

  app.post('/api/v1/tenants/:tenantId/conversations/:conversationId/handoff', async (request) => {
    const { tenantId, conversationId } = conversationParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'admin');
    const input = handoffSchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'conversation:handoff',
      key: input.idempotencyKey,
      request: { conversationId, reason: input.reason },
      operation: () => dependencies.store.startHumanTakeover(
        tenantId,
        conversationId,
        identity,
        input.reason,
        now().toISOString(),
      ),
    });
    return { ...execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/conversations/:conversationId/resume', async (request) => {
    const { tenantId, conversationId } = conversationParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'admin');
    const input = resumeSchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'conversation:resume',
      key: input.idempotencyKey,
      request: { conversationId },
      operation: () => dependencies.store.resumeAssistant(
        tenantId,
        conversationId,
        identity,
        now().toISOString(),
      ),
    });
    return { ...execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/journeys', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'member');
    const input = journeyCreationSchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'journey:create',
      key: input.idempotencyKey,
      request: input,
      operation: () => dependencies.store.createJourney(tenantId, identity, input, now().toISOString()),
    });
    return { ...execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/follow-ups', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'admin');
    const input = followUpCreationSchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'follow-up:create',
      key: input.idempotencyKey,
      request: input,
      operation: () => dependencies.store.createFollowUp(tenantId, identity, input, now().toISOString()),
    });
    return { followUp: execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/follow-ups/:followUpId/cancel', async (request) => {
    const { tenantId, followUpId } = followUpParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'admin');
    const input = cancellationSchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'follow-up:cancel',
      key: input.idempotencyKey,
      request: { followUpId },
      operation: async () => assertFound(
        await dependencies.store.cancelFollowUp(tenantId, followUpId, identity, now().toISOString()),
      ),
    });
    return { followUp: execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/bookings', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'admin');
    const input = bookingCreationSchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'booking:create',
      key: input.idempotencyKey,
      request: input,
      operation: () => dependencies.store.createBooking(tenantId, identity, input, now().toISOString()),
    });
    return { ...execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/payments', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'admin');
    const input = paymentCreationSchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'payment:create',
      key: input.idempotencyKey,
      request: input,
      operation: () => dependencies.store.createPayment(tenantId, identity, input, now().toISOString()),
    });
    return { ...execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/revenue-events', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    const identity = await authorize(request, tenantId, 'admin');
    const input = revenueEntrySchema.parse(parseJsonBody(request.body));
    const execution = await idempotency.execute({
      tenantId,
      scope: 'revenue:append',
      key: input.idempotencyKey,
      request: input,
      operation: () => dependencies.store.appendRevenueEntry(
        tenantId,
        identity,
        {
          customerId: input.customerId,
          leadId: input.leadId,
          conversationId: input.conversationId,
          paymentId: input.paymentId,
          stage: input.stage,
          amountCents: input.amountCents,
          causationKey: input.causationKey,
        },
        now().toISOString(),
      ),
    });
    return { revenueEvent: execution.value, replayed: execution.replayed };
  });

  app.post('/api/v1/tenants/:tenantId/copilot/execute', async (request) => {
    const { tenantId } = tenantParamsSchema.parse(request.params);
    const input = copilotExecutionSchema.parse(parseJsonBody(request.body));
    const minimumRole: OrganizationRole = input.tool === 'PREPARE_REACTIVATION' ? 'owner' : 'member';
    const identity = await authorize(request, tenantId, minimumRole);
    if (input.tool === 'PREPARE_REACTIVATION' && !input.approved) {
      throw new ApiError(409, 'OWNER_APPROVAL_REQUIRED', 'This action requires explicit owner approval');
    }
    const execution = await idempotency.execute({
      tenantId,
      scope: `copilot:${input.tool}`,
      key: input.idempotencyKey,
      request: input,
      operation: () => dependencies.store.executeCopilot(tenantId, identity, input, now().toISOString()),
    });
    return { ...execution.value, status: execution.replayed ? 'replayed' : execution.value.status };
  });

  app.post('/api/v1/webhooks/:provider/:endpointId', async (request) => {
    const { provider, endpointId } = webhookParamsSchema.parse(request.params);
    if (!webhookLimiter.allow(`${provider}:${request.ip}`)) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many webhook requests');
    }
    const rawBody = asRawBody(request.body);
    return dependencies.webhookService.ingest({
      provider,
      endpointId,
      headers: request.headers,
      rawBody,
    });
  });

  async function authorize(
    request: FastifyRequest,
    tenantId: string,
    minimumRole: OrganizationRole,
  ): Promise<AuthenticatedIdentity> {
    const identity = await authenticate(request, dependencies.authenticator, apiLimiter);
    await authorization.requireMembership(identity, tenantId, minimumRole);
    return identity;
  }

  return app;
}

async function authenticate(
  request: FastifyRequest,
  authenticator: Authenticator,
  limiter: FixedWindowRateLimiter,
): Promise<AuthenticatedIdentity> {
  const identity = await authenticator.authenticate(request.headers.authorization);
  if (!identity) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required');
  if (!limiter.allow(`${identity.userId}:${request.ip}`)) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
  }
  return identity;
}

function parseJsonBody(body: unknown): unknown {
  const rawBody = asRawBody(body);
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

function asRawBody(body: unknown): Buffer {
  if (!Buffer.isBuffer(body)) throw new ApiError(400, 'INVALID_BODY', 'A JSON request body is required');
  return body;
}
