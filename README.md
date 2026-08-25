# CLOSER v2 — revenue operating-system foundation

CLOSER is a **lead-to-cash autopilot for service businesses**: it moves every inquiry toward the next best validated action until the customer books or approves, completes the service, and pays. The authoritative direction is the [CLOSER Product Bible](docs/PRODUCT_BIBLE.md).

Phase 4.2 propagates the approved Neo-Luxury foundation across the complete normal owner application. Today, Customers, Customer Workspace, Conversation, Calendar/Jobs, Money, and More now share one dark Hebrew-first operating environment. The verified Phase 1–3 commercial engine remains the source of truth; `/debug` and the other engineering routes deliberately keep their utilitarian presentation.

The owner product still runs in deterministic **demo mode** by default. Production Activation v1 adds Supabase session wiring, authenticated onboarding, server-verified tenant switching, production owner read models, Customer → Lead → Conversation → Follow-up persistence, hashed invitations, database verification, API/worker processes, readiness, structured logging, and safe production failure states. No live customer connector, external AI, invitation email, or payment gateway is enabled by default, and the repository contains no secrets.

## Requirements

- Node.js 22 LTS or 24 LTS (the verified build uses Node 24.19.0)
- npm 10 or newer

Node 26 is intentionally outside the current supported range. Node's experimental global Web Storage getter can shadow jsdom's `localStorage`; the repository test commands disable that Node-only experiment so jsdom remains the browser test environment. The shared test setup is not patched or polyfilled.

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. The default route opens **Today** at `/actions`. The owner menu links to `/customers`, `/work`, `/money`, and `/more`; `/customer/:id` and `/inbox` provide the journey and conversation contexts. `/debug` preserves the Conversation Simulator. The business selector switches among the three deterministic clinic, detailing, and home-services tenants.

## Production activation

The production path is explicitly separate from browser demo persistence:

```bash
docker compose -f docker-compose.production-local.yml up -d
cp .env.local.example .env
npm run db:migrate
npm run db:migrate
npm run db:verify
npm run dev:server
npm run dev:worker
```

Provide a Supabase database URL, asymmetric-JWT issuer/JWKS, exact frontend origin, and public browser Auth configuration through the process environment or an ignored local `.env`. The server defaults to mock connector execution and refuses live connector mode. Build an authenticated browser bundle with `npm run build:production`; `npm run build` deliberately remains the demo build. See [Production setup](docs/PRODUCTION_SETUP.md) and [Production architecture](docs/PRODUCTION_ARCHITECTURE.md).

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:server
npm run test:postgres # requires TEST_DATABASE_URL
npm run build
npm run build:production # requires public Supabase/Vite config
npm run verify
npm audit
```

`npm run verify` runs lint, strict TypeScript checking, all Vitest tests, and the production build in sequence.

## Owner application

- `/actions` — revenue-first Command Center with validated collection, known open value, human-prioritized decisions, Today, and real balances
- `/customers` — customer/opportunity operating view grouped by the commercial state that matters now
- `/customer/:id` — one customer’s appointment or quote/job journey, action, context, money, consent, and activity
- `/inbox` — commercial conversation context with customer journey, Human Takeover, grounded recommendation, and composer
- `/work` — configured appointment/job operational schedule
- `/money` — verified balances and collected truth
- `/more` — current business, team, automation-boundary, communication, and help context

The open-source `MaskedHeading` and `MoltenMetal` implementations are adapted locally with TypeScript, Hebrew/RTL handling, reduced-motion fallbacks, WebGL lifecycle cleanup, and a deliberate mobile GPU budget. Today is lazy-loaded so GSAP/OGL do not inflate routine owner routes. Visible MaskedHeading text uses normal DOM glyph shaping rather than SVG text, fixing the WebKit Hebrew reversal class without reversing strings. `gsap` and `ogl` are the only added runtime dependencies. No React Bits Pro code, registry, license key, or proprietary implementation is used.

## Engineering routes

- `/demo` — tenant summary, scenario contacts, and current actions
- `/appointments` — appointment, deposit, confirmation, completion, and balance controls
- `/quotes` — quote/job, deposit, scheduling, completion, and balance controls
- `/debug` — Conversation Simulator, tool results, memory, follow-ups, handoffs, financial events, raw tenant state, and reset

## Architecture and trust boundaries

Domain entities and rules are pure TypeScript. `CloserService` is the mutation boundary. `CommercialJourneyService` derives opportunity totals, collection, stage, relationships, and one action from domain truth; `ActivityTimelineService` records tenant-scoped idempotent business events. `ProductReadService` builds tenant-scoped presentation models for Today, Inbox, Customers, Customer Workspace, Work, Money, and revenue truth, while `productCopy` translates internal states into plain Hebrew. Focused conversation services retain the Phase 2 trust boundary.

Revenue presentation is deliberately conservative. Validated collection is net collected payments after refunds. Money due now is limited to a required deposit or a completed-service balance. Known open value is not cash. Revenue generated or recovered by CLOSER remains `null` until a collected RevenueEvent is explicitly verified against tenant-matched business activities; refunds reduce verified attribution.

The persisted sales context records source, external source reference, priority, and typed objections on the existing Lead opportunity. Follow-up records carry vertical cadence, sequence, channel, attempts, owner, draft, result, stop reason, and idempotency. Reactivation is owner-approved, marketing-consent gated, and scheduled rather than sent immediately. The Owner Copilot boundary exposes tenant-authorized read tools and requires explicit approval for business-changing tools. WhatsApp, Instagram, website-form, and email connector contracts have deterministic fixtures; all production connectors remain disabled.

The AI provider is untrusted and has no repository, network, clock, or mutation access. The application reconstructs auto-sent Level 1/2 replies from validated knowledge/tool results. Appointment, quote, deposit, payment, and scheduling changes are proposals until the existing application use cases validate them. React never accesses `localStorage` or implements business rules.

In production mode the browser also has no repository/database access. `SupabaseAuthClient` restores and refreshes the identity session; `ProductionApiClient` attaches the short-lived token; Fastify verifies signature/issuer/audience and resolves every tenant membership before accessing `PostgresProductionStore`. Tenant-linked foreign keys, unique operation keys, and RLS add defense in depth. Server-only database, service-role, and `CLOSER_SECRET_*` values never enter Vite or API responses. A production error never reveals the deterministic demo.

See [Product Bible](docs/PRODUCT_BIBLE.md), [Architecture](docs/ARCHITECTURE.md), [Revenue OS](docs/REVENUE_OS.md), [Product UX history](docs/PRODUCT_UX.md), [Phase 4 design-system history](docs/DESIGN_SYSTEM.md), [Conversation Engine](docs/CONVERSATION_ENGINE.md), [Assistant Safety](docs/ASSISTANT_SAFETY.md), [Assistant Tools](docs/ASSISTANT_TOOLS.md), and [Financial Rules](docs/FINANCIAL_RULES.md).

## Local data

Schema v5 is stored under `closer-v2:database` in `localStorage`. Valid v1–v4 schemas are migrated with safe commercial, follow-up, sales-context, and unattributed-revenue defaults; invalid or corrupt data falls back to the deterministic seed. Use **Debug → Reset demo data** to restore all three tenants. No real customer data is included.

## Remote backup

Local Git is not a backup. This repository already tracks `origin/main`; confirm it after each verified phase:

```bash
git remote -v
git status --short --branch
git push
```

Never commit `.env` files, credentials, tokens, customer exports, or production data.

## Deliberate exclusions

The current build does not include production AI, live WhatsApp/Meta/Instagram/email, invitation email delivery, a live payment gateway, calendar integrations, deployment, or redesigns for the engineering appointment, quote/job, and debug modules. The activation path exists, but this checkout has no Supabase/database credentials, so hosted migration, hosted sign-in, and a real PostgreSQL E2E run are not claimed. Production sends and charges remain disabled.

See [Commercial journey](docs/COMMERCIAL_JOURNEY.md) for reconciliation, closing, recovery, idempotency, action, and activity rules.
