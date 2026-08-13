# CLOSER v2 — Phase 3

CLOSER is a revenue and customer-conversation operating system for service businesses. Phase 3 joins the verified conversation, appointment, quote/job, payment, and action components into complete inquiry-to-collection commercial journeys.

This is an internal, local-only engineering build. It uses fictional data, deterministic mock AI and messaging providers, and versioned browser storage. It connects to no external API and contains no secrets.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. Open `/actions` to see what a business needs to do now, `/customer/:id` for the internal customer workspace, or `/debug` for the Conversation Simulator. Use the business selector to switch among Luma Aesthetics, Northstar Auto Detail, and BrightHome Services.

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

## Internal routes

- `/demo` — tenant summary, scenario contacts, and current actions
- `/inbox` — WhatsApp-first conversations and the one action needing attention
- `/actions` — plain-language Action Center for every active opportunity
- `/customer/:id` — conversation, opportunity, structured facts, work, payments, action, handoff, and activity timeline
- `/appointments` — appointment, deposit, confirmation, completion, and balance controls
- `/quotes` — quote/job, deposit, scheduling, completion, and balance controls
- `/debug` — Conversation Simulator, tool results, memory, follow-ups, handoffs, financial events, raw tenant state, and reset

## Architecture and trust boundary

Domain entities and rules are pure TypeScript. `CloserService` is the mutation boundary. `CommercialJourneyService` derives opportunity totals, collection, stage, relationships, and one action from domain truth; `ActivityTimelineService` records tenant-scoped idempotent business events. Focused conversation services retain the Phase 2 trust boundary.

The AI provider is untrusted and has no repository, network, clock, or mutation access. The application reconstructs auto-sent Level 1/2 replies from validated knowledge/tool results. Appointment, quote, deposit, payment, and scheduling changes are proposals until the existing application use cases validate them. React never accesses `localStorage` or implements business rules.

See [Architecture](docs/ARCHITECTURE.md), [Conversation Engine](docs/CONVERSATION_ENGINE.md), [Assistant Safety](docs/ASSISTANT_SAFETY.md), [Assistant Tools](docs/ASSISTANT_TOOLS.md), and [Financial Rules](docs/FINANCIAL_RULES.md).

## Local data

Schema v3 is stored under `closer-v2:database` in `localStorage`. Valid Phase 1 and Phase 2 schemas are migrated with safe commercial defaults; invalid or corrupt data falls back to the deterministic seed. Use **Debug → Reset scenarios** to restore all three tenants. No real customer data is included.

## Remote backup

Local Git is not a backup. This repository already tracks `origin/main`; confirm it after each verified phase:

```bash
git remote -v
git status --short --branch
git push
```

Never commit `.env` files, credentials, tokens, customer exports, or production data.

## Deliberate exclusions

Phase 3 does not include production AI, real WhatsApp/Meta/Instagram, a backend, authentication, background workers, calendar/payment integrations, deployment, or final product design. Follow-ups are inspectable scheduled records, not timers. Payments and refunds are validated manual records, not gateway transactions.

See [Commercial journey](docs/COMMERCIAL_JOURNEY.md) for reconciliation, closing, recovery, idempotency, action, and activity rules.
