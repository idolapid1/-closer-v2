# Assistant tools

Tools are application-level requests, not provider capabilities. The provider selects a tool name and arguments; the application validates tenant, autonomy, workflow, state, facts, consent, idempotency, money, and scheduling.

| Tool | Phase 2 behavior |
| --- | --- |
| `getBusinessInfo` | Returns tenant knowledge identity/hours/address/area/payment methods. |
| `getServiceInfo` | Returns configured description, duration, and preparation. |
| `getServicePrice` | Returns only configured fixed price/range; missing price blocks. |
| `getCustomerContext` | Returns tenant contact identity and structured-fact count. |
| `getConversationContext` | Returns stage/mode/message count and validated payment summary. |
| `requestCustomerInformation` | Proposes the next configured missing fact. |
| `requestPhotos` | Proposes a photo request when photos are the next missing fact. |
| `getAvailableSlots` / `suggestAppointment` | Requires service, capable staff, ISO date, availability rule, and no conflict. |
| `createQuoteDraft` | Returns `REQUIRES_VALIDATION`; never writes a Quote. |
| `createNextAction` | Proposes an application-validated action/opt-out acknowledgement. |
| `handoffToHuman` | Proposes explicit handoff metadata; `CloserService` records it. |

Only explicit `CloserService` use cases create appointments, quotes, jobs, payments, RevenueEvents, or actual next-action state.
