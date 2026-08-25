# Recommended next batch — controlled Supabase staging activation

Production Activation v1 now implements the Supabase session adapter, authenticated onboarding, production read/write slice, tenant switching, invitations, migration verification, readiness, and explicit API/worker lifecycle. Do not enable live channel, AI, charging, or automatic delivery until this path is exercised against an actual staging project.

Recommended scope:

1. provide a Supabase staging project and run `db:migrate` twice, `db:verify`, and `test:postgres`;
2. physically verify sign-up/sign-in, tenant creation/switching, persisted Customer → Lead → Conversation → Follow-up, expiry, and logout/login restore;
3. deploy the API and mock-only worker with logs, metrics, alerts, backups, and a distributed rate-limiter implementation before horizontal scale;
4. implement a durable invitation-email outbox/provider, then verify new-account and existing-account acceptance;
5. implement the WhatsApp Business Platform signature/connector adapter in receive-only shadow mode;
6. add payment-provider webhook reconciliation without trusting browser or customer claims;
7. run real AI in shadow mode and evaluate it before any customer-facing autonomy.

Keep deterministic providers and demo tenants available as simulation mode. Real sends, charges, calendar writes, and LLM autonomy remain separate approvals.

The implementation environment had no Supabase credentials, `TEST_DATABASE_URL`, Docker, or `psql`; real managed migration/auth/persistence remains the first deployment gate and is not represented as completed.
