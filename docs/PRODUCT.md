# Product

The authoritative product direction is [CLOSER Product Bible](PRODUCT_BIBLE.md).

CLOSER is a **lead-to-cash autopilot for service businesses**. It takes every inquiry and continuously moves it toward the next best validated business action until the customer books or approves, receives the service, and pays.

The owner-facing product should answer what needs attention, what is happening today, which opportunities are stuck or ready to close, who owes money, and what CLOSER has already handled. Conversation is important evidence and context, but it does not define the product.

The product remains one configurable, multi-tenant system with two commercial journey families:

- `APPOINTMENT_SERVICE`: inquiry through appointment, completion, and collection;
- `QUOTE_JOB`: inquiry through quote, job, completion, and collection.

Clinic, auto-detailing/PPF, and home-services behavior must come from business and service configuration rather than separate applications. Auto detailing/PPF is the leading first-pilot candidate.

AI remains a constrained reasoning and recommendation layer. It may extract facts, answer verified knowledge, collect information, request validated tools, and hand off; it is not the system of record and cannot establish payment, price, booking, tenant ownership, or other commercial truth by assertion.

The verified Phase 1–4 domain, application, safety, persistence, and idempotency boundaries remain intact. Phase 4.1A changes product direction documentation only.

## Deliberate exclusions

No production integrations, owner-approved final visual design, backend, authentication, background worker, payment gateway, live AI, native mobile app, accounting suite, workflow builder, complex analytics, or marketing site is included.
