# Commercial journey

Phase 3 makes one active `Lead` the stable commercial opportunity connecting the customer, conversation, selected service, appointment or quote/job, payments, action, and activity history. It does not add a parallel CRM record. `CommercialOpportunityView` derives commercial truth on demand.

## Appointment service

Inquiry → structured qualification → validated appointment option → tentative appointment → deposit → confirmation → completion → remaining balance → collection → closed won.

The appointment total is validated from the configured fixed price or explicit input. Deposit collection is cash but not completion. Completion is delivery but not collection. A pending balance always creates the payment action.

## Quote and job

Inquiry → configured detail/photo/location collection → quote draft → sent quote → acceptance → one job → deposit → schedule → completion → remaining balance → collection → closed won.

Draft value is not cash. Quote acceptance is booked value and creates at most one job. Scheduling requires the configured deposit and a non-conflicting staff interval.

## Reconciliation

After every validated commercial mutation, `CommercialJourneyService` reads current domain state and derives:

- journey phase and open/won/lost status;
- appointment, quote, and job relationships;
- validated total, collected cash, and remaining balance;
- the single clearest action.

`CloserService` applies the projection to the lead/conversation references, replaces stale pending actions, and cancels incompatible follow-ups. The stage is context, not a generic workflow builder.

## Actions and closing

Typical actions are collect missing information, offer appointment, request deposit, confirm appointment, send/follow up quote, schedule job, show scheduled work, review a human handoff, or collect the remaining balance. The Action Center exposes these in plain language with real amounts only.

Closed won requires completed work and zero balance. Closed lost requires a typed reason and clears sales actions/follow-ups. Explicit reopening supports customer return. If a validated refund recreates a balance after closed won, the opportunity reopens, the conversation becomes active, and one remaining-payment action/follow-up is restored.

## Recovery and idempotency

Appointments and jobs support reschedule/cancel rules; quotes support decline/expire; Human Takeover blocks automated sends/follow-ups and Resume AI is explicit. Schema v3 preserves Phase 2 state through refresh/restart.

Provider message IDs, commercial operation keys, payment keys, RevenueEvent causation IDs, follow-up scenarios, and activity operation keys prevent duplicate side effects. Conflicting reuse fails. Activities are tenant scoped, ordered by occurrence, persisted, and contain only meaningful business events.

## Current limitations

This remains a deterministic local simulator. Payments, refunds, schedule changes, and follow-ups are manual records. There are no background timers, external calendar/payment checks, production identity/authorization, backend transactions, real WhatsApp delivery, or final UI.
