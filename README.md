# CLOSER v2 — Phase 4.1A

CLOSER is a **lead-to-cash autopilot for service businesses**: it moves every inquiry toward the next best validated action until the customer books or approves, completes the service, and pays. The authoritative direction is the [CLOSER Product Bible](docs/PRODUCT_BIBLE.md).

Phase 4.1A resets product hierarchy and future experience direction in documentation only. The verified Phase 4 Hebrew-first Today, Inbox, and Customer Workspace implementation remains intact as a technical baseline, but its visual language is not the owner-approved final production direction.

This is an internal, local-only engineering build. It uses fictional data, deterministic mock AI and messaging providers, and versioned browser storage. It connects to no external API and contains no secrets.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. The default route opens **Today** at `/actions`; use `/inbox` for customer inquiries and `/customer/:id` for the unified Customer Workspace. `/debug` preserves the Conversation Simulator. The business selector switches among the three deterministic clinic, detailing, and home-services tenants.

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify
npm audit
```

`npm run verify` runs lint, strict TypeScript checking, all Vitest tests, and the production build in sequence.

## Implemented Phase 4 routes

- `/actions` — Hebrew-first Today view: attention, today’s commitments, and real outstanding balances
- `/inbox` — split-view business inbox with contextual recommendation and explicit Human Takeover state
- `/customer/:id` — unified customer, work, payment, facts, conversation, consent, and activity workspace

## Engineering routes

- `/demo` — tenant summary, scenario contacts, and current actions
- `/appointments` — appointment, deposit, confirmation, completion, and balance controls
- `/quotes` — quote/job, deposit, scheduling, completion, and balance controls
- `/debug` — Conversation Simulator, tool results, memory, follow-ups, handoffs, financial events, raw tenant state, and reset

## Architecture and trust boundary

Domain entities and rules are pure TypeScript. `CloserService` is the mutation boundary. `CommercialJourneyService` derives opportunity totals, collection, stage, relationships, and one action from domain truth; `ActivityTimelineService` records tenant-scoped idempotent business events. `ProductReadService` builds tenant-scoped presentation models for the three production screens, while `productCopy` translates internal states into plain Hebrew. Focused conversation services retain the Phase 2 trust boundary.

The AI provider is untrusted and has no repository, network, clock, or mutation access. The application reconstructs auto-sent Level 1/2 replies from validated knowledge/tool results. Appointment, quote, deposit, payment, and scheduling changes are proposals until the existing application use cases validate them. React never accesses `localStorage` or implements business rules.

See [Product Bible](docs/PRODUCT_BIBLE.md), [Architecture](docs/ARCHITECTURE.md), [Product UX history](docs/PRODUCT_UX.md), [Phase 4 design-system history](docs/DESIGN_SYSTEM.md), [Conversation Engine](docs/CONVERSATION_ENGINE.md), [Assistant Safety](docs/ASSISTANT_SAFETY.md), [Assistant Tools](docs/ASSISTANT_TOOLS.md), and [Financial Rules](docs/FINANCIAL_RULES.md).

## Local data

Schema v3 is stored under `closer-v2:database` in `localStorage`. Valid Phase 1 and Phase 2 schemas are migrated with safe commercial defaults; invalid or corrupt data falls back to the deterministic seed. Use **Debug → Reset demo data** to restore all three tenants. No real customer data is included.

## Remote backup

Local Git is not a backup. This repository already tracks `origin/main`; confirm it after each verified phase:

```bash
git remote -v
git status --short --branch
git push
```

Never commit `.env` files, credentials, tokens, customer exports, or production data.

## Deliberate exclusions

The current build does not include production AI, real WhatsApp/Meta/Instagram, a backend, authentication, background workers, calendar/payment integrations, deployment, or redesigns for the engineering appointment, quote/job, and debug modules. Follow-ups are inspectable scheduled records, not timers. Payments and refunds are validated manual records, not gateway transactions.

See [Commercial journey](docs/COMMERCIAL_JOURNEY.md) for reconciliation, closing, recovery, idempotency, action, and activity rules.
