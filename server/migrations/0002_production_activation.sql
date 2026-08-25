CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role organization_role NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES app_users(id),
  accepted_by_user_id uuid REFERENCES app_users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX organization_invitations_tenant_status_idx
  ON organization_invitations (tenant_id, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_invitations
  USING (app_has_tenant_access(tenant_id))
  WITH CHECK (app_has_tenant_access(tenant_id));
