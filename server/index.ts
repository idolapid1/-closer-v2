import { JwksAuthenticator } from './auth/authenticator.js';
import { buildProductionServer } from './api/server.js';
import { loadServerConfig } from './config.js';
import { createPostgresPool } from './infrastructure/postgres.js';
import { PostgresProductionStore } from './infrastructure/postgresProductionStore.js';
import { DatabaseReadinessProbe } from './readiness.js';
import { EnvironmentSecretProvider } from './security/secrets.js';
import { HmacWebhookAdapter } from './webhooks/webhookAdapter.js';
import { WebhookService } from './webhooks/webhookService.js';

const config = loadServerConfig();
const pool = createPostgresPool(config.DATABASE_URL);
const store = new PostgresProductionStore(pool);
const readiness = new DatabaseReadinessProbe(pool);
const authenticator = new JwksAuthenticator({
  jwksUrl: config.AUTH_JWKS_URL,
  issuer: config.AUTH_ISSUER,
  ...(config.AUTH_AUDIENCE ? { audience: config.AUTH_AUDIENCE } : {}),
});
const webhookService = new WebhookService(
  store,
  new EnvironmentSecretProvider(),
  [new HmacWebhookAdapter('mock')],
);
const app = buildProductionServer({
  store,
  authenticator,
  webhookService,
  requestRateLimit: config.REQUEST_RATE_LIMIT,
  webhookRateLimit: config.WEBHOOK_RATE_LIMIT,
  frontendOrigin: config.FRONTEND_ORIGIN,
  readiness: () => readiness.check(),
  exposeDevelopmentInviteLinks: config.ALLOW_DEVELOPMENT_INVITE_LINKS,
  ...(config.DEVELOPMENT_INVITE_BASE_URL
    ? { developmentInviteBaseUrl: config.DEVELOPMENT_INVITE_BASE_URL }
    : {}),
  logger: true,
});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  await pool.end();
};

process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

await app.listen({ host: config.HOST, port: config.PORT });
