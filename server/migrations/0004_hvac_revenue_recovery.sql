-- CLOSER V2 HVAC revenue recovery domain. This migration is additive: leads remain
-- immutable acquisition records while opportunities become the commercial unit.

CREATE TYPE opportunity_status AS ENUM (
  'NEW', 'CONTACTING', 'ENGAGED', 'QUALIFIED', 'BOOKED', 'ESTIMATE',
  'WON', 'LOST', 'SNOOZED', 'DO_NOT_CONTACT'
);

CREATE TYPE recovery_state AS ENUM (
  'NOT_AT_RISK', 'AT_RISK', 'RECOVERY_ACTIVE', 'WAITING_FOR_CUSTOMER',
  'HUMAN_REQUIRED', 'RECOVERED', 'FAILED', 'STOPPED'
);

CREATE TYPE opportunity_autonomy_level AS ENUM ('OBSERVE', 'SUGGEST', 'APPROVE_TO_SEND', 'AUTOPILOT');
CREATE TYPE revenue_attribution_type AS ENUM ('GENERATED', 'RECOVERED', 'ASSISTED', 'ORGANIC');
CREATE TYPE recovery_play_type AS ENUM (
  'MISSED_CALL_RECOVERY', 'NEW_LEAD_RECOVERY',
  'UNSOLD_ESTIMATE_RECOVERY', 'OLD_LEAD_REACTIVATION'
);

CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lead_id uuid,
  conversation_id uuid,
  source text NOT NULL,
  opportunity_type text NOT NULL CHECK (opportunity_type IN (
    'EMERGENCY_REPAIR', 'STANDARD_REPAIR', 'MAINTENANCE', 'TUNE_UP',
    'SYSTEM_REPLACEMENT', 'INSTALLATION', 'INDOOR_AIR_QUALITY', 'DUCT_WORK',
    'COMMERCIAL_SERVICE', 'OTHER'
  )),
  estimated_value_cents bigint CHECK (estimated_value_cents IS NULL OR estimated_value_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  intent_score smallint NOT NULL DEFAULT 0 CHECK (intent_score BETWEEN 0 AND 100),
  revenue_score smallint NOT NULL DEFAULT 0 CHECK (revenue_score BETWEEN 0 AND 100),
  recovery_score smallint NOT NULL DEFAULT 0 CHECK (recovery_score BETWEEN 0 AND 100),
  urgency_score smallint NOT NULL DEFAULT 0 CHECK (urgency_score BETWEEN 0 AND 100),
  score_version text NOT NULL DEFAULT 'unscored',
  score_reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  status opportunity_status NOT NULL DEFAULT 'NEW',
  recovery_state recovery_state NOT NULL DEFAULT 'NOT_AT_RISK',
  autonomy_level opportunity_autonomy_level NOT NULL DEFAULT 'SUGGEST',
  assigned_human_id uuid REFERENCES app_users(id),
  last_customer_activity_at timestamptz,
  last_business_activity_at timestamptz,
  next_action_at timestamptz,
  booking_id uuid,
  estimate_id uuid,
  job_id uuid,
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  revenue_attributed_cents bigint NOT NULL DEFAULT 0 CHECK (revenue_attributed_cents >= 0),
  attribution_type revenue_attribution_type,
  attribution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, lead_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings(tenant_id, id),
  FOREIGN KEY (tenant_id, estimate_id) REFERENCES quotes(tenant_id, id),
  FOREIGN KEY (tenant_id, job_id) REFERENCES jobs(tenant_id, id),
  CHECK ((status = 'WON') = (won_at IS NOT NULL)),
  CHECK ((status = 'DO_NOT_CONTACT') = (recovery_state = 'STOPPED') OR status <> 'DO_NOT_CONTACT'),
  CHECK (status <> 'WON' OR recovery_state IN ('RECOVERED', 'NOT_AT_RISK'))
);

CREATE INDEX opportunities_tenant_status_idx ON opportunities (tenant_id, status, updated_at DESC);
CREATE INDEX opportunities_tenant_recovery_idx ON opportunities (tenant_id, recovery_state, recovery_score DESC);
CREATE INDEX opportunities_tenant_next_action_idx ON opportunities (tenant_id, next_action_at)
  WHERE next_action_at IS NOT NULL;
CREATE INDEX opportunities_tenant_customer_idx ON opportunities (tenant_id, customer_id, created_at DESC);
CREATE INDEX opportunities_tenant_activity_idx ON opportunities (
  tenant_id,
  GREATEST(COALESCE(last_customer_activity_at, '-infinity'), COALESCE(last_business_activity_at, '-infinity')) DESC
);

CREATE TABLE opportunity_score_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  intent_score smallint NOT NULL CHECK (intent_score BETWEEN 0 AND 100),
  revenue_score smallint NOT NULL CHECK (revenue_score BETWEEN 0 AND 100),
  recovery_score smallint NOT NULL CHECK (recovery_score BETWEEN 0 AND 100),
  urgency_score smallint NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
  score_version text NOT NULL,
  reason_codes text[] NOT NULL,
  explanation text NOT NULL,
  causation_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, opportunity_id, causation_key),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id)
);

CREATE TABLE recovery_play_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  play_type recovery_play_type NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  autonomy_level opportunity_autonomy_level NOT NULL DEFAULT 'SUGGEST',
  version text NOT NULL DEFAULT 'hvac-recovery-v1',
  contact_window_start time NOT NULL DEFAULT '08:00',
  contact_window_end time NOT NULL DEFAULT '20:00',
  max_attempts smallint NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, play_type)
);

CREATE TABLE recovery_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  play_type recovery_play_type,
  eligible boolean NOT NULL,
  suppression_reason text,
  next_action_kind text NOT NULL CHECK (next_action_kind IN (
    'SEND_SMS', 'SEND_EMAIL', 'WAIT', 'REQUEST_HUMAN', 'ATTEMPT_BOOKING',
    'STOP_RECOVERY', 'MARK_LOST', 'ASK_QUALIFICATION'
  )),
  next_action_label text NOT NULL,
  action_channel text CHECK (action_channel IN ('SMS', 'EMAIL', 'MANUAL')),
  requires_approval boolean NOT NULL,
  due_at timestamptz,
  policy_version text NOT NULL,
  score_version text NOT NULL,
  intent_score smallint NOT NULL CHECK (intent_score BETWEEN 0 AND 100),
  revenue_score smallint NOT NULL CHECK (revenue_score BETWEEN 0 AND 100),
  recovery_score smallint NOT NULL CHECK (recovery_score BETWEEN 0 AND 100),
  urgency_score smallint NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
  reason_codes text[] NOT NULL,
  execution_state text NOT NULL CHECK (execution_state IN (
    'OBSERVED', 'SUGGESTED', 'PENDING_APPROVAL', 'EXECUTED', 'SUPPRESSED'
  )),
  idempotency_key text NOT NULL,
  decided_at timestamptz NOT NULL,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id)
);

CREATE INDEX recovery_decisions_opportunity_idx
  ON recovery_decisions (tenant_id, opportunity_id, decided_at DESC);

ALTER TABLE revenue_ledger_events
  ADD COLUMN opportunity_id uuid,
  ADD COLUMN event_type text,
  ADD COLUMN attribution_type revenue_attribution_type,
  ADD COLUMN attribution_reason text,
  ADD CONSTRAINT revenue_ledger_opportunity_fk
    FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id),
  ADD CONSTRAINT revenue_ledger_event_type_check CHECK (
    event_type IS NULL OR event_type IN (
      'ESTIMATE_CREATED', 'POTENTIAL_REVENUE_AT_RISK', 'BOOKING_RECOVERED',
      'JOB_WON', 'PAYMENT_RECEIVED', 'REFUND', 'ADJUSTMENT'
    )
  );

CREATE INDEX revenue_ledger_opportunity_idx
  ON revenue_ledger_events (tenant_id, opportunity_id, occurred_at DESC)
  WHERE opportunity_id IS NOT NULL;

-- Preserve existing data: each legacy lead becomes one initial opportunity. Future
-- inquiries can create additional opportunities for the same customer.
INSERT INTO opportunities (
  tenant_id, customer_id, lead_id, conversation_id, source, opportunity_type,
  estimated_value_cents, status, recovery_state, last_customer_activity_at,
  last_business_activity_at, booking_id, estimate_id, job_id, won_at, lost_at,
  lost_reason, revenue_attributed_cents, attribution_type, attribution_reason,
  created_at, updated_at
)
SELECT
  lead.tenant_id,
  lead.customer_id,
  lead.id,
  lead.conversation_id,
  CASE upper(lead.source)
    WHEN 'WEBSITE_FORM' THEN 'WEBSITE_FORM'
    WHEN 'WHATSAPP' THEN 'WHATSAPP'
    WHEN 'INSTAGRAM' THEN 'INSTAGRAM'
    WHEN 'EMAIL' THEN 'EMAIL'
    WHEN 'IMPORT' THEN 'IMPORT'
    WHEN 'MANUAL' THEN 'MANUAL'
    ELSE 'OTHER'
  END,
  'OTHER',
  COALESCE(quote.total_cents, job.total_cents, booking.total_cents),
  CASE lead.status
    WHEN 'NEW' THEN 'NEW'::opportunity_status
    WHEN 'ACTIVE' THEN 'ENGAGED'::opportunity_status
    WHEN 'QUALIFIED' THEN 'QUALIFIED'::opportunity_status
    WHEN 'WON' THEN 'WON'::opportunity_status
    WHEN 'LOST' THEN 'LOST'::opportunity_status
    ELSE 'SNOOZED'::opportunity_status
  END,
  CASE lead.status
    WHEN 'WON' THEN 'NOT_AT_RISK'::recovery_state
    WHEN 'LOST' THEN 'AT_RISK'::recovery_state
    WHEN 'ARCHIVED' THEN 'STOPPED'::recovery_state
    ELSE 'NOT_AT_RISK'::recovery_state
  END,
  conversation.last_customer_message_at,
  conversation.last_business_response_at,
  booking.id,
  quote.id,
  job.id,
  CASE WHEN lead.status = 'WON' THEN COALESCE(lead.closed_at, lead.updated_at) END,
  CASE WHEN lead.status = 'LOST' THEN COALESCE(lead.closed_at, lead.updated_at) END,
  lead.lost_reason,
  COALESCE(financial.collected_cents - financial.refunded_cents, 0),
  CASE WHEN lead.status = 'WON' THEN 'ORGANIC'::revenue_attribution_type END,
  CASE WHEN lead.status = 'WON' THEN 'Migrated legacy outcome; no recovery evidence available' END,
  lead.created_at,
  lead.updated_at
FROM leads lead
LEFT JOIN conversations conversation
  ON conversation.tenant_id = lead.tenant_id AND conversation.id = lead.conversation_id
LEFT JOIN LATERAL (
  SELECT item.id, item.total_cents
  FROM bookings item
  WHERE item.tenant_id = lead.tenant_id AND item.lead_id = lead.id
  ORDER BY item.created_at DESC LIMIT 1
) booking ON true
LEFT JOIN LATERAL (
  SELECT item.id, item.total_cents
  FROM quotes item
  WHERE item.tenant_id = lead.tenant_id AND item.lead_id = lead.id
  ORDER BY item.created_at DESC LIMIT 1
) quote ON true
LEFT JOIN LATERAL (
  SELECT item.id, item.total_cents
  FROM jobs item
  WHERE item.tenant_id = lead.tenant_id AND item.lead_id = lead.id
  ORDER BY item.created_at DESC LIMIT 1
) job ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(CASE WHEN entry.stage = 'collected' THEN entry.amount_cents ELSE 0 END), 0) AS collected_cents,
    COALESCE(SUM(CASE WHEN entry.stage = 'refunded' THEN entry.amount_cents ELSE 0 END), 0) AS refunded_cents
  FROM revenue_ledger_events entry
  WHERE entry.tenant_id = lead.tenant_id AND entry.lead_id = lead.id
) financial ON true
ON CONFLICT (tenant_id, lead_id) DO NOTHING;

UPDATE revenue_ledger_events event
SET opportunity_id = opportunity.id,
    event_type = CASE event.stage
      WHEN 'potential' THEN 'ESTIMATE_CREATED'
      WHEN 'pipeline' THEN 'POTENTIAL_REVENUE_AT_RISK'
      WHEN 'booked' THEN 'BOOKING_RECOVERED'
      WHEN 'collected' THEN 'PAYMENT_RECEIVED'
      WHEN 'refunded' THEN 'REFUND'
      WHEN 'recovered' THEN 'BOOKING_RECOVERED'
      ELSE 'ADJUSTMENT'
    END
FROM opportunities opportunity
WHERE opportunity.tenant_id = event.tenant_id
  AND opportunity.lead_id = event.lead_id
  AND event.opportunity_id IS NULL;

INSERT INTO recovery_play_definitions (tenant_id, play_type)
SELECT tenant.id, play.play_type::recovery_play_type
FROM tenants tenant
CROSS JOIN (VALUES
  ('MISSED_CALL_RECOVERY'),
  ('NEW_LEAD_RECOVERY'),
  ('UNSOLD_ESTIMATE_RECOVERY'),
  ('OLD_LEAD_REACTIVATION')
) AS play(play_type)
ON CONFLICT (tenant_id, play_type) DO NOTHING;

DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY[
        'opportunities', 'opportunity_score_snapshots',
        'recovery_play_definitions', 'recovery_decisions'
      ] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE
  opportunities,
  opportunity_score_snapshots,
  recovery_play_definitions,
  recovery_decisions
TO closer_api;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'opportunities', 'opportunity_score_snapshots',
    'recovery_play_definitions', 'recovery_decisions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I TO closer_api USING (public.app_has_tenant_access(tenant_id)) WITH CHECK (public.app_has_tenant_access(tenant_id))',
      table_name
    );
  END LOOP;
END $$;
