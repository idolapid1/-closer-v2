# HVAC revenue recovery

## Purpose

CLOSER's first production wedge is HVAC revenue recovery. It helps an owner answer: which legitimate customer opportunities are at risk, what should happen next, and how much validated revenue did CLOSER actually help recover?

The implementation extends the existing multi-tenant lead-to-cash platform. It does not create a separate HVAC app or replace Customer, Lead, Conversation, Follow-up, Booking, Payment, RevenueEvent, consent, Human Takeover, or the Fastify/PostgreSQL trust boundary.

## Commercial model

Customer is the durable identity. Lead records acquisition/source context. Opportunity represents one repair, replacement, maintenance, installation, indoor-air-quality, duct, or commercial-service need. A returning customer can have a new Opportunity without duplicating the Customer.

Opportunity stores source, type, independently explainable scores, lifecycle status, recovery state, autonomy policy, assignment, activity timestamps, one next-action time, validated booking/estimate/job links, and conservative attribution. Opportunity detail combines recovery decisions and append-only revenue evidence.

## Recovery loop

1. Observe only tenant-scoped database truth.
2. Score intent, revenue, recovery, and urgency independently.
3. Select one bounded play or suppression reason.
4. Produce one next best action, expiry, and approval requirement.
5. Persist the immutable decision and the separate action lifecycle idempotently.
6. Prepare only what the autonomy policy permits; never imply a live send.
7. Reconcile verified customer response, booking, handoff, payment, or refund evidence into the same Opportunity.

The four policies are missed-call recovery, new-lead recovery, unsold-estimate recovery, and old-lead reactivation. Recovery evaluation never sends a live message. Connector delivery, autonomous AI replies, payment charging, and live follow-up remain disabled.

## Safety and autonomy

`OBSERVE` records context, `SUGGEST` persists a proposal without making it send-ready, `APPROVE_TO_SEND` requires explicit owner approval, and `AUTOPILOT` may only prepare a safe action when policy permits it. High-value work and booking commitments still require approval. In the current build no production connector is authorized, so even a policy-eligible decision remains `PREPARED_ONLY`/`LIVE_DISABLED` and cannot deliver externally.

Recovery actions use explicit `PENDING`, `READY`, `WAITING_APPROVAL`, `EXECUTING`, `COMPLETED`, `WAITING_CUSTOMER`, `HUMAN_REQUIRED`, `CANCELLED`, `FAILED`, and `SUPPRESSED` states. Each action is tenant-scoped, linked to one decision, protected by an operation key, time-bounded where relevant, and records actor/approval/execution timestamps without storing model chain-of-thought.

Consent, do-not-contact, explicit rejection, Human Takeover, active recovery, contact hours, closed status, and attempt limits override a play. A customer response cancels stale recovery actions and follow-ups before the Opportunity is recalculated. Human Takeover is a commercial state: the Opportunity becomes `HUMAN_REQUIRED`, scheduled, failed, or leased follow-ups stop, prepared recovery actions are cancelled, and only explicit Resume AI returns it to evaluation. Resume also retires the persisted human-required action so the next evaluation cannot reuse stale handoff state; opt-out retires it as part of the explicit stop.

## Revenue truth

- Estimated value contributes to revenue at risk, never cash.
- A validated booking records booked value, never cash. It is `BOOKING_RECOVERED` only when a completed/waiting-customer recovery action is material evidence; a prepared-only action is `ASSISTED`, and no meaningful CLOSER action is `ORGANIC`/`BOOKING_CREATED`.
- Collected revenue requires a validated Payment and a unique causation key.
- Refund events subtract from Opportunity and command-center recovered totals.
- `GENERATED`, `RECOVERED`, `ASSISTED`, and `ORGANIC` are conservative classifications with an evidence reason; they are not model confidence.

## Owner surfaces

Revenue Command Center shows actual recovered revenue, potential value currently in recovery, influenced collected revenue, revenue at risk, recovered bookings/jobs, and human-required opportunities. These values are server aggregates over persisted Opportunity and ledger truth. Opportunities provides a bounded paginated list with search/filtering. Opportunity Detail explains the four scores, source/activity timestamps, current persisted action, approval/delivery state, customer and conversation context, linked booking/estimate/job, recovery history, attribution evidence, and chronological revenue events. Recovery Plays shows the four bounded policy groups. Customers and Inbox remain context surfaces rather than competing CRM pipelines.

## Known limits

This is a deterministic recovery foundation, not a live HVAC pilot. It does not yet include a provider-specific missed-call webhook, SMS/email delivery, estimate-authoring API, dispatch/calendar integration, payment processor, production LLM, automated campaign execution, or hosted Supabase proof in this checkout. Those require real staging credentials, provider contracts, policy decisions, and separately authorized activation.
