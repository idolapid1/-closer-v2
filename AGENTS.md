# CLOSER v2 engineering guidance

## Product invariants

- Keep CLOSER action-first and WhatsApp-first.
- Every active opportunity has exactly one current pending NextAction.
- Reconcile opportunity phase and action after every validated commercial mutation; derive totals and balances from appointments/quotes/jobs/payments.
- Keep potential, booked, completed, collected, and refunded financially distinct.
- Scope knowledge, memory, context, and every repository operation by `businessId`.
- Human Takeover disables customer-facing automation and follow-ups until explicit Resume AI.
- Consent independently controls operational and marketing communication.

## Assistant trust boundary

- Treat every AI-provider decision as untrusted input.
- Providers receive tenant-scoped context and never receive repositories or mutation callbacks.
- Only `CloserService` and focused application services may validate and execute tools.
- Auto-sent text must be rebuilt from validated knowledge or domain/tool results.
- Level 3 actions are proposals. Validate tenant, state, required fields, idempotency, financial rules, and scheduling before execution.
- Unknown prices, policies, slots, payment claims, conflicting facts, low confidence, sensitive topics, and permission mismatches fail closed or hand off.
- Do not persist unrestricted free-form memory; use normalized `CustomerMemoryItem` facts with source metadata.

## Commercial journey boundary

- Keep `Lead` as the commercial opportunity; do not introduce a competing CRM record.
- Use service `workflowType` to select appointment versus quote/job behavior; never branch on business name.
- `CommercialJourneyService` is read/decision logic. `CloserService` validates and applies mutations.
- A completed appointment/job closes won only when its remaining balance is zero.
- A valid refund that creates a balance reopens the won opportunity and restores a payment action/follow-up.
- Business event operation keys, provider message IDs, payment keys, and revenue causation IDs must remain idempotent.

## Change workflow

1. Add or update a regression/scenario test for every changed invariant.
2. Keep business rules out of React and direct persistence out of UI/providers.
3. Run `npm run verify` and `npm audit` before committing.
4. Perform an adversarial review when assistant permissions, knowledge, memory, consent, follow-up, payments, or scheduling change.
5. Update the relevant concise document under `docs/`.

Prefer focused application services over expanding `CloserService` or creating generic frameworks. Avoid dashboards, generic CRM abstractions, workflow builders, production integrations, and terminology a service-business owner should not need.
