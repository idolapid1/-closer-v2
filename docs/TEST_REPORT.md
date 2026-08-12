# Phase 2 test report

Status: **passed** on 2026-08-13.

The suite covers all Phase 1 invariants plus structured decisions, knowledge grounding, vertical qualification, stage inference, customer memory/corrections/conflicts, formal tools, autonomy boundaries, handoff metadata, deterministic follow-ups, duplicate message delivery, schema migration, simulator behavior, malicious-provider output, prompt injection, cross-tenant requests, false payment claims, and unsupported booking.

Run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify
npm audit
```

## Exact automated result

- `npm run lint`: exit 0; no ESLint errors or warnings.
- `npm run typecheck`: exit 0; strict `tsc --noEmit` reported no errors.
- `npm run test`: exit 0; 9 test files and 78 tests passed.
- `npm run build`: exit 0; Vite 7.3.6 transformed 69 modules and emitted `dist/index.html`, 3.80 kB CSS (1.32 kB gzip), and 345.56 kB JavaScript (105.70 kB gzip).
- `npm run verify`: exit 0; lint, strict TypeScript, all 78 tests, and the production build passed in sequence.
- `npm audit`: exit 0; found 0 vulnerabilities.

## Manual browser QA

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
