import { z } from 'zod';

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1).refine((value) => /^postgres(?:ql)?:\/\//.test(value), 'PostgreSQL URL required'),
});

const workerEnvironmentSchema = databaseEnvironmentSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CONNECTOR_EXECUTION_MODE: z.literal('mock').default('mock'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(25).max(60_000).default(2_000),
  WORKER_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
});

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_URL: databaseEnvironmentSchema.shape.DATABASE_URL,
  AUTH_JWKS_URL: z.url(),
  AUTH_ISSUER: z.url(),
  AUTH_AUDIENCE: z.string().min(1).optional(),
  FRONTEND_ORIGIN: z.url(),
  CONNECTOR_EXECUTION_MODE: z.literal('mock').default('mock'),
  REQUEST_RATE_LIMIT: z.coerce.number().int().min(10).max(10_000).default(240),
  WEBHOOK_RATE_LIMIT: z.coerce.number().int().min(10).max(10_000).default(600),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(25).max(60_000).default(2_000),
  WORKER_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  ALLOW_DEVELOPMENT_INVITE_LINKS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DEVELOPMENT_INVITE_BASE_URL: z.url().optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production') {
    for (const [field, candidate] of [
      ['AUTH_JWKS_URL', value.AUTH_JWKS_URL],
      ['AUTH_ISSUER', value.AUTH_ISSUER],
      ['FRONTEND_ORIGIN', value.FRONTEND_ORIGIN],
    ] as const) {
      if (!candidate.startsWith('https://')) {
        context.addIssue({ code: 'custom', path: [field], message: 'HTTPS is required in production' });
      }
    }
    if (value.ALLOW_DEVELOPMENT_INVITE_LINKS) {
      context.addIssue({ code: 'custom', path: ['ALLOW_DEVELOPMENT_INVITE_LINKS'], message: 'Development invitation links are forbidden in production' });
    }
  }
  if (value.ALLOW_DEVELOPMENT_INVITE_LINKS && !value.DEVELOPMENT_INVITE_BASE_URL) {
    context.addIssue({ code: 'custom', path: ['DEVELOPMENT_INVITE_BASE_URL'], message: 'Invite base URL is required when development links are enabled' });
  }
});

export type ServerConfig = z.infer<typeof environmentSchema>;
export type DatabaseConfig = z.infer<typeof databaseEnvironmentSchema>;
export type WorkerConfig = z.infer<typeof workerEnvironmentSchema>;

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  return parsed.data;
}

export function loadDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return parseEnvironment(databaseEnvironmentSchema, environment, 'database');
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return parseEnvironment(workerEnvironmentSchema, environment, 'worker');
}

function parseEnvironment<T>(
  schema: z.ZodType<T>,
  environment: NodeJS.ProcessEnv,
  label: string,
): T {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid ${label} configuration: ${fields}`);
  }
  return parsed.data;
}
