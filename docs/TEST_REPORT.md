# Phase 3 test report

Status: **passed** on 2026-08-13.

The suite preserves all Phase 1/2 coverage and adds complete appointment, auto-detailing, and home-service journeys; milestone actions; deposits/balances; closed won/lost; decline/cancel/reschedule/return; Human Takeover/Resume AI mid-journey; schema v3 migration and restore; tenant-safe projections/timelines; duplicate commercial operations; refund reopening; payment/reference ownership; scheduling conflicts; and activity ordering/idempotency.

Run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify
npm audit
```

## Current automated result

Final exact command outputs, asset sizes, and browser QA are recorded after final verification below.

## Phase 2 browser baseline

- Loaded `/demo`, `/inbox`, `/customer/:id`, `/appointments`, `/quotes`, and `/debug`.
- Beauty: configured price → missing date → validated appointment options.
- Auto detailing: service details → vehicle facts → photo request → quote-ready.
- Home services: generic job → refined leak/location/urgency/photos → quote-ready; this caught and fixed a memory-refinement regression.
- Sensitive clinic question → Human Takeover; a customer message during takeover produced no outgoing assistant message; explicit Resume AI restored automation.
- Opt-out persisted; business switching changed tenant/customer/service state.
- Appointment: balance 420 → 315 after deposit → remained 315 at completion → 0 after collection.
- Quote/job: draft → sent → accepted/job → deposit → scheduled → completed with balance unchanged → collected to 0.
- Quote follow-up and completed-work outstanding-balance follow-up/action were visible in `/debug`.
- A closed-lost conversation showed no follow-up and no immediate action.
- Browser console warnings/errors: none.

## Phase 3 exact automated result

- `npm run lint`: exit 0; no ESLint errors or warnings.
- `npm run typecheck`: exit 0; strict `tsc --noEmit` reported no errors.
- `npm run test`: exit 0; 10 test files and 92 tests passed.
- `npm run build`: exit 0; Vite 7.3.6 transformed 72 modules and emitted `dist/index.html`, 3.88 kB CSS (1.34 kB gzip), and 372.24 kB JavaScript (111.74 kB gzip).
- `npm run verify`: exit 0; lint, strict TypeScript, all 92 tests, and production build passed.
- `npm audit`: exit 0; found 0 vulnerabilities.

## Phase 3 manual browser QA

- Loaded `/demo`, `/inbox`, `/actions`, `/customer/:id`, `/appointments`, `/quotes`, and `/debug`.
- Clinic: tentative appointment → deposit → confirmation → completion with ₪315 remaining → collection → ₪0/closed won.
- Refund after won: ₪105 refund restored AI-active awaiting-payment state, one collect-balance action, follow-up, refund/reopen activities, and ₪105 balance.
- Auto detailing: draft → send → accept/job → deposit → schedule → completion with ₪750 remaining → collection → ₪0/closed won.
- Home service: draft → send → accept/job → deposit → schedule → completion with ₪750 remaining → collection → ₪0/closed won.
- Appointment cancellation and quote decline closed lost and cleared stale work; explicit customer return reopened the same opportunity and persisted through reload.
- Human Takeover showed human-active/human-review state; explicit Resume AI restored AI-active mode.
- Business switching preserved tenant-specific state; Action Center and customer workspace showed derived actions, amounts, facts, work, payments, and ordered activity.
- Browser console warnings/errors: none.

## Adversarial review

Confirmed and fixed: customer/reference ownership for payments and refunds; full payment-key fact comparison; wrong original-payment refund rejection; refund-after-won reconciliation; malformed/conflicting job schedules; explicit job reschedule; closed-opportunity mutation rejection; service/journey mismatch; duplicate appointment/quote/job/payment/revenue/activity/follow-up side effects; and deterministic newest-entity selection when timestamps match. Existing assistant prompt-injection, cross-tenant, false-payment, forced-booking, Human Takeover, consent, and duplicate inbound-message protections remain covered.
