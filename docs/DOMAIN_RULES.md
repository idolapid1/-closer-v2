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

Opt-out persists and blocks marketing. Operational communication remains independently controlled. A follow-up is a deterministic scheduled record, not a timer. It is blocked for Human Takeover, paused/closed/complete state, human-review action, incompatible consent, or existing identical pending scenario. New customer messages cancel pending follow-ups before recalculation.

## Scheduling, quote, job, and completion

Appointment duration comes from Service. Active appointments for the same staff cannot overlap. Availability claims use validated rules and existing appointments. Quote math uses integer cents; acceptance creates at most one job. Completion records delivery, not cash. An opportunity closes won only when completed and fully paid.
