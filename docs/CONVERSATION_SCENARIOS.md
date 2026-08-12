# Conversation scenarios

The 42 deterministic scenario/adversarial cases exercise application-level multi-turn behavior, not just isolated helpers.

- Beauty: opening hours, fixed price, unknown price, sensitive question, missing date, real slot proposal, returning-customer memory.
- Auto detailing: service selection, make/model/year/condition, photos, quote readiness, corrections, conflicts, multi-turn progression.
- Home services: job/location/details, service-area rejection, photos/urgency, quote readiness.
- Control: explicit human request, low confidence, complaint, refund, unusual discount, opt-out, operational consent, takeover/resume, closed state.
- Follow-up/idempotency: quote/no-response scheduling, no duplicate pending scenario, no closed follow-up, repeated inbound delivery.
- Financial/scheduling truth: no invented slot, no message-created booking/payment, validated balance, completed-unpaid action.
- Isolation/adversarial: tenant knowledge/memory boundaries, prompt injection, customer/business exfiltration requests, fake payment, unsupported booking, malicious provider wording, and tool/autonomy mismatch.

The debug Conversation Simulator exposes the same persisted decisions, tool results, memory, action, handoff, and follow-up state used by these tests.
