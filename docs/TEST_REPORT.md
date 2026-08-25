# Production Activation v1 test report

Status: the complete local quality gate passed on 2026-08-25 using the supported bundled Node 24.19.0 runtime. `src/test/setup.ts` remains unchanged; the test command disables Node's experimental global Web Storage so jsdom owns browser `localStorage`.

Client/jsdom and server/Node tests now use separate Vitest configurations. This preserves the browser setup exactly as before and prevents a Node test from pretending a browser global exists.

Production Activation adds an opt-in PostgreSQL integration configuration. The default suite never guesses a database URL; `npm run test:postgres` requires an explicit, dedicated `TEST_DATABASE_URL` and refuses to reuse `DATABASE_URL` implicitly.

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
- explicit DEMO/PRODUCTION browser configuration with no production-to-demo fallback;
- Supabase-compatible session restore, sign-in/sign-up, sign-out, expiry, one-shot refresh, and duplicate-expiry handling;
- server-authorized tenant onboarding, active-tenant selection, removed-membership handling, and stale-response rejection;
- production Today and Customer Workspace read models, Human Takeover priority, durable follow-up creation, and verified money rendering;
- hashed, expiring, email-bound, revocable, single-use invitations with development-only raw-token delivery;
- liveness/readiness separation, safe dependency errors, distributed rate-limiter interface, and explicit worker lifecycle;
- checksummed `0002` migration plus real-schema verification for critical tables, indexes, RLS policies, and worker claim function;
- an isolated real-PostgreSQL suite that applies migrations twice and verifies persistence across API restart when `TEST_DATABASE_URL` is supplied.

Latest automated result: **25 test files and 208 tests passed**: 169 browser/domain/application tests and 39 server/auth/security tests. ESLint passed with zero warnings, both strict TypeScript projects passed, the demo client and server builds passed, the separately configured production client and server build passed, `npm run verify` passed, and the fresh npm audit reported 0 vulnerabilities.

## Rendered QA

The existing owner experience was regression-checked again in the in-app Chromium browser at 1440×1024 and 393×852. Direct navigation covered Today, Customers, Human Takeover Customer Workspace, and active Human Takeover Conversation. The pass confirmed RTL, working mobile navigation, fixed safe-area navigation, customer/conversation route continuity, zero horizontal overflow, and an empty warning/error console. The broader Phase 4 visual pass remains recorded below:

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

The authenticated production build transforms 1,987 modules and emits:

- `dist/index.html` 0.60 kB (0.39 kB gzip)
- main CSS 103.46 kB (19.20 kB gzip)
- main JavaScript 460.22 kB (137.16 kB gzip)
- lazy Today JavaScript 136.73 kB (48.07 kB gzip)
- lazy Today CSS 1.94 kB (0.83 kB gzip)
- lazy Production App JavaScript 255.19 kB (67.35 kB gzip)
- liquid-metal material 297.41 kB

The main JavaScript chunk remains below Vite’s 500 kB advisory. Supabase/Auth and production pages stay in the lazy Production App chunk; GSAP/OGL and the ambient identity stay in the lazy Today chunk.

The server build also emits strict ESM JavaScript and declarations under ignored `dist-server/server/`; both source migrations remain under `server/migrations/`. This environment supplied no Supabase credentials, `TEST_DATABASE_URL`, Docker, or `psql`, so hosted migration, real Auth, the real-PostgreSQL integration suite, and authenticated reload against Supabase are not claimed.
