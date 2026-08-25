# Production activation setup

This guide activates CLOSER against Supabase Auth and managed PostgreSQL without changing the trusted path:

`React → ProductionApiClient → Fastify → authorization/application services → PostgreSQL`

The Supabase browser client manages identity sessions only. It never receives a database password or service-role key and never reads CLOSER tables directly.

## 1. Create the Supabase project

Create a Supabase project and keep live messaging, AI autonomy, payment charging, and automatic delivery disabled. Configure email/password authentication for the first controlled users.

Use asymmetric JWT signing keys. The Fastify verifier requires the project's public JWKS endpoint:

```text
AUTH_ISSUER=https://PROJECT.supabase.co/auth/v1
AUTH_JWKS_URL=https://PROJECT.supabase.co/auth/v1/.well-known/jwks.json
AUTH_AUDIENCE=authenticated
```

The legacy shared-secret signing mode does not expose public keys through JWKS and is not supported by this deployment contract.

## 2. Configure server secrets

Copy `.env.production.example` to the deployment secret manager, not to Git. Required server values are:

- `DATABASE_URL`
- `AUTH_ISSUER`
- `AUTH_JWKS_URL`
- `AUTH_AUDIENCE` when the project token includes an audience
- `FRONTEND_ORIGIN`
- `HOST`, `PORT`, and `NODE_ENV=production`

`CONNECTOR_EXECUTION_MODE` must remain `mock`. `ALLOW_DEVELOPMENT_INVITE_LINKS` must remain `false` in production.

For migrations, use the Supabase direct connection or session pooler connection from **Connect**. For a persistent Fastify process, use the direct connection where reachable or the session pooler on IPv4-only infrastructure. Include TLS as required by the supplied connection string.

Never expose the database password, JWT signing secret, service-role key, webhook secret, or connector credentials through a `VITE_` variable.

## 3. Configure the browser build

The following are public browser configuration, not authorization secrets:

```text
VITE_CLOSER_DATA_MODE=PRODUCTION
VITE_CLOSER_API_URL=https://api.example.com
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Use a publishable/anon client key only. The Fastify API validates every access token and resolves every tenant membership again on the server.

`npm run build` deliberately builds the deterministic demo. Use `npm run build:production` for an authenticated production build. Missing production browser variables stop the build/runtime bootstrap; they do not fall back to demo data.

## 4. Apply and verify migrations

With `DATABASE_URL` injected by the process manager, or an optional ignored `.env` for local development:

```bash
npm run db:migrate
npm run db:migrate
npm run db:verify
```

The second migration run proves the checksummed runner is repeat-safe. `db:verify` connects to the actual database and verifies migration checksums, critical tables, indexes, RLS enablement/policies, and the concurrent follow-up claim function. A missing or changed object fails the command.

All API, worker, and database commands use `.env` only when it exists. A production secret manager may inject variables directly; a missing optional file never causes a fallback, and missing required values still fail at boot with explicit field names.

`0001_production_foundation.sql` remains unchanged. `0002_production_activation.sql` adds hashed, expiring, single-use organization invitations.

## 5. Run the two server processes

Development:

```bash
npm run dev:server
npm run dev:worker
npm run dev
```

Built processes:

```bash
npm run build:production
npm run server:start
npm run worker:start
```

The API and worker need the same database, but run independently. The worker leases due jobs with `FOR UPDATE SKIP LOCKED`, recovers expired leases, and exits cleanly on `SIGINT`/`SIGTERM`. Its dispatcher remains deterministic and mock-only; it cannot send a live customer message.

## 6. Health and readiness

- `GET /health` proves that the Fastify process is alive.
- `GET /ready` separately checks database reachability and migration/schema compatibility.

Readiness returns only stable reason codes. It never returns SQL, credentials, or stack traces.

## 7. First account and tenant

1. Open the production browser build.
2. Sign up or sign in with Supabase Auth.
3. If the user has no memberships, create the first business.
4. Fastify synchronizes the auth subject, creates the tenant, and makes the creator `owner` in one transaction.
5. Create a customer journey and schedule a follow-up.
6. Reload the page and restart the API; the customer, lead, conversation, and follow-up must still load from PostgreSQL.

The active tenant stored by the browser is only a preference. The server rejects a guessed tenant, inactive/deleted membership, invalid JWT, expired JWT, or insufficient role.

## 8. Invitations

Development may set `ALLOW_DEVELOPMENT_INVITE_LINKS=true` with `DEVELOPMENT_INVITE_BASE_URL`. The API returns a one-time development acceptance URL; PostgreSQL stores only its SHA-256 hash. Tokens expire, match the authenticated email, accept once, and can be revoked before use.

Production invitation creation fails closed with `INVITATION_DELIVERY_DISABLED` until a durable email/outbox provider is implemented. CLOSER does not create an unreachable production invitation or expose a raw token in production.

## 9. PostgreSQL integration verification

Use a dedicated non-production database:

```bash
TEST_DATABASE_URL=postgresql://... npm run test:postgres
```

The integration suite applies migrations twice, runs `db:verify`, creates two real tenants, exercises authenticated Customer → Lead → Conversation → Follow-up persistence across an API restart, attempts cross-tenant ID guessing, and removes only its generated tenant data afterward. The command refuses to use `DATABASE_URL` implicitly.

## 10. Current activation gate

This repository environment did not provide a Supabase project, database URL, test database URL, Docker, or `psql`. Therefore the live Supabase migration, real hosted sign-in, real PostgreSQL integration test, and browser reload against that service are not claimed. Once credentials are supplied through ignored environment configuration, the commands above are the deterministic activation gate.

Official references: [Supabase JWT/JWKS](https://supabase.com/docs/guides/auth/jwts), [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), and [Supabase JavaScript Auth](https://supabase.com/docs/reference/javascript/auth).
