-- Recovery decisions explain what should happen. Recovery actions persist the
-- separately authorized preparation/execution lifecycle. This migration is
-- additive because 0004 may already be checksummed in staging databases.

CREATE TYPE recovery_action_status AS ENUM (
  'PENDING', 'READY', 'WAITING_APPROVAL', 'EXECUTING', 'COMPLETED',
  'WAITING_CUSTOMER', 'HUMAN_REQUIRED', 'CANCELLED', 'FAILED', 'SUPPRESSED'
);

ALTER TABLE recovery_decisions
  ADD CONSTRAINT recovery_decisions_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE recovery_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN (
    'SEND_SMS', 'SEND_EMAIL', 'WAIT', 'REQUEST_HUMAN', 'ATTEMPT_BOOKING',
    'STOP_RECOVERY', 'MARK_LOST', 'ASK_QUALIFICATION'
  )),
  channel text CHECK (channel IN ('SMS', 'EMAIL', 'MANUAL')),
  status recovery_action_status NOT NULL,
  requires_approval boolean NOT NULL,
  requested_by text NOT NULL CHECK (requested_by IN ('POLICY', 'COPILOT', 'HUMAN')),
  idempotency_key text NOT NULL,
  valid_until timestamptz,
  approved_by_user_id uuid REFERENCES app_users(id),
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  delivery_state text NOT NULL DEFAULT 'LIVE_DISABLED'
    CHECK (delivery_state IN ('PREPARED_ONLY', 'MOCK_ONLY', 'LIVE_DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, decision_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES recovery_decisions(tenant_id, id),
  CHECK (status <> 'WAITING_APPROVAL' OR requires_approval),
  CHECK ((approved_at IS NULL) = (approved_by_user_id IS NULL)),
  CHECK (status NOT IN ('COMPLETED', 'WAITING_CUSTOMER') OR completed_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);

CREATE INDEX recovery_actions_opportunity_idx
  ON recovery_actions (tenant_id, opportunity_id, created_at DESC);

CREATE INDEX recovery_actions_ready_idx
  ON recovery_actions (tenant_id, status, valid_until, created_at)
  WHERE status IN ('READY', 'WAITING_APPROVAL', 'EXECUTING', 'WAITING_CUSTOMER');

CREATE INDEX opportunities_tenant_type_idx
  ON opportunities (tenant_id, opportunity_type, created_at DESC);

ALTER TABLE revenue_ledger_events
  DROP CONSTRAINT revenue_ledger_event_type_check,
  ADD CONSTRAINT revenue_ledger_event_type_check CHECK (
    event_type IS NULL OR event_type IN (
      'ESTIMATE_CREATED', 'POTENTIAL_REVENUE_AT_RISK', 'BOOKING_CREATED',
      'BOOKING_RECOVERED', 'JOB_WON', 'PAYMENT_RECEIVED', 'REFUND', 'ADJUSTMENT'
    )
  );

-- Preserve decisions created before the execution lifecycle existed. These
-- actions remain prepared-only; the migration never implies a historical send.
INSERT INTO recovery_actions (
  tenant_id, opportunity_id, decision_id, action_kind, channel, status,
  requires_approval, requested_by, idempotency_key, valid_until,
  completed_at, delivery_state, created_at, updated_at
)
SELECT
  decision.tenant_id,
  decision.opportunity_id,
  decision.id,
  decision.next_action_kind,
  decision.action_channel,
  CASE
    WHEN decision.next_action_kind = 'REQUEST_HUMAN' THEN 'HUMAN_REQUIRED'::recovery_action_status
    WHEN NOT decision.eligible THEN 'SUPPRESSED'::recovery_action_status
    WHEN decision.execution_state = 'EXECUTED' THEN 'COMPLETED'::recovery_action_status
    WHEN decision.requires_approval THEN 'WAITING_APPROVAL'::recovery_action_status
    WHEN decision.execution_state = 'OBSERVED' THEN 'PENDING'::recovery_action_status
    ELSE 'READY'::recovery_action_status
  END,
  decision.requires_approval,
  'POLICY',
  decision.idempotency_key || ':action',
  CASE WHEN decision.eligible THEN decision.decided_at + interval '24 hours' END,
  CASE WHEN decision.execution_state = 'EXECUTED' THEN COALESCE(decision.executed_at, decision.decided_at) END,
  'LIVE_DISABLED',
  decision.decided_at,
  COALESCE(decision.executed_at, decision.decided_at)
FROM recovery_decisions decision
ON CONFLICT (tenant_id, decision_id) DO NOTHING;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.recovery_actions FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE recovery_actions TO closer_api;

ALTER TABLE recovery_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON recovery_actions TO closer_api
  USING (public.app_has_tenant_access(tenant_id))
  WITH CHECK (public.app_has_tenant_access(tenant_id));
