# Production architecture v1

## Decision

CLOSER uses a small Node.js 22/24 server, Fastify, and PostgreSQL 16. Authentication is verified server-side with signed OIDC JWTs through a remote JWKS endpoint. This is compatible with Supabase Auth, but the boundary is provider-neutral: Supabase is not imported into React and the server does not trust browser-supplied tenant identity.

The existing TypeScript domain remains the behavioral reference. The production layer adds durable storage, authenticated application APIs, background-job leasing, webhook verification, server-only secrets, and audit records. It does not replace the appointment, quote/job, consent, NextAction, Human Takeover, or financial rules.

## Runtime and API

- Node.js 22 or 24 runs `server/index.ts`; Fastify provides a thin HTTP boundary.
- Zod validates every path and mutation body before application execution.
- Errors have stable codes and safe messages; stack traces, SQL, request bodies, and customer content are not returned or logged.
- A fixed-window limiter defines the early rate-limit boundary. A distributed limiter is required before horizontal production scale.
- `ProductionApiClient` is the browser-facing typed client. It supplies a short-lived access token and never accesses PostgreSQL.
- `DEMO` remains the safe default. `PRODUCTION` is explicit and requires an authenticated API session; it never silently falls back to demo data.

## Database

PostgreSQL 16 is the durable source in production. `server/migrations/0001_production_foundation.sql` is transactional, checksummed, and source-controlled. It represents:

- tenants, users, memberships, roles, services, and service knowledge;
- customers, leads, objections, conversations, messages, and structured memory;
- follow-up sequences, jobs, attempts, retry/lease state, and stop metadata;
- Human Takeover;
- bookings, quotes/items, jobs, payments, refunds, and revenue ledger events;
- reactivation candidates/campaigns;
- connector configuration references and privacy-minimized webhook receipts;
- idempotency records, Copilot action audits, and critical audit logs.

Foreign keys include tenant ownership so references from different tenants cannot be linked. Unique constraints enforce provider-event, message, payment, booking, follow-up, revenue-causation, Copilot, and operation idempotency. Row-level policies are included as defense in depth; the API authorization service remains the primary tenant boundary and every query still includes `tenant_id`.

## Authentication and authorization

`JwksAuthenticator` verifies signature, issuer, audience, expiry, and subject. The subject maps to `app_users.auth_subject`. A user can hold active `owner`, `admin`, or `member` memberships in multiple tenants.

The browser may place a tenant ID in a route, but it is only a requested resource. Before any tenant read or mutation, `AuthorizationService` resolves the authenticated subject's active membership server-side. Missing membership returns the same not-found response as an unknown resource, reducing cross-tenant ID probing.

- `member`: operational reads and customer-journey creation;
- `admin`: member access plus follow-up, booking, payment, revenue, and connector-configuration operations;
- `owner`: admin access plus high-impact Owner Copilot mutations.

New authenticated accounts can create a tenant through an idempotent provisioning operation. It creates/synchronizes the user record, tenant, and owner membership in one transaction.

## Idempotency

`IdempotencyService` hashes canonical request facts. A repeated key with the same facts returns the stored result; different facts return `IDEMPOTENCY_CONFLICT`; an unfinished duplicate returns `IDEMPOTENCY_IN_PROGRESS`. Failed operations abandon the claim so a legitimate retry may proceed.

PostgreSQL also has operation-specific unique constraints. Incoming provider events are unique by provider/event ID. Financial revenue uses tenant-scoped causation keys and validated payment references. Refund ledger entries require a real refund payment. These layers prevent the same money or action being counted twice.

## Jobs

The existing follow-up domain decides whether and when a follow-up is valid. The server execution record adds `due_at`, status, attempt count, maximum attempts, lease owner/expiry, retry time, last error, completion/cancellation timestamps, and an idempotency key.

Workers claim one due job with a transaction and `FOR UPDATE SKIP LOCKED`. Completion/failure requires the same lease owner and a unique attempt key. The supplied dispatcher is deterministic and mock-only. No production customer message can be sent in this milestone.

A deployment may invoke the worker through a managed scheduler, process service, or queue consumer. The scheduling platform must not replace the database lease.

## Webhooks

Webhook routes are unauthenticated by nature, so each provider adapter must verify the exact raw body before parsing. The current HMAC adapter is deterministic test infrastructure, not a WhatsApp/Meta implementation. Production provider adapters must implement the provider's documented signature scheme.

The database stores provider, provider event ID, receipt time, verification state, payload hash, event type, processing state, and safe error metadata. It does not store the raw payload by default. Duplicate same-body deliveries replay the result; reuse of an event ID with changed content is rejected.

## Secrets and integrations

Connector tables store only secret references and boolean availability. `EnvironmentSecretProvider` resolves `CLOSER_SECRET_*` values in the server process. No token, signing secret, AI key, payment key, or mail credential uses a `VITE_` variable or enters the frontend bundle/API response.

`CONNECTOR_EXECUTION_MODE` currently accepts only `mock`. Live WhatsApp, Meta, email, AI, payment, and customer follow-up execution remain disabled until a specific adapter, credentials, provider verification tests, and product authorization exist.

## Owner Copilot

The existing Owner Copilot tool names remain the contract. The server verifies actor, tenant membership, required role, explicit approval for high-impact tools, arguments, and idempotency. The audit stores actor, tenant, tool, redacted argument shape, authorization/approval decision, result, and timestamp. No LLM receives a database client or unrestricted mutation capability.

## Financial truth

The server ledger distinguishes `potential`, `pipeline`, `booked`, `collected`, `refunded`, and `recovered`. Potential/quote value is not cash. Collected/recovered/refunded entries require a tenant-matched validated payment. Refunds link to an original collection, cannot exceed it, and reduce net collected totals. AI/customer claims cannot create ledger truth.

## Local development

1. Use Node 22 or 24 and `npm install`.
2. Copy `.env.example` to ignored `.env` and provide a real local/test JWKS issuer.
3. Start PostgreSQL with `docker compose -f docker-compose.production-local.yml up -d`.
4. Run `npm run db:migrate`.
5. Run `npm run dev:server`; run `npm run dev` separately for the demo UI.

The machine used for this milestone did not have Docker or `psql`. The migration was source-, type-, and contract-tested but not applied to a live PostgreSQL process here. That runtime application remains a deployment-environment gate, not hidden coverage.

## Remaining deployment blockers

- provision managed PostgreSQL/Supabase and apply the migration;
- configure OIDC/Supabase Auth sessions, invitations, issuer, JWKS, audience, and account policy;
- use managed secrets and limited database roles;
- replace the in-process limiter before multi-instance scale;
- deploy a worker/scheduler with observability and alerts;
- implement and certify each real provider signature/connector adapter;
- finish production UI session wiring and API coverage before enabling production data mode;
- add backups, restore drills, retention/deletion policy, and privacy/legal review.
