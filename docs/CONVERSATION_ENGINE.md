# Conversation engine

Conversation is a tenant object with channel, owner, state, inferred stage, automation mode, response timestamps, current intent, missing information, handoff, and NextAction references. Phase 2 remains WhatsApp-mock first.

## Structured decision

`ConversationDecision` contains detected/secondary intents, confidence, inferred stage, customer goal, known facts, missing information, suggested reply/action, requested tool and arguments, human-review/risk state, knowledge sources, follow-up recommendation, autonomy level, and a concise internal reason code. No chain-of-thought is stored or exposed.

## Grounding and progression

The engine uses only tenant `BusinessKnowledge`, validated domain state, structured customer memory, and deterministic rules. Each service configures its qualification fields. Already-known facts are not requested again. Clinic medical/sensitive content hands off. Auto detailing collects vehicle/condition/photos. Home services collects location/job detail/photos/urgency and checks configured service-area names.

Stages range from `NEW_INQUIRY` through information collection, booking/quote/deposit/job/payment states, and closed/human review. `ConversationStageService` infers them from current truth rather than trusting a stale conversation field.

## Execution

The provider proposes; `AssistantDecisionPolicy` validates. `AssistantToolExecutor` performs tenant-checked reads and validations. The policy then reconstructs auto-sendable text from tool results, which prevents provider wording from inventing a price, address, policy, slot, or payment status. Level 3 proposals are visible in the simulator but never create appointments, quotes, payments, or jobs.

Each inbound provider message ID is idempotent. Repeated delivery returns the existing decision and cannot duplicate messages, memory, actions, follow-ups, handoffs, or provider sends. A reused ID with different content fails. Connector ingestion additionally binds external conversation identity to a Lead source reference and rejects routed-tenant mismatch before creating customer data.

Follow-up cadence is configured per tenant and scenario. A scheduled record includes sequence step, channel, attempts, next/last attempt, response, stop reason, manual override, owner, and optional deterministic draft. Human Takeover, closed state, consent, customer response, and explicit cancellation are enforced stop conditions. There is still no background sender in this local phase.

After validated conversation/memory changes, commercial reconciliation preserves the same active lead and updates its derived stage/action. Human Takeover still wins over commercial recommendations. Explicit Resume AI re-infers the stage from current appointment/quote/job/payment truth.

See [Assistant Safety](ASSISTANT_SAFETY.md), [Assistant Tools](ASSISTANT_TOOLS.md), and [Conversation Scenarios](CONVERSATION_SCENARIOS.md).
