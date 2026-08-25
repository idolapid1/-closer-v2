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

Every financial transition creates a RevenueEvent with `causationId`, `correlationId`, Lead, Conversation, customer, and lead-source context. A causation ID may produce one event only; conflicting reuse fails. Deposit collection never marks delivery complete. Completion never creates collected cash. A fully paid opportunity closes only after the appointment or job is completed. A valid refund after close may make the balance positive again; reconciliation then reopens the opportunity and restores an outstanding-payment action/follow-up.

Payments must match the tenant, customer, reference type, and reference ID. Refunds must additionally match the original collected payment and may not exceed its unrefunded value. Idempotency compares all meaningful payment facts, including the original payment reference.

Assistant payment answers are rebuilt from validated appointment/job and Payment records. A customer message claiming payment cannot create or alter a Payment. Tax is optional per business and calculated after discount. Phase 3 records payments/refunds manually and does not process cards, invoice, reconcile a bank, or perform accounting.

Owner revenue projections use three distinct values:

- validated collected: collected deposits/balances minus collected refunds;
- collection due now: only an unpaid required deposit or the remaining balance after completed work;
- known open value: the validated total of open opportunities, which remains pipeline rather than cash.

A draft, sent, rejected, or lost quote is not money due. `RevenueAttributionService` accepts only `COLLECTED` events and requires tenant-matched, customer-matched, conversation-matched activities that occurred no later than the revenue event. A verified event is immutable and operation-key idempotent. Generated/recovered values are `null` until at least one event is verified; valid refunds are netted from the verified originating payment. No presentation layer estimates attribution.
