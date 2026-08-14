# Product UX — Phase 4 implementation record

## Phase 4.1B approval prototype

`/actions` now carries one deliberately isolated Neo-Luxury Command Center direction. The first viewport combines a restrained ambient operating field, a single expressive identity line, the number of active opportunities, the number of owner decisions, and the beginning of the decision queue. Human Takeover is ranked first; balances remain separate and actionable; Today and proof of prepared automation work follow below.

The owner hierarchy shown in the prototype is **Today → Customers → Calendar / Jobs → Money → More**. Only Today is active during this approval milestone. Engineering routes are absent from owner navigation but remain directly available. Inbox and Customer Workspace retain their verified Phase 4 implementation until the product owner explicitly approves or rejects this direction.

The prototype uses a tenant-scoped presentation projection only. It does not create analytics, mutate commercial records, or treat automatic preparation as completed work. Its date and relative ages come from the same `ProductTodayView.asOf` value used to derive the day’s commercial truth.

> **Status:** This document records the verified Phase 4 interface as implemented. It is not the approved future product hierarchy or final visual direction. [CLOSER Product Bible](PRODUCT_BIBLE.md) is authoritative: Today / Command Center leads the product, Customers / Opportunities carry the commercial story, and Inbox becomes contextual rather than product-defining. A new direction must begin with one owner-reviewed prototype before propagation.

Phase 4 gives CLOSER a production product layer around three questions a service-business owner asks repeatedly: what needs attention, who is waiting, and what is happening with this customer. The interface is Hebrew-first, action-first, and intentionally avoids CRM and AI terminology.

## Navigation

Desktop navigation is a graphite RTL rail. The primary product destinations are deliberately limited to:

- **היום** (`/actions`) — the owner’s action center and default route.
- **פניות** (`/inbox`) — the business conversation workspace.
- **Customer Workspace** (`/customer/:id`) — entered from an action or conversation rather than occupying permanent navigation.

Internal demo, appointment, quote/job, and debug routes remain reachable in a visually secondary tools area. Mobile uses bottom navigation for Today, Inquiries, and More; it does not shrink the desktop rail.

## Today

Today answers “what should I deal with now?” before showing supporting context. It has three groups:

1. **דורש טיפול** — one primary pending action per active opportunity, with human review visually prioritized.
2. **היום** — validated appointments and jobs scheduled for the current business day.
3. **תשלומים** — real remaining balances that require collection.

Rows show the customer, a plain-language reason, a useful age or real amount, and one clear action. They do not show pipeline labels, confidence, weighted value, or analytics. Closed opportunities and stale actions are absent. Empty states explain that there is nothing requiring attention rather than presenting zero-value KPI cards.

## Inbox

Inbox is a service-business workspace, not a WhatsApp clone. Desktop uses a conversation list and one active thread. The list emphasizes who wrote, the latest useful context, the customer’s current stage in plain language, and whether the owner must take over.

The active thread includes:

- readable customer and business message bubbles;
- one compact “מה כדאי לעשות עכשיו” recommendation;
- a suggested response only when it is safe and useful;
- an unmistakable Human Takeover banner with explicit Resume Assistant control;
- direct access to the Customer Workspace.

On mobile, selecting a conversation replaces the list with the thread and provides a clear RTL back action. The message composer remains reachable above the bottom navigation without horizontal overflow.

## Customer Workspace

Customer Workspace is the production source of truth for one customer. Its header establishes identity, selected service, current human-readable state, and primary action. The page then presents the commercial story rather than exposing separate domain entities:

- current appointment or quote/job;
- recent conversation context;
- validated total, collected amount, refund information, and remaining balance;
- useful structured customer facts;
- meaningful business activity in chronological context;
- communication consent and Human Takeover state.

An outstanding balance is explicit; completion never implies collection. Closed-won customers receive a calm completed state with no stale sales action. Closed-lost customers may be reopened through the existing validated application use case.

## Presentation boundary

`ProductReadService` builds tenant-scoped read models for Today, Inbox, and Customer Workspace from repository and commercial-journey truth. `productCopy` maps internal enums and demo labels to concise Hebrew. React renders these projections and invokes validated `CloserService` use cases; it does not calculate balances, infer commercial state, reconcile actions, or read persistence directly.

Production screens never expose raw confidence, detected intent, requested tools, internal reason codes, entity IDs, operation keys, repository data, or JSON. Those remain available in `/debug` for engineering work.

## RTL and mixed content

The production shell owns `dir="rtl"`. Visual order follows Hebrew reading patterns without blindly mirroring content semantics. Times, phone numbers, email addresses, currency fragments, and English service terms are directionally isolated. Directional chevrons and arrows are chosen for RTL navigation; message sides express author, not language direction.

## Responsive behavior

Mobile is a distinct product layout:

- persistent bottom navigation replaces the sidebar;
- Today actions stack into scannable rows;
- Inbox uses list-to-thread navigation rather than compressed columns;
- payment state appears early in Customer Workspace;
- primary actions remain reachable and touch-friendly;
- long Hebrew and mixed-direction content wrap without clipping.

Desktop favors width for scanning and conversation context but avoids a permanent third Inbox column and card-heavy dashboards.

## Accessibility target

The production layer uses semantic landmarks, ordered information, visible focus, native controls, descriptive labels, status announcements, strong contrast, and reduced-motion support. Human control, payment, and close states are always expressed in text as well as color. Visual QA complements, but does not replace, keyboard, focus, screen-reader-name, and responsive-reflow testing.
