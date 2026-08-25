CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE follow_up_job_status AS ENUM ('scheduled', 'leased', 'completed', 'failed', 'cancelled');
CREATE TYPE revenue_ledger_stage AS ENUM ('potential', 'pipeline', 'booked', 'collected', 'refunded', 'recovered');
CREATE TYPE webhook_processing_state AS ENUM ('received', 'processed', 'failed');

CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  auth_subject text NOT NULL UNIQUE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'ILS',
  time_zone text NOT NULL DEFAULT 'Asia/Jerusalem',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role organization_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE organization_provisioning_requests (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);

CREATE UNIQUE INDEX one_active_business_knowledge
  ON business_knowledge (tenant_id)
  WHERE active;

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  workflow_type text NOT NULL CHECK (workflow_type IN ('APPOINTMENT_SERVICE', 'QUOTE_JOB')),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  fixed_price_cents bigint CHECK (fixed_price_cents IS NULL OR fixed_price_cents >= 0),
  requires_deposit boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  knowledge jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  phone text NOT NULL,
  email text,
  address text,
  operational_allowed boolean NOT NULL DEFAULT true,
  marketing_allowed boolean NOT NULL DEFAULT false,
  opted_out boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  conversation_id uuid,
  service_id uuid,
  source text NOT NULL,
  source_reference_id text,
  workflow_type text NOT NULL CHECK (workflow_type IN ('APPOINTMENT_SERVICE', 'QUOTE_JOB')),
  sales_state text NOT NULL DEFAULT 'new',
  priority text NOT NULL DEFAULT 'NORMAL',
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ACTIVE','QUALIFIED','WON','LOST','ARCHIVED')),
  next_action jsonb,
  closed_at timestamptz,
  lost_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source, source_reference_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id)
);

CREATE TABLE lead_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  objection text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, lead_id, objection),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  channel text NOT NULL,
  mode text NOT NULL DEFAULT 'AI_ACTIVE' CHECK (mode IN ('AI_ACTIVE', 'HUMAN_ACTIVE', 'PAUSED', 'CLOSED')),
  state text NOT NULL DEFAULT 'NEW_INQUIRY',
  stage text NOT NULL DEFAULT 'NEW_INQUIRY',
  owner_user_id uuid REFERENCES app_users(id),
  automation_enabled boolean NOT NULL DEFAULT true,
  last_customer_message_at timestamptz,
  last_business_response_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id)
);

ALTER TABLE leads
  ADD CONSTRAINT leads_conversation_tenant_fk
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  author text NOT NULL CHECK (author IN ('CUSTOMER','BUSINESS','ASSISTANT','SYSTEM')),
  purpose text NOT NULL CHECK (purpose IN ('OPERATIONAL','MARKETING')),
  body text NOT NULL,
  provider_message_id text,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_message_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id)
);

CREATE TABLE customer_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  fact_key text NOT NULL,
  fact_value jsonb NOT NULL,
  source text NOT NULL,
  source_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, fact_key),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  marketing_allowed boolean NOT NULL,
  operational_allowed boolean NOT NULL,
  opted_out boolean NOT NULL,
  source text NOT NULL,
  changed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
);

CREATE TABLE next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  action_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','COMPLETED','CANCELLED')),
  reason text NOT NULL,
  due_at timestamptz,
  automatic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id)
);

CREATE UNIQUE INDEX one_pending_next_action_per_lead
  ON next_actions (tenant_id, lead_id)
  WHERE status = 'PENDING';

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid,
  conversation_id uuid,
  activity_type text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  operation_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_key),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id)
);

CREATE TABLE assistant_decision_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  triggering_message_id uuid,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id)
);

CREATE TABLE follow_up_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL,
  cadence jsonb NOT NULL,
  stop_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE follow_up_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id uuid,
  conversation_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  channel text NOT NULL,
  reason text NOT NULL,
  status follow_up_job_status NOT NULL DEFAULT 'scheduled',
  due_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  retry_at timestamptz,
  last_error text,
  stop_reason text CHECK (stop_reason IS NULL OR stop_reason IN (
    'CUSTOMER_REPLIED','HUMAN_TAKEOVER','OPPORTUNITY_CLOSED','CONSENT_BLOCKED',
    'MANUAL_OVERRIDE','STATE_CHANGED'
  )),
  manual_override boolean NOT NULL DEFAULT false,
  last_response_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  idempotency_key text NOT NULL,
  draft_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, sequence_id) REFERENCES follow_up_sequences(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
);

CREATE INDEX follow_up_jobs_due_idx ON follow_up_jobs (due_at, retry_at)
  WHERE status IN ('scheduled', 'failed', 'leased');

CREATE OR REPLACE FUNCTION claim_follow_up_job(
  worker_id text,
  claimed_at timestamptz,
  lease_until timestamptz
)
RETURNS SETOF follow_up_jobs
LANGUAGE sql
AS $$
  WITH candidate AS (
    SELECT id
    FROM follow_up_jobs
    WHERE status IN ('scheduled', 'failed', 'leased')
      AND CASE
        WHEN status = 'leased' THEN lease_expires_at <= claimed_at
        ELSE COALESCE(retry_at, due_at) <= claimed_at
      END
      AND attempt_count < max_attempts
    ORDER BY COALESCE(retry_at, due_at), created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE follow_up_jobs job
  SET status = 'leased',
      lease_owner = worker_id,
      lease_expires_at = lease_until,
      updated_at = claimed_at
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.*;
$$;

CREATE TABLE follow_up_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  follow_up_job_id uuid NOT NULL,
  attempt_key text NOT NULL,
  result text NOT NULL,
  provider_message_id text,
  error_code text,
  attempted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, attempt_key),
  FOREIGN KEY (tenant_id, follow_up_job_id) REFERENCES follow_up_jobs(tenant_id, id)
);

CREATE TABLE human_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  reason text NOT NULL,
  detail text NOT NULL,
  triggering_message_id uuid,
  confidence numeric,
  responsible_state text NOT NULL,
  started_by text NOT NULL CHECK (started_by IN ('ASSISTANT','HUMAN')),
  started_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id)
);

CREATE UNIQUE INDEX one_active_handoff_per_conversation
  ON human_handoffs (tenant_id, conversation_id)
  WHERE resolved_at IS NULL;

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  service_id uuid NOT NULL,
  staff_user_id uuid REFERENCES app_users(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'TENTATIVE' CHECK (status IN ('TENTATIVE','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW')),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  deposit_required_cents bigint NOT NULL CHECK (deposit_required_cents >= 0 AND deposit_required_cents <= total_cents),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (end_at > start_at),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id)
);

ALTER TABLE bookings
  ADD CONSTRAINT bookings_prevent_staff_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    staff_user_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status <> 'CANCELLED');

CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','VIEWED','CHANGE_REQUESTED','ACCEPTED','REJECTED','EXPIRED')),
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  deposit_required_cents bigint NOT NULL DEFAULT 0 CHECK (deposit_required_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  expires_at timestamptz,
  accepted_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id)
);

CREATE TABLE quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES quotes(tenant_id, id)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_DEPOSIT','READY_TO_SCHEDULE','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
  address text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  assigned_user_id uuid REFERENCES app_users(id),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  deposit_required_cents bigint NOT NULL CHECK (deposit_required_cents >= 0),
  completed_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, quote_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES quotes(tenant_id, id)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  reference_type text NOT NULL CHECK (reference_type IN ('APPOINTMENT', 'QUOTE', 'JOB')),
  reference_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('DEPOSIT', 'BALANCE', 'REFUND')),
  status text NOT NULL DEFAULT 'COLLECTED' CHECK (status IN ('COLLECTED','FAILED','VOIDED')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  original_payment_id uuid,
  idempotency_key text NOT NULL,
  collected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id),
  FOREIGN KEY (tenant_id, original_payment_id) REFERENCES payments(tenant_id, id),
  CHECK ((kind = 'REFUND') = (original_payment_id IS NOT NULL))
);

CREATE TABLE revenue_ledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  payment_id uuid,
  stage revenue_ledger_stage NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  causation_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, causation_key),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id),
  CHECK (stage NOT IN ('collected', 'refunded', 'recovered') OR payment_id IS NOT NULL)
);

CREATE UNIQUE INDEX one_financial_stage_per_payment
  ON revenue_ledger_events (tenant_id, payment_id, stage)
  WHERE payment_id IS NOT NULL AND stage IN ('collected', 'refunded');

CREATE TABLE reactivation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  reason text NOT NULL,
  eligible_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, lead_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id)
);

CREATE TABLE reactivation_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  approved_by_user_id uuid REFERENCES app_users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE connector_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  execution_mode text NOT NULL DEFAULT 'disabled' CHECK (execution_mode IN ('mock', 'disabled')),
  webhook_endpoint_id text NOT NULL,
  signing_secret_reference text,
  credential_secret_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider),
  UNIQUE (provider, webhook_endpoint_id)
);

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL DEFAULT 'unknown',
  received_at timestamptz NOT NULL,
  verified boolean NOT NULL,
  payload_hash text NOT NULL,
  processing_state webhook_processing_state NOT NULL DEFAULT 'received',
  processing_attempt_count integer NOT NULL DEFAULT 0 CHECK (processing_attempt_count >= 0),
  next_attempt_at timestamptz,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE idempotency_records (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed')),
  response_json jsonb,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, scope, idempotency_key)
);

CREATE TABLE copilot_action_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  tool text NOT NULL,
  arguments_json jsonb NOT NULL,
  authorization_decision text NOT NULL,
  approval_state text NOT NULL,
  execution_result jsonb NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app_has_tenant_access(target_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships membership
    WHERE membership.tenant_id = target_tenant
      AND membership.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND membership.active
  );
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_member_read ON tenants
  USING (app_has_tenant_access(id));

ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_self_read ON organization_memberships
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organization_provisioning_requests', 'tenant_settings', 'business_knowledge',
    'services', 'customers', 'leads', 'lead_objections', 'conversations', 'messages',
    'customer_memory', 'consent_records', 'next_actions', 'activities', 'assistant_decision_records',
    'follow_up_sequences', 'follow_up_jobs', 'follow_up_attempts',
    'human_handoffs', 'bookings', 'quotes', 'quote_items', 'jobs', 'payments',
    'revenue_ledger_events', 'reactivation_candidates', 'reactivation_campaigns',
    'connector_configurations', 'webhook_events', 'idempotency_records',
    'copilot_action_audits', 'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id))',
      table_name
    );
  END LOOP;
END $$;
