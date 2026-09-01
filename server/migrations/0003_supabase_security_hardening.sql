-- CLOSER's HTTP API and background workers use distinct NOLOGIN roles.
-- The connection login may be privileged enough to migrate, but every runtime transaction
-- immediately SET LOCAL ROLEs into one of these constrained execution roles.
DO $$
DECLARE
  runtime_role_name text;
  runtime_role record;
BEGIN
  FOREACH runtime_role_name IN ARRAY ARRAY['closer_api', 'closer_system'] LOOP
    SELECT
      role_record.rolname,
      role_record.rolcanlogin,
      role_record.rolsuper,
      role_record.rolcreatedb,
      role_record.rolcreaterole,
      role_record.rolinherit,
      role_record.rolreplication,
      role_record.rolbypassrls
    INTO runtime_role
    FROM pg_roles role_record
    WHERE role_record.rolname = runtime_role_name;

    IF NOT FOUND THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        runtime_role_name
      );
      SELECT
        role_record.rolname,
        role_record.rolcanlogin,
        role_record.rolsuper,
        role_record.rolcreatedb,
        role_record.rolcreaterole,
        role_record.rolinherit,
        role_record.rolreplication,
        role_record.rolbypassrls
      INTO STRICT runtime_role
      FROM pg_roles role_record
      WHERE role_record.rolname = runtime_role_name;
    END IF;

    -- Supabase's managed postgres role cannot restate protected role attributes with
    -- ALTER ROLE. Existing roles are accepted only when the catalog proves that every
    -- required least-privilege attribute is already safe; otherwise migration fails closed.
    IF runtime_role.rolcanlogin
      OR runtime_role.rolsuper
      OR runtime_role.rolcreatedb
      OR runtime_role.rolcreaterole
      OR runtime_role.rolinherit
      OR runtime_role.rolreplication
      OR runtime_role.rolbypassrls
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = format(
          'Existing runtime role %I has unsafe attributes; expected NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
          runtime_role_name
        );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT closer_api, closer_system TO %I', session_user);
END $$;

CREATE SCHEMA IF NOT EXISTS closer_private;
REVOKE ALL ON SCHEMA closer_private FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO closer_api, closer_system;
GRANT USAGE ON SCHEMA closer_private TO closer_api;

-- Supabase projects may automatically expose public tables to PostgREST roles.
-- CLOSER production data is reachable only through Fastify, never through PostgREST.
DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY[
        'app_users', 'tenants', 'organization_memberships', 'organization_provisioning_requests',
        'tenant_settings', 'business_knowledge', 'services', 'customers', 'leads',
        'lead_objections', 'conversations', 'messages', 'customer_memory', 'consent_records',
        'next_actions', 'activities', 'assistant_decision_records', 'follow_up_sequences',
        'follow_up_jobs', 'follow_up_attempts', 'human_handoffs', 'bookings', 'quotes',
        'quote_items', 'jobs', 'payments', 'revenue_ledger_events', 'reactivation_candidates',
        'reactivation_campaigns', 'connector_configurations', 'webhook_events',
        'idempotency_records', 'copilot_action_audits', 'audit_logs',
        'organization_invitations', 'closer_schema_migrations'
      ] LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
          EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.app_users FROM PUBLIC;
REVOKE ALL ON TABLE public.closer_schema_migrations FROM PUBLIC;
REVOKE ALL ON TABLE public.closer_schema_migrations FROM closer_api, closer_system;

GRANT SELECT, INSERT, UPDATE ON TABLE public.app_users TO closer_api;
GRANT SELECT, INSERT ON TABLE public.tenants TO closer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE public.organization_memberships TO closer_api;
GRANT SELECT, INSERT ON TABLE public.organization_provisioning_requests TO closer_api;
GRANT SELECT ON TABLE
  public.tenant_settings,
  public.business_knowledge,
  public.services,
  public.customers,
  public.leads,
  public.lead_objections,
  public.conversations,
  public.messages,
  public.customer_memory,
  public.consent_records,
  public.next_actions,
  public.activities,
  public.assistant_decision_records,
  public.follow_up_sequences,
  public.follow_up_jobs,
  public.human_handoffs,
  public.bookings,
  public.quotes,
  public.quote_items,
  public.jobs,
  public.payments,
  public.revenue_ledger_events,
  public.reactivation_candidates,
  public.reactivation_campaigns,
  public.connector_configurations,
  public.idempotency_records,
  public.copilot_action_audits,
  public.audit_logs,
  public.organization_invitations
TO closer_api;
GRANT INSERT, UPDATE ON TABLE
  public.customers,
  public.leads,
  public.conversations,
  public.follow_up_jobs,
  public.human_handoffs,
  public.bookings,
  public.payments,
  public.revenue_ledger_events,
  public.idempotency_records,
  public.copilot_action_audits,
  public.audit_logs,
  public.organization_invitations
TO closer_api;
GRANT DELETE ON TABLE public.idempotency_records TO closer_api;

GRANT SELECT, UPDATE ON TABLE public.follow_up_jobs TO closer_system;
GRANT SELECT, INSERT ON TABLE public.follow_up_attempts TO closer_system;
GRANT SELECT ON TABLE public.connector_configurations TO closer_system;
GRANT SELECT, INSERT, UPDATE ON TABLE public.webhook_events TO closer_system;

CREATE OR REPLACE FUNCTION public.app_has_tenant_access(target_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships membership
    WHERE membership.tenant_id = target_tenant
      AND membership.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND membership.active
  );
$$;

REVOKE ALL ON FUNCTION public.app_has_tenant_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_has_tenant_access(uuid) TO closer_api;

CREATE OR REPLACE FUNCTION closer_private.can_write_own_membership(
  target_tenant uuid,
  target_user uuid,
  target_role public.organization_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT target_user = nullif(current_setting('app.user_id', true), '')::uuid
    AND (
      (
        target_role = 'owner'::public.organization_role
        AND NOT EXISTS (
          SELECT 1 FROM public.organization_memberships membership
          WHERE membership.tenant_id = target_tenant
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.organization_invitations invitation
        JOIN public.app_users app_user
          ON app_user.id = nullif(current_setting('app.user_id', true), '')::uuid
        WHERE invitation.tenant_id = target_tenant
          AND lower(invitation.email) = lower(app_user.email)
          AND invitation.role = target_role
          AND invitation.accepted_at IS NULL
          AND invitation.revoked_at IS NULL
          AND invitation.expires_at > now()
      )
    );
$$;

REVOKE ALL ON FUNCTION closer_private.can_write_own_membership(uuid, uuid, public.organization_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION closer_private.can_write_own_membership(uuid, uuid, public.organization_role) TO closer_api;

DROP POLICY IF EXISTS tenant_member_read ON public.tenants;
CREATE POLICY tenant_member_read ON public.tenants
  FOR SELECT TO closer_api
  USING (public.app_has_tenant_access(id));

DROP POLICY IF EXISTS tenant_provision_insert ON public.tenants;
CREATE POLICY tenant_provision_insert ON public.tenants
  FOR INSERT TO closer_api
  WITH CHECK (true);

DROP POLICY IF EXISTS membership_self_read ON public.organization_memberships;
CREATE POLICY membership_self_read ON public.organization_memberships
  FOR SELECT TO closer_api
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS membership_provision_or_invite_insert ON public.organization_memberships;
CREATE POLICY membership_provision_or_invite_insert ON public.organization_memberships
  FOR INSERT TO closer_api
  WITH CHECK (closer_private.can_write_own_membership(tenant_id, user_id, role));

DROP POLICY IF EXISTS membership_invite_update ON public.organization_memberships;
CREATE POLICY membership_invite_update ON public.organization_memberships
  FOR UPDATE TO closer_api
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (closer_private.can_write_own_membership(tenant_id, user_id, role));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organization_provisioning_requests', 'tenant_settings', 'business_knowledge',
    'services', 'customers', 'leads', 'lead_objections', 'conversations', 'messages',
    'customer_memory', 'consent_records', 'next_actions', 'activities',
    'assistant_decision_records', 'follow_up_sequences', 'follow_up_jobs',
    'follow_up_attempts', 'human_handoffs', 'bookings', 'quotes', 'quote_items',
    'jobs', 'payments', 'revenue_ledger_events', 'reactivation_candidates',
    'reactivation_campaigns', 'connector_configurations', 'webhook_events',
    'idempotency_records', 'copilot_action_audits', 'audit_logs',
    'organization_invitations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I TO closer_api USING (public.app_has_tenant_access(tenant_id)) WITH CHECK (public.app_has_tenant_access(tenant_id))',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitation_recipient_read ON public.organization_invitations;
CREATE POLICY invitation_recipient_read ON public.organization_invitations
  FOR SELECT TO closer_api
  USING (
    accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
    AND lower(email) = lower((
      SELECT app_user.email
      FROM public.app_users app_user
      WHERE app_user.id = nullif(current_setting('app.user_id', true), '')::uuid
    ))
  );

-- System policies are deliberately limited to the queue and verified webhook boundary.
DROP POLICY IF EXISTS closer_system_follow_up_jobs ON public.follow_up_jobs;
CREATE POLICY closer_system_follow_up_jobs ON public.follow_up_jobs
  TO closer_system USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS closer_system_follow_up_attempts ON public.follow_up_attempts;
CREATE POLICY closer_system_follow_up_attempts ON public.follow_up_attempts
  TO closer_system USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS closer_system_connector_lookup ON public.connector_configurations;
CREATE POLICY closer_system_connector_lookup ON public.connector_configurations
  FOR SELECT TO closer_system USING (true);

DROP POLICY IF EXISTS closer_system_webhook_events ON public.webhook_events;
CREATE POLICY closer_system_webhook_events ON public.webhook_events
  TO closer_system USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.claim_follow_up_job(
  worker_id text,
  claimed_at timestamptz,
  lease_until timestamptz
)
RETURNS SETOF public.follow_up_jobs
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidate AS (
    SELECT job.id
    FROM public.follow_up_jobs job
    WHERE job.status IN ('scheduled', 'failed', 'leased')
      AND CASE
        WHEN job.status = 'leased' THEN job.lease_expires_at <= claimed_at
        ELSE COALESCE(job.retry_at, job.due_at) <= claimed_at
      END
      AND job.attempt_count < job.max_attempts
    ORDER BY COALESCE(job.retry_at, job.due_at), job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.follow_up_jobs job
  SET status = 'leased',
      lease_owner = worker_id,
      lease_expires_at = lease_until,
      updated_at = claimed_at
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.*;
$$;

REVOKE ALL ON FUNCTION public.claim_follow_up_job(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_follow_up_job(text, timestamptz, timestamptz) TO closer_system;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.app_has_tenant_access(uuid) FROM %I', role_name);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.claim_follow_up_job(text, timestamptz, timestamptz) FROM %I',
        role_name
      );
      EXECUTE format('REVOKE ALL ON SCHEMA closer_private FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
