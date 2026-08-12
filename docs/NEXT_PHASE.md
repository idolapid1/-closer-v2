# Next phase

The recommended next step is a dedicated product-design and backend-boundary phase, starting with the action-first inbox/customer workspace rather than a dashboard.

1. Validate the conversation and NextAction vocabulary with real service-business operators.
2. Design the production inbox/customer experience around one clear action.
3. Split `CloserService` into focused application modules without changing tested contracts.
4. Design an authenticated backend repository implementation and migration from local schema v1.
5. Add a WhatsApp sandbox adapter behind `MessagingProvider`, consent audit requirements, retries, and webhook idempotency.
6. Add a real AI adapter only after an evaluation set exists for knowledge grounding, uncertainty, tool validation, and handoff.

Do not add analytics dashboards, broad CRM scope, or additional channels until the complete inquiry-to-payment loop is validated with users.
