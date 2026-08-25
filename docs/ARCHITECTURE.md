# Architecture

The project is a strict TypeScript React/Vite application with these layers:

- `domain/` — tenant entities, enums, money, scheduling, and NextAction invariants
- `application/CloserService.ts` — public use-case, validation, and mutation boundary
- `application/commercial/` — derived journey reconciliation and idempotent activity timeline
- `application/conversation/` — stage inference, deterministic decisions, decision policy, tool execution, memory, knowledge, and follow-ups
- `application/revenue/` — evidence-validated revenue attribution and net-refund summaries
- `application/reactivation/` — consent-safe inactive-opportunity eligibility
- `application/owner/` — authorized Owner Copilot tool contracts
- `application/presentation/` — tenant-scoped product read models and plain-Hebrew presentation copy
- `repositories/` — tenant-scoped contracts and schema v5
- `infrastructure/` — localStorage/in-memory adapters, validation, and v1–v4→v5 migration
- `server/api` — authenticated Fastify routes, validation, safe errors, and role checks
- `server/auth` — OIDC/JWKS JWT verification
- `server/application` — server authorization, idempotency, and durable repository contracts
- `server/infrastructure` — PostgreSQL and deterministic in-memory server adapters
- `server/jobs` and `server/webhooks` — leased mock follow-up execution and signed ingestion
- `server/migrations` — PostgreSQL schema, tenant constraints, audits, and RLS
- `integrations/` — provider/connector ports, deterministic mocks, and disabled production adapters
- `data/` — deterministic fictional multi-vertical seed
- `state/` — React subscription adapter
- `components/product/` — owner shell, scoped visual tokens, and shared presentation primitives
- `features/actions`, `features/customers`, `features/customer`, `features/inbox`, `features/work`, `features/money`, and `features/more` — normal owner experiences
- remaining `features/` and `components/` — preserved engineering/demo UI
- `test/` — deterministic harness

The dependency direction is UI → application → domain/repository/provider ports. Infrastructure implements ports. React does not access storage. `MockAIProvider` owns only `ConversationEngine`; it has no repositories, network, clock, or mutation access.

## Product presentation path

1. `ProductReadService` receives a `businessId` and reads only that tenant through repository interfaces.
2. It combines validated conversation, commercial-journey, work, payment, consent, memory, and activity truth into purpose-built Today, Inbox, Customers, Customer Workspace, Schedule, Money, and revenue-summary projections.
3. `productCopy` maps enums and deterministic demo labels to concise Hebrew without changing domain state.
4. Production React components render those projections and invoke existing validated `CloserService` use cases for sends, handoff/resume, consent, and reopening.

The read service does not mutate repositories or calculate new financial truth. React does not infer stages, balances, action priority, or tenant ownership. Raw assistant decisions, tool names, reason codes, IDs, and operation keys remain in `/debug`, outside the production presentation boundary.

The revenue summary uses validated payment and commercial state only. It reports net collected cash, collection due now, known value in open opportunities, and booked/won counts. Generated/recovered revenue stays `NOT_AVAILABLE` until `RevenueAttributionService` verifies a collected event against same-tenant, same-contact, same-conversation activities. It never infers attribution from UI activity, assistant messages, quote value, or customer claims.

`Lead` also carries normalized source, external source reference, priority, and typed objections. `FollowUpService` persists cadence step, channel, attempts, result, stop reason, owner, and draft. `ReactivationService` only returns old lost opportunities that satisfy the tenant inactivity window and marketing consent. `CloserService` performs explicit reopen/schedule mutations. Owner Copilot tools run through an active tenant owner identity; mutation tools require an explicit approval bit and all executions receive idempotent audit activities.

Routing uses two explicit shells. `ProductLayout` owns the RTL owner routes `/actions`, `/customers`, `/customer/:id`, `/inbox`, `/work`, `/money`, and `/more`; the Phase 3 `Layout` remains around `/demo`, `/appointments`, `/quotes`, and `/debug`. This prevents engineering inspection needs from leaking into the owner visual language.

The Today route is code-split with `React.lazy`. Its GSAP/OGL identity dependencies and WebGL component are not part of the initial chunk for routine Customers, Work, Money, More, or Conversation navigation. `ProductLayout.css` is loaded after the legacy engineering stylesheet and scoped by `.owner-shell`, so production routes cannot fall back to light legacy surfaces while engineering routes remain unchanged.

## Conversation path

1. `CloserService` deduplicates and persists the inbound message.
2. `CustomerMemoryService` extracts normalized facts and reports conflicts without overwriting them.
3. `ConversationStageService` infers stage from tenant domain state.
4. `ConversationEngine` proposes a structured `ConversationDecision`.
5. `AssistantDecisionPolicy` validates confidence, autonomy, knowledge topic, tool permission, and workflow compatibility.
6. `AssistantToolExecutor` executes reads or prepares a validated proposal; it never mutates repositories.
7. The policy rebuilds customer-facing Level 1/2 text from validated results.
8. `CloserService` updates conversation/NextAction/follow-up/handoff state and conditionally sends through the messaging port.

Level 3 tools remain proposals: real appointment, quote, deposit, payment, and job mutations use existing explicit application use cases. Inbound connector events enter through `ingestInboundLeadEvent`, which validates the routed tenant, deduplicates external conversation/message IDs, and reuses the same opportunity when an eligible lost customer returns.

## Commercial mutation path

1. `CloserService` validates tenant, customer/reference ownership, journey type, current state, idempotency, money, and schedule.
2. The domain entity and financial/revenue records are written through tenant repositories.
3. `CommercialJourneyService` reads the current appointment or quote/job plus validated payments and derives stage, total, collected amount, remaining balance, and the single recommended action.
4. `CloserService` closes stale actions/follow-ups or replaces the action and synchronizes the conversation projection.
5. `ActivityTimelineService` records meaningful customer/business events once per operation key.

`Lead` remains the opportunity identity. Financial and scheduling truth is not copied into it; `CommercialOpportunityView` is a read projection.

## Persistence

Every collection is tenant scoped. Schema v5 preserves earlier workflow/activity migrations and adds sales-source context, vertical follow-up/reactivation settings, auditable revenue context, and unattributed defaults. Valid v1–v4 data is enriched and preserved; malformed data returns to the deterministic seed. Repository mismatched writes throw, and cross-tenant reads return nothing.

Demo mode continues to use this versioned browser schema. Production mode uses browser → authenticated API → authorization/application service → PostgreSQL repository. A tenant route parameter is never authorization: membership is resolved from the verified identity, each SQL query is tenant-filtered, tenant-linked foreign keys reject cross-customer references, and RLS/unique constraints add defense in depth. See [Production architecture](PRODUCTION_ARCHITECTURE.md).
