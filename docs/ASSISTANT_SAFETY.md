# Assistant safety

## Trust model

The provider is untrusted. It receives a tenant-scoped `AssistantContext` and returns a proposal. It cannot access repositories, messaging, payment, scheduling, or mutation functions. `AssistantDecisionPolicy` validates every proposal and rebuilds auto-sendable text from validated tool results.

## Autonomy

- Level 1: approved knowledge/domain facts; may auto-send after grounding.
- Level 2: configured non-sensitive information requests; may auto-send after grounding.
- Level 3: slot, appointment, quote, deposit, and NextAction proposals; no customer auto-send and no business mutation.
- Level 4: human handoff; no assistant send.

Tool/autonomy mismatches fail closed. Low confidence, missing/unsupported knowledge, medical/sensitive/legal/safety questions, complaints, refunds, unusual discounts, aggression/confusion, human requests, conflicting facts, unverified payment claims, cross-customer/business requests, and prompt-injection attempts hand off.

## Claims the assistant cannot make

The assistant cannot invent prices, discounts, policies, service areas, availability, guarantees, booking/payment status, medical advice, or another tenant/customer’s information. Availability comes from rules plus conflict checks. Payment status comes from valid Payment records. Customer claims never become financial truth.

## Control and idempotency

`HUMAN_ACTIVE`, `PAUSED`, and `CLOSED` block auto-send. Handoff cancels follow-ups. Resume is explicit. Provider message IDs deduplicate the entire decision path. Follow-ups are idempotent per conversation/scenario while pending. Existing Phase 1 financial and scheduling idempotency remains authoritative.
