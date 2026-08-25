# Recommended next batch — controlled production deployment

Production Foundation v1 now adds the server trust boundary, PostgreSQL migration, JWT/membership authorization, durable job/webhook/idempotency contracts, and server revenue ledger. Do not enable live channel or AI execution until this boundary is deployed and observed in a controlled environment.

Recommended scope:

1. provision managed PostgreSQL/Supabase and verify migration/restore on a staging project;
2. configure real OIDC/Supabase Auth sessions, invitations, and the production UI session adapter;
3. deploy the API and a durable worker/scheduler with logs, metrics, alerts, and distributed rate limiting;
4. exercise complete tenant journeys against the staging database and add database integration tests;
5. implement the WhatsApp Business Platform signature/connector adapter in receive-only shadow mode;
6. add payment-provider webhook reconciliation without trusting browser or customer claims;
7. run real AI in shadow mode and evaluate it before any customer-facing autonomy.

Keep deterministic providers and demo tenants available as simulation mode. Real sends, charges, calendar writes, and LLM autonomy remain separate approvals.

The local implementation environment had no Docker or `psql`; applying the migration to a real PostgreSQL 16 staging instance is the first deployment gate.
