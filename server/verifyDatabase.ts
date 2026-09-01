import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  'opportunities',
  'opportunity_score_snapshots',
  'recovery_play_definitions',
  'recovery_decisions',
  'recovery_actions',
] as const;

const REQUIRED_INDEXES = [
  'one_pending_next_action_per_lead',
  'follow_up_jobs_due_idx',
  'one_active_handoff_per_conversation',
  'one_financial_stage_per_payment',
  'organization_invitations_tenant_status_idx',
  'opportunities_tenant_status_idx',
  'opportunities_tenant_recovery_idx',
  'opportunities_tenant_next_action_idx',
  'opportunities_tenant_customer_idx',
  'opportunities_tenant_activity_idx',
  'recovery_decisions_opportunity_idx',
  'revenue_ledger_opportunity_idx',
  'recovery_actions_opportunity_idx',
  'recovery_actions_ready_idx',
  'opportunities_tenant_type_idx',
] as const;

export interface DatabaseVerificationReport {
  migrations: string[];
  tables: number;
  indexes: number;
  rlsTables: number;
  claimFunction: boolean;
  forcedRls: boolean;
  runtimeRoles: boolean;
  postgrestProtected: boolean;
  functionPrivileges: boolean;
  authenticatedInboundMessages: boolean;
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

  const forcedRls = await pool.query<{ relname: string }>(
    `SELECT relname FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relforcerowsecurity
       AND relation.relname = ANY($1::text[])`,
    [expectedRls],
  );
  requireAll('forced RLS table', expectedRls, forcedRls.rows.map((row) => row.relname));

  const policies = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_policies
     WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [expectedRls],
  );
  requireAll('RLS policy', expectedRls, policies.rows.map((row) => row.tablename));

  const claimFunction = await pool.query<{ exists: boolean; search_path_fixed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public' AND procedure.proname = 'claim_follow_up_job'
     ) AS exists,
     EXISTS (
       SELECT 1 FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public' AND procedure.proname = 'claim_follow_up_job'
         AND EXISTS (
           SELECT 1 FROM unnest(COALESCE(procedure.proconfig, ARRAY[]::text[])) setting
           WHERE setting LIKE 'search_path=%' AND setting NOT LIKE '%public%'
         )
     ) AS search_path_fixed`,
  );
  if (!claimFunction.rows[0]?.exists) throw new Error('Missing claim_follow_up_job function');
  if (!claimFunction.rows[0]?.search_path_fixed) throw new Error('claim_follow_up_job search_path is not fixed');

  const roles = await pool.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
    `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
     WHERE rolname IN ('closer_api', 'closer_system')`,
  );
  requireAll('runtime role', ['closer_api', 'closer_system'], roles.rows.map((row) => row.rolname));
  if (roles.rows.some((row) => row.rolbypassrls || row.rolsuper)) {
    throw new Error('CLOSER runtime roles must not bypass RLS or hold superuser privileges');
  }

  const postgrestProtection = await pool.query<{ exposed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_roles role_record
       WHERE role_record.rolname IN ('anon', 'authenticated')
         AND (
           has_table_privilege(role_record.rolname, 'public.app_users', 'SELECT,INSERT,UPDATE,DELETE')
           OR has_table_privilege(role_record.rolname, 'public.closer_schema_migrations', 'SELECT,INSERT,UPDATE,DELETE')
           OR has_table_privilege(role_record.rolname, 'public.opportunities', 'SELECT,INSERT,UPDATE,DELETE')
           OR has_table_privilege(role_record.rolname, 'public.recovery_decisions', 'SELECT,INSERT,UPDATE,DELETE')
           OR has_table_privilege(role_record.rolname, 'public.recovery_actions', 'SELECT,INSERT,UPDATE,DELETE')
           OR has_table_privilege(role_record.rolname, 'public.messages', 'INSERT,UPDATE,DELETE')
         )
     ) AS exposed`,
  );
  if (postgrestProtection.rows[0]?.exposed) {
    throw new Error('PostgREST roles can access protected server tables');
  }

  const functionPrivileges = await pool.query<{
    public_claim: boolean;
    api_claim: boolean;
    system_claim: boolean;
    public_access_helper: boolean;
    api_access_helper: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1
         FROM pg_proc procedure
         JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) privilege
         WHERE namespace.nspname = 'public' AND procedure.proname = 'claim_follow_up_job'
           AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
       ) AS public_claim,
       has_function_privilege('closer_api', 'public.claim_follow_up_job(text,timestamptz,timestamptz)', 'EXECUTE') AS api_claim,
       has_function_privilege('closer_system', 'public.claim_follow_up_job(text,timestamptz,timestamptz)', 'EXECUTE') AS system_claim,
       EXISTS (
         SELECT 1
         FROM pg_proc procedure
         JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) privilege
         WHERE namespace.nspname = 'public' AND procedure.proname = 'app_has_tenant_access'
           AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
       ) AS public_access_helper,
       has_function_privilege('closer_api', 'public.app_has_tenant_access(uuid)', 'EXECUTE') AS api_access_helper`,
  );
  const privilegeRow = functionPrivileges.rows[0];
  if (!privilegeRow
    || privilegeRow.public_claim
    || privilegeRow.api_claim
    || !privilegeRow.system_claim
    || privilegeRow.public_access_helper
    || !privilegeRow.api_access_helper) {
    throw new Error('Server-only function privileges are not hardened');
  }

  const inboundMessagePrivilege = await pool.query<{ allowed: boolean }>(
    `SELECT has_table_privilege('closer_api', 'public.messages', 'INSERT') AS allowed`,
  );
  if (!inboundMessagePrivilege.rows[0]?.allowed) {
    throw new Error('Authenticated API cannot persist validated inbound messages');
  }

  return {
    migrations: migrationNames,
    tables: objects.rowCount ?? 0,
    indexes: indexes.rowCount ?? 0,
    rlsTables: rls.rowCount ?? 0,
    claimFunction: true,
    forcedRls: true,
    runtimeRoles: true,
    postgrestProtected: true,
    functionPrivileges: true,
    authenticatedInboundMessages: true,
  };
}

function requireAll(label: string, required: readonly string[], actual: string[]): void {
  const found = new Set(actual);
  const missing = required.filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`Missing ${label}: ${missing.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = loadDatabaseConfig();
  const pool = createPostgresPool(config.DATABASE_URL);
  try {
    const report = await verifyDatabaseSchema(pool);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await pool.end();
  }
}
