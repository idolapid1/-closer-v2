# Test report

Final status: **passed** on 2026-08-12.

The automated suite covers tenant isolation, active/closed NextAction behavior, customer-message updates, safe knowledge, missing-information collection, sensitive and low-confidence handoff, takeover/resume, consent, double booking, appointment deposits, quote acceptance/job creation, balances, completion versus collection, refunds, RevenueEvent idempotency, persistence/corruption fallback, demo reset, required routes, business switching, and assistant proposal rendering.

Run the complete gate with:

```bash
npm run verify
```

## Exact final results

- `npm run lint`: exit 0; ESLint reported no errors or warnings.
- `npm run typecheck`: exit 0; `tsc --noEmit` reported no errors.
- `npm run test`: exit 0; 8 test files passed, 34 tests passed.
- `npm run build`: exit 0; Vite 7.3.6 transformed 61 modules and produced `dist/index.html` plus CSS and JavaScript assets (largest asset 285.99 kB, 89.76 kB gzip).
- `npm run verify`: exit 0; lint, typecheck, 34 tests, and build all passed in sequence.
- `npm audit`: 0 known vulnerabilities in the locked 339-package dependency tree.

## Manual browser QA

- Loaded `/demo`, `/inbox`, `/customer/:id`, `/appointments`, `/quotes`, and `/debug` after a clean server restart.
- Switched among clinic, auto-detailing, and home-services tenants; cross-tenant customer routes failed closed.
- Completed an appointment flow: create → deposit → confirm → complete → collect balance; balance moved 420.00 → 315.00 → 0.00 and completion remained separate from cash collection.
- Completed a quote/job flow: draft → send → accept/create job → deposit → ready to schedule → schedule → complete → collect balance; balance moved 1,000.00 → 750.00 → 0.00.
- Verified manual takeover disables automation, explicit resume restores it, opt-out persists, and the UI blocks a marketing send.
- Verified a safe-hours inquiry displays a structured assistant proposal and updates the NextAction.
- Inspected booked, completed, collected-deposit, and collected-balance RevenueEvents with causation and correlation IDs.
- Browser console after the final restart and route pass: no warnings or errors.
