# CLOSER v2 — Phase 4.1B visual approval prototype

CLOSER is a **lead-to-cash autopilot for service businesses**: it moves every inquiry toward the next best validated action until the customer books or approves, completes the service, and pays. The authoritative direction is the [CLOSER Product Bible](docs/PRODUCT_BIBLE.md).

Phase 4.1B implements one representative Neo-Luxury **Today / Command Center** at `/actions`. It is a product-owner visual approval gate, not an approved design system. Inbox, Customer Workspace, engineering routes, and the verified Phase 1–3 engine remain intact and have not adopted this visual language.

This is an internal, local-only engineering build. It uses fictional data, deterministic mock AI and messaging providers, and versioned browser storage. It connects to no external API and contains no secrets.

## Requirements

- Node.js 22 LTS or 24 LTS (the verified build uses Node 24.19.0)
- npm 10 or newer

Node 26 is intentionally outside the current supported range: its experimental global Web Storage getter can shadow jsdom's `localStorage` in Vitest when no `--localstorage-file` is configured. Use a supported LTS runtime rather than changing the shared test setup.

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

## Owner approval prototype

- `/actions` — Neo-Luxury Command Center with operating state, human-prioritized decisions, Today, real balances, and tenant-scoped proof of prepared automation work

The open-source `MaskedHeading` and `MoltenMetal` implementations supplied for this milestone are adapted locally with TypeScript, Hebrew/RTL handling, reduced-motion fallbacks, WebGL lifecycle cleanup, and a deliberate mobile GPU budget. `gsap` and `ogl` are the only added runtime dependencies. No React Bits Pro code, registry, license key, or MCP is used.

## Preserved Phase 4 routes

- `/inbox` — existing split-view business inbox
- `/customer/:id` — existing unified customer workspace

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
