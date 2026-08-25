import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_URL: z.string().min(1),
  AUTH_JWKS_URL: z.url(),
  AUTH_ISSUER: z.string().min(1),
  AUTH_AUDIENCE: z.string().min(1).optional(),
  CONNECTOR_EXECUTION_MODE: z.literal('mock').default('mock'),
  REQUEST_RATE_LIMIT: z.coerce.number().int().min(10).max(10_000).default(240),
  WEBHOOK_RATE_LIMIT: z.coerce.number().int().min(10).max(10_000).default(600),
});

export type ServerConfig = z.infer<typeof environmentSchema>;

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  return parsed.data;
}

