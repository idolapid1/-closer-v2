# Production Foundation v1 test report

Status: the complete local quality gate passed on 2026-08-25 using the supported bundled Node 24.19.0 runtime. `src/test/setup.ts` remains unchanged; the test command disables Node's experimental global Web Storage so jsdom owns browser `localStorage`.

Client/jsdom and server/Node tests now use separate Vitest configurations. This preserves the browser setup exactly as before and prevents a Node test from pretending a browser global exists.

## Automated coverage

The suite preserves all Phase 1–3 domain/application scenarios and adds owner-experience regressions for:

- direct Today, Customers, Customer Workspace, Inbox, Work, Money, and More routes;
- real menu navigation and active navigation state;
- Customers → Human Takeover workspace → Conversation;
- return from Customer Workspace to Customers;
- customer-specific Today/action links and real balance links;
- ordinary Inbox list/button semantics and explicit Resume behavior;
- DOM-based mixed Hebrew/English MaskedHeading order without SVG text;
- static fallback and reduced-motion shader behavior;
- tenant-scoped Customers, Schedule, and Money read models;
- Human Takeover priority and validated remaining-balance projection;
- shared appointment and quote/job schedule contracts.
- validated collected, collection-due, and open-value revenue projections;
- explicit unavailable CLOSER-generated/recovered attribution;
- declined quotes excluded from money due now;
- tenant switching away from stale customer/conversation routes;
- visible Human Takeover resume and composer sending/disabled states.
- persisted Lead source, external source identity, priority, and typed objections;
- configurable follow-up cadence, attempt/result history, stop reasons, and attempt idempotency;
- Human Takeover reason/context and human-only internal reply draft behavior;
- evidence-validated revenue attribution, cross-context rejection, immutability, and refund netting;
- consent-safe reactivation eligibility, owner approval, cadence, and duplicate prevention;
- tenant-authorized Owner Copilot reads, approval-gated mutation, and idempotent audit activity;
- deterministic WhatsApp, Instagram, form, and email ingestion with tenant mismatch and repeat-delivery regressions;
- v1–v4 to schema-v5 migration, including unattributed revenue defaults.
- real JWT signature/issuer/audience/subject verification;
- unauthenticated calls, membership lookup, owner/admin/member permissions, and cross-tenant ID guessing;
- idempotent User → Tenant provisioning and multi-membership support;
- tenant-scoped customer, conversation, revenue, follow-up, connector, and Copilot boundaries;
- complete authenticated journey → follow-up → booking → payment → revenue creation;
- payment/reference validation, refund attribution/netting, and duplicate-event protection;
- exact-raw-body webhook signatures, duplicate delivery, and changed-payload replay rejection;
- concurrent follow-up worker leasing with one deterministic send;
- typed production API client authentication and explicit demo/production modes;
- source-controlled migration coverage for durable tables, `SKIP LOCKED`, and RLS.

Latest automated result: **19 test files and 182 tests passed**: 155 browser/domain/application tests and 27 server/auth/security tests. ESLint passed with zero warnings, both strict TypeScript projects passed, the client and server production builds passed, `npm run verify` passed, and the fresh npm audit reported 0 vulnerabilities.

## Rendered QA

Actual in-app Chromium renders were re-inspected at 1440×1024, 1100×760, 393×852, and 375×812. Direct route loads covered Today, Customers, Human Takeover Customer Workspace, active Human Takeover Conversation, Calendar/Jobs, Money, and More. The pass also covered:

- Today first decision, action density, Human Takeover priority, and WebGL identity;
- Customers for clinic, auto-detailing, and home-services tenants;
- Customer Workspace at the top and lower scroll positions;
- Human Takeover, outstanding balance, and a validated fully-paid/closed-won state;
- desktop and mobile Conversation context;
- Work empty/today/recent job/appointment states;
- Money balances and mixed currency direction;
- More business/team/automation/payment context;
- browser back/forward, direct routes, and tenant switching;
- fixed bottom navigation, dynamic viewport height, and horizontal overflow.

Confirmed fixes included the light legacy island, 1100px top-bar crowding, mobile business-selector weight, hidden mobile Customer Workspace link, all-seven-step journey visibility, compact empty states, and duplicate-looking inert More affordances.

The live Today render reported one WebGL canvas with `data-renderer="webgl"`; non-Today routes do not import the shader. Automated reduced-motion coverage verifies the static no-canvas fallback. Every inspected page reported `scrollWidth === innerWidth`.

Fresh page loads showed no Vite error overlay; the in-app browser console returned zero warning/error entries after the final owner-route pass. Native Safari and physical-iPhone GPU/thermal profiling were not available, so those are not claimed. Chrome DevTools performance tracing was not configured; bundle/chunk output and responsive interaction were reviewed instead of synthetic Core Web Vitals.

## Production build

Vite 7.3.6 transforms 1,935 modules. The owner application emits:

- `dist/index.html` 0.60 kB (0.39 kB gzip)
- main CSS 95.05 kB (17.84 kB gzip)
- main JavaScript 458.01 kB (136.02 kB gzip)
- lazy Today JavaScript 136.73 kB (48.07 kB gzip)
- lazy Today CSS 1.94 kB (0.83 kB gzip)
- liquid-metal material 297.41 kB

The main JavaScript chunk is below Vite’s 500 kB advisory. GSAP/OGL and the ambient identity stay in the lazy Today chunk.

The server build also emits strict ESM JavaScript and declarations under ignored `dist-server/server/`; the source migration remains under `server/migrations/`. Docker/`psql` were unavailable in this environment, so migration application against a live PostgreSQL 16 instance is not claimed.
