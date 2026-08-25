import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { loadDatabaseConfig } from './config.js';
import { createPostgresPool } from './infrastructure/postgres.js';

const REQUIRED_TABLES = [
  'app_users',
  'tenants',
  'organization_memberships',
  'organization_invitations',
  'customers',
  'leads',
  'conversations',
  'messages',
  'follow_up_jobs',
  'follow_up_attempts',
  'human_handoffs',
  'bookings',
  'quotes',
  'jobs',
  'payments',
  'revenue_ledger_events',
  'connector_configurations',
  'webhook_events',
  'copilot_action_audits',
  'audit_logs',
] as const;

const REQUIRED_INDEXES = [
  'one_pending_next_action_per_lead',
  'follow_up_jobs_due_idx',
  'one_active_handoff_per_conversation',
  'one_financial_stage_per_payment',
  'organization_invitations_tenant_status_idx',
] as const;

export interface DatabaseVerificationReport {
  migrations: string[];
  tables: number;
  indexes: number;
  rlsTables: number;
  claimFunction: boolean;
}

export async function verifyDatabaseSchema(pool: Pool): Promise<DatabaseVerificationReport> {
  await pool.query('SELECT 1');
  const migrationDirectory = resolve(process.cwd(), 'server/migrations');
  const migrationNames = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  const applied = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM closer_schema_migrations ORDER BY name',
  );
  const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum]));
  for (const name of migrationNames) {
    const sql = await readFile(resolve(migrationDirectory, name), 'utf8');
    const expected = createHash('sha256').update(sql).digest('hex');
    if (appliedByName.get(name) !== expected) throw new Error(`Migration is missing or changed: ${name}`);
  }

  const objects = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES],
  );
  requireAll('table', REQUIRED_TABLES, objects.rows.map((row) => row.table_name));

  const indexes = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
    [REQUIRED_INDEXES],
  );
  requireAll('index', REQUIRED_INDEXES, indexes.rows.map((row) => row.indexname));

  const rls = await pool.query<{ relname: string }>(
    `SELECT relname FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relrowsecurity
       AND relation.relname = ANY($1::text[])`,
    [REQUIRED_TABLES.filter((table) => !['app_users'].includes(table))],
  );
  const expectedRls = REQUIRED_TABLES.filter((table) => table !== 'app_users');
  requireAll('RLS table', expectedRls, rls.rows.map((row) => row.relname));

  const policies = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_policies
     WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [expectedRls],
  );
  requireAll('RLS policy', expectedRls, policies.rows.map((row) => row.tablename));

  const claimFunction = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public' AND procedure.proname = 'claim_follow_up_job'
     ) AS exists`,
  );
  if (!claimFunction.rows[0]?.exists) throw new Error('Missing claim_follow_up_job function');

  return {
    migrations: migrationNames,
    tables: objects.rowCount ?? 0,
    indexes: indexes.rowCount ?? 0,
    rlsTables: rls.rowCount ?? 0,
    claimFunction: true,
  };
}

function requireAll(label: string, required: readonly string[], actual: string[]): void {
  const found = new Set(actual);
  const missing = required.filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`Missing ${label}: ${missing.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadDatabaseConfig();
  const pool = createPostgresPool(config.DATABASE_URL);
  try {
    const report = await verifyDatabaseSchema(pool);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await pool.end();
  }
}
