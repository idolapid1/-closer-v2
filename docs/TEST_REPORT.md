# Phase 4 test report

Status: **passed** on 2026-08-13.

Phase 4 preserves the full Phase 1–3 domain/application suite and adds production-presentation coverage for Today, Inbox, Customer Workspace, tenant switching, navigation, accessible region/link names, empty states, Human Takeover, independent consent flags, closed opportunities, payment truth, and the `ProductReadService` boundary.

## Exact automated result

- `npm run lint`: exit 0; ESLint reported no errors or warnings.
- `npm run typecheck`: exit 0; strict `tsc --noEmit` reported no errors.
- `npm run test`: exit 0; **11 test files and 108 tests passed**.
- `npm run build`: exit 0; Vite 7.3.6 transformed 1,854 modules and emitted `dist/index.html` 0.60 kB (0.39 kB gzip), CSS 31.53 kB (6.50 kB gzip), and JavaScript 412.52 kB (124.28 kB gzip).
- `npm run verify`: exit 0; lint, strict TypeScript, all 108 tests, and the production build passed.
- `npm audit`: exit 0; found 0 vulnerabilities.

## Presentation regressions covered

- Today regions resolve to visible headings and repeated actions have customer-specific accessible names.
- A fully empty Today composition renders calm attention, commitment, and payment empty states.
- Inbox uses native list/button semantics and keeps explicit Human Takeover/Resume behavior.
- Operational and marketing consent remain independent and fail closed when no record exists.
- PAUSED automation is stopped without being mislabeled as Human Takeover.
- Customer work selects the active/latest opportunity and its exact conversation.
- Payment/refund metadata is limited to collected payments on the current commercial reference.
- A scheduled appointment can provide the displayed service when an earlier lead had not yet stored it.
- A broken active lead/contact relationship remains an explicit integrity failure rather than silently disappearing.

## Browser and visual QA

- Reviewed Today, Inbox list, active conversation, and Customer Workspace at 1440×1024, 1100×760, 393×852, and 375×812.
- Reviewed clinic, auto-detailing, and home-services tenants; multiple actions; per-section and full empty-state rendering; Human Takeover; assistant-active; quote waiting; scheduled appointment; outstanding balances; and fully paid/closed-won states.
- Checked long Hebrew, mixed Hebrew/English, phone/email direction, times, currency, 1,200/900 ILS amounts, responsive wrapping, mobile composer/nav behavior, and customer-specific control names.
- Keyboard route focus, Inbox focus restoration, search focus visibility, touch targets, dynamic viewport sizing, and horizontal overflow were inspected.
- `/debug` retained decision, tool, schema, financial, and scenario information.
- Browser console warnings/errors: none.

The side-by-side visual review and resolved findings are recorded in [`design-qa.md`](../design-qa.md); its final result is `passed`.
