# Financial rules

All amounts are non-negative safe integers in minor currency units (cents). The model deliberately distinguishes:

- `POTENTIAL` — possible value, not cash
- `BOOKED` — accepted appointment/job, not delivered
- `COMPLETED` — delivered, not necessarily paid
- `COLLECTED` — valid cash received
- `REFUNDED` — cash returned

Remaining balance is:

`total - valid collected deposits/balances + valid refunds`

Payments have an idempotency key. Repeating the same payment returns the original; reusing a key for different facts fails. Refunds reference an original non-refund payment and cannot exceed it across all refunds.

Every financial transition creates a RevenueEvent with `causationId` and `correlationId`. A causation ID may produce one event only; conflicting reuse fails. Deposit collection never marks delivery complete. Completion never creates collected cash. A fully paid opportunity closes only after the appointment or job is completed.

Assistant payment answers are rebuilt from validated appointment/job and Payment records. A customer message claiming payment cannot create or alter a Payment. Tax is optional per business and calculated after discount. Phase 2 records payments manually and does not process cards, invoice, reconcile a bank, or perform accounting.
