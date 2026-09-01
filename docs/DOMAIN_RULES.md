# Domain rules

## Tenant boundary

Every major entity has `id`, `businessId`, `createdAt`, and `updatedAt`. Repository calls require `businessId`. Knowledge, memory, messages, decisions, follow-ups, tools, and financial state cannot cross tenants.

## Next Action

Every active lead (`NEW`, `ACTIVE`, or `QUALIFIED`) has exactly one current pending NextAction, and the lead points to it. Replacing an action cancels the prior pending action. Won, lost, and archived leads do not require one. Stage-specific truth wins: completed unpaid work means collect the balance; a sensitive question means human review.

## Conversation and autonomy

Stages are inferred context, not a workflow engine. The engine derives them from lead, quote/job/appointment, payment, memory, and mode state. Level 1 safe information and Level 2 non-sensitive information collection may auto-send only after application validation and grounded reply reconstruction. Level 3 business actions are proposals. Level 4 always hands off.

## Human control

Modes are `AI_ACTIVE`, `HUMAN_ACTIVE`, `PAUSED`, and `CLOSED`. Human Takeover records reason, triggering message, confidence, and responsible stage; disables automated sending; cancels pending follow-ups; and creates a human-review action. Resume AI is explicit and never automatic.

## Structured memory

Memory contains normalized operational facts with tenant/contact, key, value, source, timestamps, and optional source message. New non-conflicting facts are stored. Explicit corrections replace facts. Contradictions preserve the existing fact and require human confirmation.

## Consent and follow-up

Opt-out persists and blocks marketing. Operational communication remains independently controlled. A follow-up is a deterministic scheduled record, not a timer. Vertical cadence config controls its sequence; attempts require operation keys. It is blocked for Human Takeover, paused/closed/complete state, human-review action, incompatible consent, or an identical pending scenario. New customer messages complete pending follow-ups before recalculation.

Reactivation is never inferred as permission to message. Only sufficiently old lost opportunities with an eligible reason and active marketing consent become candidates. An explicit owner action reopens the opportunity and prepares one configured marketing follow-up; it does not send immediately.

## Scheduling, quote, job, and completion

The selected Service determines the journey family. Appointment duration comes from Service. Active appointments and scheduled jobs for the same staff cannot overlap. Availability claims use validated rules and existing work. Quote math uses integer cents; acceptance creates at most one job. A job must collect its required deposit before scheduling and must be scheduled before completion. Completion records delivery, not cash. An opportunity closes won only when completed and fully paid.

## Closing and continuation

Lost reasons are typed: customer declined, cancelled, outside service area, no longer interested, quote expired, or unavailable. Closed opportunities have no pending sales action or automated follow-up. A lost opportunity may be explicitly reopened when the customer returns; a won opportunity remains closed unless a validated refund recreates a real balance. A new opportunity is allowed for genuinely new work after previous work is closed.

## Idempotency

Inbound provider IDs, external connector conversation IDs, appointment/quote/job operation keys, payment keys, RevenueEvent causation/attribution operation IDs, follow-up attempt keys, and activity operation keys protect their respective side effects. Reuse with different business facts fails. Duplicate completion, acceptance, deposit, payment, scheduling, connector delivery, reactivation, attribution, or activity delivery returns existing truth or performs no additional side effect.

## Owner action boundary

Owner Copilot tools require an active owner TeamMember scoped to the same business. Read tools return operational projections without message bodies. Business-changing tools require explicit approval and call validated `CloserService` use cases; no provider or future LLM receives repository mutation access. Audit activities store tool and result count, not customer message content.

## Opportunity and recovery

- Customer is identity; Lead is acquisition context; Opportunity is one commercial need. One customer can have many opportunities, while a lead can back at most one Opportunity.
- Status and recovery state are orthogonal. A won or do-not-contact Opportunity cannot run recovery. `DO_NOT_CONTACT` always has `STOPPED` recovery.
- Intent, revenue, recovery, and urgency are independent deterministic scores. Every snapshot stores policy version, reason codes, explanation, causation key, and timestamp.
- Missed-call, new-lead, unsold-estimate, and old-lead recovery are bounded policies, not arbitrary workflows.
- Recovery decisions explain the recommendation; recovery actions separately persist preparation/execution state. `OBSERVE` and `SUGGEST` cannot become send-ready, `APPROVE_TO_SEND` requires owner approval, and high-value or booking actions cannot bypass approval under `AUTOPILOT`.
- Opt-out, explicit rejection, Human Takeover, closed work, invalid contact time, or an existing active recovery suppress automated action.
- A customer reply is idempotent by provider message ID, cancels stale action/follow-up work, and updates the same Opportunity; a reused provider ID with different facts is rejected.
- A validated booking may resolve an at-risk Opportunity and records booked value only. It does not increase collected revenue. `RECOVERED` attribution requires material completed/waiting-customer recovery evidence; prepared-only participation is `ASSISTED`, and absence of intervention remains `ORGANIC`.
- Actual recovered revenue is collected payment evidence linked to the same tenant/customer/lead/conversation/Opportunity, net of refunds. Estimated value and accepted estimates are never cash.
- Human Takeover changes recovery to `HUMAN_REQUIRED`, cancels pending delivery, and needs an explicit resume. Resume does not resurrect cancelled follow-ups automatically.
