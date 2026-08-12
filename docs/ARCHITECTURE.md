# Architecture

The project is a strict TypeScript React/Vite application with these layers:

- `domain/` — tenant entities, enums, money, scheduling, and NextAction invariants
- `application/CloserService.ts` — public use-case and mutation boundary
- `application/conversation/` — stage inference, deterministic decisions, decision policy, tool execution, memory, knowledge, and follow-ups
- `repositories/` — tenant-scoped contracts and schema v2
- `infrastructure/` — localStorage/in-memory adapters, validation, and v1→v2 migration
- `integrations/` — provider ports and deterministic mocks
- `data/` — deterministic fictional multi-vertical seed
- `state/` — React subscription adapter
- `features/` and `components/` — internal engineering UI only
- `test/` — deterministic harness

The dependency direction is UI → application → domain/repository/provider ports. Infrastructure implements ports. React does not access storage. `MockAIProvider` owns only `ConversationEngine`; it has no repositories, network, clock, or mutation access.

## Conversation path

1. `CloserService` deduplicates and persists the inbound message.
2. `CustomerMemoryService` extracts normalized facts and reports conflicts without overwriting them.
3. `ConversationStageService` infers stage from tenant domain state.
4. `ConversationEngine` proposes a structured `ConversationDecision`.
5. `AssistantDecisionPolicy` validates confidence, autonomy, knowledge topic, tool permission, and workflow compatibility.
6. `AssistantToolExecutor` executes reads or prepares a validated proposal; it never mutates repositories.
7. The policy rebuilds customer-facing Level 1/2 text from validated results.
8. `CloserService` updates conversation/NextAction/follow-up/handoff state and conditionally sends through the messaging port.

Level 3 tools remain proposals: real appointment, quote, deposit, payment, and job mutations use existing explicit application use cases.

## Persistence

Every collection is tenant scoped. Schema v2 adds customer memory, scheduled follow-ups, and assistant decision records. Valid v1 data is enriched with safe Phase 2 defaults and preserved; malformed data returns to the deterministic seed. Repository mismatched writes throw, and cross-tenant reads return nothing.
