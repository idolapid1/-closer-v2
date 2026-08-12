# Domain rules

## Tenant boundary

Every major entity has `id`, `businessId`, `createdAt`, and `updatedAt`. Repository calls are always scoped by `businessId`. An entity cannot be read or saved through a different tenant.

## Next Action

Every active lead (`NEW`, `ACTIVE`, or `QUALIFIED`) must have exactly one pending NextAction, and the lead must point to it. Replacing an action cancels the previous pending action. Won, lost, and archived leads do not require one.

## Conversation control

Conversation modes are `AI_ACTIVE`, `HUMAN_ACTIVE`, `PAUSED`, and `CLOSED`. Human takeover disables automation, replaces automated follow-up with a human-review action, and records the reason. Only explicit resume restores AI mode.

## Consent

An opt-out is persisted as a ConsentRecord. Marketing sends are blocked when marketing is not allowed or the contact opted out. Operational messages remain independently controlled.

## Scheduling

Appointment duration comes from Service. Active appointments for the same staff member cannot overlap. Cancelled appointments do not block time. Confirmation requires the configured deposit when one exists.

## Quote and job

Quote totals are integer cents: items minus discount plus optional tax. Discounts cannot exceed subtotal. Only sent/viewed/change-requested quotes can be accepted. Acceptance creates one job; repeated acceptance returns the existing job. A paid deposit moves the job to ready-to-schedule.

## Completion

Completion records service delivery, not cash. A completed and fully paid opportunity is closed as won with no immediate action. Otherwise its next action is collecting the remaining balance.
