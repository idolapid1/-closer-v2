# Architecture

The project is a strict TypeScript React/Vite application with these layers:

- `domain/` — entities, enums, money, scheduling, and NextAction invariants
- `application/` — validated use cases in `CloserService`
- `repositories/` — tenant-scoped contracts and versioned database schema
- `infrastructure/` — localStorage and in-memory storage adapters
- `integrations/` — AI and messaging ports plus deterministic mocks
- `data/` — deterministic fictional seed data
- `state/` — React adapter over the application service subscription
- `features/` and `components/` — internal UI only
- `test/` — shared deterministic test harness

Dependency direction is UI → application → domain/repository/provider ports. Infrastructure implements ports. The AI provider receives only a tenant-scoped context assembled by the application layer and cannot access repositories.

`LocalDatabase` validates schema version and the common tenant entity shape. Invalid or corrupt stored data falls back to the immutable demo seed. Every repository read and write requires `businessId`; a mismatched write throws.

The Phase 1 application service is intentionally a single coordination boundary. As use cases grow, split it by conversation, scheduling, quoting, and payments while keeping the same domain and repository contracts.
