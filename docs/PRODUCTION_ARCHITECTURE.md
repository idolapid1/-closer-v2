# Production architecture v1

## Decision

CLOSER uses a small Node.js 22/24 server, Fastify, and PostgreSQL 16. Supabase is the first managed platform: its browser client owns sign-in/session refresh, its Auth service issues identity JWTs, and its PostgreSQL service stores production records. Fastify still verifies signed JWTs through the project's JWKS endpoint and never trusts browser-supplied tenant identity. React does not use the Supabase Data API or database client.

The existing TypeScript domain remains the behavioral reference. The production layer adds durable storage, authenticated application APIs, background-job leasing, webhook verification, server-only secrets, and audit records. It does not replace the appointment, quote/job, consent, NextAction, Human Takeover, or financial rules.

## Runtime and API

- Node.js 22 or 24 runs `server/index.ts`; Fastify provides a thin HTTP boundary.
- Zod validates every path and mutation body before application execution.
- Errors have stable codes and safe messages; stack traces, SQL, request bodies, and customer content are not returned or logged.
- `RateLimiter` has explicit in-memory and distributed implementations. The deployment currently wires the in-memory limiter, so horizontal scale still requires a real distributed store.
- `ProductionApiClient` is the browser-facing typed client. It supplies and refreshes a short-lived access token and never accesses PostgreSQL.
- `DEMO` and `PRODUCTION` are explicit build/runtime paths. A production configuration or request failure shows a safe error and never silently falls back to demo data.
- `/health` proves process liveness. `/ready` separately proves database reachability and schema compatibility.

## Database

PostgreSQL 16 is the durable source in production. The migration runner is transactional, checksummed, ordered, and source-controlled. `0001_production_foundation.sql` remains the commercial foundation; `0002_production_activation.sql` adds organization invitations; `0003_supabase_security_hardening.sql` adds constrained runtime roles, request identity enforcement, PostgREST protection, fixed function search paths, and server-only worker/webhook permissions; `0004_hvac_revenue_recovery.sql` adds the first-class opportunity, scoring, recovery-decision, and attribution model; `0005` adds the recovery-action lifecycle and `BOOKING_CREATED`; `0006` conservatively corrects historical booked events without material recovery evidence; `0007` grants the constrained API role only the inbound-message insert needed by the validated Fastify response boundary; and `0008` corrects unapproved historical `OBSERVE`/`SUGGEST` actions so those modes remain non-executable. Together they represent:

- tenants, users, memberships, roles, services, and service knowledge;
- customers, leads, objections, conversations, messages, and structured memory;
- follow-up sequences, jobs, attempts, retry/lease state, and stop metadata;
- Human Takeover;
- bookings, quotes/items, jobs, payments, refunds, and revenue ledger events;
- reactivation candidates/campaigns;
- connector configuration references and privacy-minimized webhook receipts;
- idempotency records, Copilot action audits, and critical audit logs.

### Revenue recovery boundary

Customer identity, acquisition Lead, and commercial Opportunity are intentionally distinct. An Opportunity links one customer need to its lead, conversation, booking or estimate/job, score snapshots, recovery decisions, and revenue evidence. The database permits many opportunities for one customer but one opportunity per lead.

`OpportunityScoringService` computes separate intent, revenue, recovery, and urgency scores from validated observation facts. `RecoveryEngine` selects one of four HVAC plays and returns a next-best-action proposal plus suppressions. Neither receives a repository or connector. `PostgresProductionStore.evaluateOpportunityRecovery` reconstructs observation from tenant-scoped database truth inside the authenticated RLS transaction, then persists the immutable decision, score snapshot, and separately authorized recovery action. A real send is not performed.

Bookings reconcile the linked appointment-service Opportunity to `BOOKED` and add a non-cash booked ledger event. Attribution is conservative: only completed/waiting-customer recovery evidence is `RECOVERED`; prepared-only participation is `ASSISTED`; no material intervention is `ORGANIC`. Payments remain separate validated records. Collected attribution is recalculated from collected minus refunded ledger rows for that exact Opportunity. Human Takeover moves the Opportunity to `HUMAN_REQUIRED`, cancels even leased follow-up work and prepared actions, and explicit Resume AI returns it to `AT_RISK` without silently restoring cancelled work.

The Revenue Copilot adds tenant-scoped read tools for revenue at risk, priority and human-required opportunities, plus an owner-approved recovery preparation tool. The preparation tool evaluates policy; it does not send, charge, or grant an LLM database access.

Foreign keys include tenant ownership so references from different tenants cannot be linked. Unique constraints enforce provider-event, message, payment, booking, follow-up, revenue-causation, Copilot, and operation idempotency. Application authorization and RLS are both enforced; neither is treated as optional.

### Request-scoped database identity

Every authenticated HTTP operation owns one short PostgreSQL transaction and one transaction-bound store. The boundary performs this sequence on the same pooled connection:

1. `BEGIN` and `SET LOCAL ROLE closer_api` (a `NOBYPASSRLS` role);
2. resolve or safely synchronize the verified JWT subject in `app_users`;
3. set `app.user_id` with transaction-local `set_config(..., true)`;
4. resolve membership and execute all reads/mutations through that scoped store;
5. `COMMIT` or `ROLLBACK`, which clears both role and identity before the connection returns to the pool.

Unscoped `PostgresProductionStore` methods fail before querying. Nested execution contexts are rejected. No session-global `SET`, browser tenant authority, service-role key, or application `BYPASSRLS` privilege is used. First-time authenticated users receive only an `app_users` identity row; tenant authority begins only after the constrained provisioning or invitation path creates a valid membership.

## Authentication and authorization

`JwksAuthenticator` verifies signature, issuer, audience, expiry, and subject. The subject maps to `app_users.auth_subject`. A user can hold active `owner`, `admin`, or `member` memberships in multiple tenants.

The browser may place a tenant ID in a route, but it is only a requested resource. Before any tenant read or mutation, `AuthorizationService` resolves the authenticated subject's active membership server-side. Missing membership returns the same not-found response as an unknown resource, reducing cross-tenant ID probing.

- `member`: operational reads and customer-journey creation;
- `admin`: member access plus follow-up, booking, payment, revenue, and connector-configuration operations;
- `owner`: admin access plus high-impact Owner Copilot mutations.

New authenticated accounts can create a tenant through an idempotent provisioning operation. It creates/synchronizes the user record, tenant, and owner membership in one transaction. The browser may remember a selected tenant, but the API resolves active membership on every tenant request.

The frontend `AuthClient` abstraction contains provider-specific session behavior. `SupabaseAuthClient` handles sign-in, sign-up, restore, refresh, expiration, and sign-out. Server authorization remains independent of that UI state.

Organization invitation tokens are random, hashed before persistence, email-bound, expiring, revocable, and single-use. Owner/admin roles may invite; member may not. Development can expose a one-time URL. Production fails closed until a durable invitation-delivery provider exists.

## Idempotency

`IdempotencyService` hashes canonical request facts. A repeated key with the same facts returns the stored result; different facts return `IDEMPOTENCY_CONFLICT`; an unfinished duplicate returns `IDEMPOTENCY_IN_PROGRESS`. Failed operations abandon the claim so a legitimate retry may proceed.

PostgreSQL also has operation-specific unique constraints. Incoming provider events are unique by provider/event ID. Financial revenue uses tenant-scoped causation keys and validated payment references. Refund ledger entries require a real refund payment. These layers prevent the same money or action being counted twice.

## Jobs

The existing follow-up domain decides whether and when a follow-up is valid. The server execution record adds `due_at`, status, attempt count, maximum attempts, lease owner/expiry, retry time, last error, completion/cancellation timestamps, and an idempotency key.

Workers claim one due job with a transaction and `FOR UPDATE SKIP LOCKED`. Completion/failure requires the same lease owner and a unique attempt key. The supplied dispatcher is deterministic and mock-only. No production customer message can be sent in this milestone.

`server/worker.ts` is the explicit long-running process with graceful shutdown and a configurable poll/lease interval. A deployment may run it as a worker service or managed process. The scheduling platform must not replace the database lease.

Worker database work uses the explicit `follow-up-worker` system context. It sets `SET LOCAL ROLE closer_system`, which is also `NOBYPASSRLS` and has RLS policies/table grants only for follow-up jobs and attempts. It cannot read customer, payment, revenue, membership, or general tenant tables. The public claim function is `SECURITY INVOKER`, has an empty fixed `search_path`, and is executable only by `closer_system`.

## Webhooks

Webhook routes are unauthenticated by nature, so each provider adapter must verify the exact raw body before parsing. The current HMAC adapter is deterministic test infrastructure, not a WhatsApp/Meta implementation. Production provider adapters must implement the provider's documented signature scheme.

The database stores provider, provider event ID, receipt time, verification state, payload hash, event type, processing state, and safe error metadata. It does not store the raw payload by default. Duplicate same-body deliveries replay the result; reuse of an event ID with changed content is rejected.

Webhook lookup, signature verification, and receipt persistence run inside the explicit `webhook-ingestion` system context. The same constrained `closer_system` role receives only connector lookup and webhook receipt permissions. This path exists because an inbound webhook has no interactive user identity; it does not grant the HTTP API a system context or general tenant access.

## Secrets and integrations

Connector tables store only secret references and boolean availability. `EnvironmentSecretProvider` resolves `CLOSER_SECRET_*` values in the server process. No token, signing secret, AI key, payment key, or mail credential uses a `VITE_` variable or enters the frontend bundle/API response.

`CONNECTOR_EXECUTION_MODE` currently accepts only `mock`. Live WhatsApp, Meta, email, AI, payment, and customer follow-up execution remain disabled until a specific adapter, credentials, provider verification tests, and product authorization exist.

## Owner Copilot

The existing Owner Copilot tool names remain the contract. The server verifies actor, tenant membership, required role, explicit approval for high-impact tools, arguments, and idempotency. The audit stores actor, tenant, tool, redacted argument shape, authorization/approval decision, result, and timestamp. No LLM receives a database client or unrestricted mutation capability.

## Financial truth

The server ledger distinguishes `potential`, `pipeline`, `booked`, `collected`, `refunded`, and `recovered`. Potential/quote value is not cash. Collected/recovered/refunded entries require a tenant-matched validated payment. Refunds link to an original collection, cannot exceed it, and reduce net collected totals. AI/customer claims cannot create ledger truth.

## Local development and activation

1. Use Node 22 or 24 and `npm install`.
2. Copy `.env.local.example` to ignored `.env`, or inject the same values through the process environment, and provide a Supabase project/JWKS issuer.
3. Start PostgreSQL with `docker compose -f docker-compose.production-local.yml up -d`.
4. Run `npm run db:migrate` twice, then `npm run db:verify`.
5. Run `npm run dev:server`, `npm run dev:worker`, and `npm run dev` separately.

See [Production setup](PRODUCTION_SETUP.md) for the complete Supabase, environment, migration, browser, API, worker, and integration-test procedure.

## Remaining deployment blockers

- provision managed PostgreSQL/Supabase and apply the migration;
- supply a real Supabase project and exercise the implemented Auth session flow;
- apply and verify all checksummed migrations on managed PostgreSQL;
- use managed secrets and limited database roles;
- replace the in-process limiter before multi-instance scale;
- deploy a worker/scheduler with observability and alerts;
- implement and certify each real provider signature/connector adapter;
- add a durable invitation email/outbox provider before production team invitations;
- add backups, restore drills, retention/deletion policy, and privacy/legal review.
