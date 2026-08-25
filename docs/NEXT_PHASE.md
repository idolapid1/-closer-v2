# Recommended next batch — server trust boundary and durable execution

The local build now has a coherent owner presentation layer plus deterministic revenue-attribution, follow-up, reactivation, Owner Copilot, and connector boundaries. Do not enable live channel or AI execution before CLOSER has a production server trust boundary.

Recommended Phase 5 scope:

1. production backend application shell and environment configuration;
2. authenticated owner sessions and business membership;
3. server-enforced tenant scope on every repository/use case;
4. durable relational persistence and safe migration from local demo data where appropriate;
5. server-side idempotency keys, audit records, and financial/scheduling constraints;
6. API contracts that preserve `CloserService`/focused-service validation and keep providers untrusted;
7. durable background-job primitives for existing deterministic follow-up/reactivation records, without connecting customer channels yet;
8. observability, backups, recovery, and security regression coverage.
9. webhook inbox/outbox records that verify signatures and bind an external business account server-side before `ingestInboundLeadEvent` is called;
10. payment-provider webhook reconciliation that can verify collection without trusting browser or customer claims.

Keep the current deterministic local providers and demo tenants available as a test/simulation mode. Do not combine this phase with real WhatsApp, a payment gateway, calendar sync, or real LLM autonomy. Those follow after the server boundary and durable event ingestion are proven.

Before Phase 5 planning, run a physical iPhone Safari pass on the final Phase 4.2 build, especially mixed Hebrew/English MaskedHeading shaping, safe-area navigation, keyboard/composer behavior, and WebGL thermal impact. The implementation is WebKit-defensive, but native Safari was not available in the current engineering environment.
