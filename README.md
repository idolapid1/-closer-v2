# CLOSER v2 — Phase 1

CLOSER is a revenue and customer-conversation operating system for service businesses. This repository contains the Phase 1 foundation and one end-to-end path from inquiry to payment for appointment businesses and quote/job businesses.

This is an internal, local-only demo. It uses deterministic mock AI and messaging providers, fictional data, and versioned browser storage. It connects to no external API and contains no secrets.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. Open `/demo` and use the business selector to move among Luma Aesthetics, Northstar Auto Detail, and BrightHome Services.

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify
```

`npm run verify` runs lint, strict TypeScript checking, the full Vitest suite, and the production build in sequence.

## Internal routes

- `/demo` — tenant summary, scenario contacts, and current actions
- `/inbox` — conversation list ordered by customer activity
- `/customer/:id` — messages, assistant proposal, human control, and consent
- `/appointments` — appointment creation, deposit, confirmation, completion, and balance
- `/quotes` — quote creation/acceptance, job state, deposit, completion, and balance
- `/debug` — tenant-scoped raw data, RevenueEvents, and demo reset

## Architecture

Domain entities and rules are pure TypeScript. `CloserService` is the application boundary that validates use cases and is the only layer allowed to coordinate mutations. Repositories are tenant scoped; browser persistence sits behind `DatabasePort` and `StoragePort`. AI and messaging are ports with deterministic mocks. React reads state through `CloserProvider` and never accesses `localStorage` or implements business rules.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DOMAIN_RULES.md](docs/DOMAIN_RULES.md), and [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md).

## Local data

The schema is stored under `closer-v2:database` in `localStorage`, validated on load, and reset to a deterministic seed if corrupt. Use **Debug → Reset demo data** to restore all three businesses. No real customer data is included.

## Back up to a remote

Local Git is not a backup. After creating an empty private repository with your chosen provider, add and push it explicitly:

```bash
git remote add origin <your-private-repository-url>
git push -u origin main
```

Confirm the remote first with `git remote -v`. Never commit `.env` files, credentials, tokens, customer exports, or production data. This project intentionally does not create a remote repository automatically.

## Scope boundary

Phase 1 does not include a polished UI, real WhatsApp/Meta/Instagram, a calendar or payment gateway, production AI, analytics dashboards, accounting, inventory, permissions, mobile apps, or deployment. Those integrations should replace ports without changing domain rules.
