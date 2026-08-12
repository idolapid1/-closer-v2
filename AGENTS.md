# CLOSER v2 engineering guidance

## Product boundary

- Keep CLOSER action-first and WhatsApp-first.
- Every active opportunity has exactly one current pending NextAction.
- Keep financial stages distinct: potential, booked, completed, collected, refunded.
- Keep business knowledge and all repository access scoped by `businessId`.
- Never put domain rules or direct persistence access in React components.
- AI providers propose structured decisions; only application use cases may mutate state.
- Human takeover always disables automated sends until explicit resume.
- Do not connect external providers or add secrets without a separately approved phase.

## Change workflow

1. Add or update a domain/application regression test for every changed invariant.
2. Keep repository access tenant scoped.
3. Run `npm run verify` before committing.
4. Update the relevant concise document under `docs/` when behavior changes.

Prefer small use cases over screens. Avoid dashboards, generic CRM abstractions, and business terminology that a service-business owner should not need to learn.
