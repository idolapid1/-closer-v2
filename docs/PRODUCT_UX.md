# Product UX — Phase 4.2 owner experience

CLOSER presents the owner with an operating loop, not a CRM to administer:

**what CLOSER already did → what it is doing now → what needs owner judgment → what happens next.**

The normal owner application is one coherent Hebrew-first system across Today, Customers, Customer Workspace, Conversation, Calendar/Jobs, Money, and More. WhatsApp is conversation context; the customer’s commercial journey is the product.

## Navigation

- **היום** (`/actions`) — owner decisions, today’s commitments, balances, and quiet proof of autonomous work.
- **לקוחות** (`/customers`) — customer/opportunity operating view. `/customer/:id` and `/inbox` remain active within this section.
- **יומן ועבודות** (`/work`) — appointment and job commitments through one configured journey view.
- **כסף** (`/money`) — validated money waiting and settled commercial truth.
- **עוד** (`/more`) — actual business, team, automation-boundary, communication, and help context.

Back/forward navigation, direct routes, refresh, desktop links, and mobile links use ordinary browser routing. Engineering screens are direct-only and never appear in this menu.

## Today / Command Center

The first viewport establishes: **validated money → how many things need the owner → the first decision.** Human Takeover is sorted first. Cards are denser than the approval prototype, and supporting Today/Money/revenue-truth areas sit below the decision queue. Empty states are short explanatory rows.

Today leads with net validated collection and known open commercial value, then the owner decision count. The lower revenue panel separates validated collection, open value, and paid/won count, and states that generated/recovered attribution is unavailable until verified sources are connected. The ambient identity is strongest here and absent from routine pages.

## Customers

Customers is not a contacts table. Search and compact filters organise people by useful commercial states: needs owner, ready, waiting, in progress, collection, or closed. Each row exposes service context, the current grounded action/state, verified amount when useful, and one route into the journey.

The same presentation contract supports appointment-service and quote/job businesses through service workflow configuration, never a business-name branch.

## Customer Workspace

The workspace opens with identity, service, commercial state, Human Takeover when relevant, and one primary next action. It then tells the customer story:

1. lead-to-cash journey position;
2. current appointment or quote/job;
3. useful known and missing information;
4. recent conversation context;
5. meaningful activity;
6. validated total, collected, refund, and remaining balance;
7. independent operational and marketing consent.

Customer claims do not establish price, booking, or payment truth. The UI displays those only from validated application/domain state. Completion remains visibly distinct from full collection.

## Conversation

Conversation is a commercial decision workspace, not a WhatsApp clone. The list shows customer, useful context, journey state, and owner exceptions. The active thread keeps customer identity, current service/stage, Human Takeover, recommended next action, Customer Workspace link, messages, and composer together.

On mobile the list and thread are separate views. Back restores focus to the selected conversation. Human Takeover blocks assistant sending until the explicit Resume control is used; an owner can still send an operational reply.

## Calendar / Jobs

`/work` is a CLOSER operational schedule rather than a general calendar. Today is dominant; unscheduled work, upcoming work, and recent completion follow only when populated. Each item combines real schedule time, customer, service/job, status, and deposit/balance context.

## Money

Money answers “what verified money is waiting?” with a single total and customer-level balances. “Due now” means an unpaid required deposit or a remaining balance after completion; it does not treat an unaccepted/declined quote or the full future balance as immediately collectible. Refund context remains visible. Quotes and customer payment claims are never counted as cash.

## More

More exposes current owner-facing truth only: active business identity, active team, safe automation boundaries, accepted communication/payment context, and help. Future integrations/settings are described as unavailable rather than rendered as dead controls. No engineering routes are exposed.

## Production versus engineering information

Owner routes never expose confidence scores, intent/reason codes, provider/tool names, JSON, operation keys, repository IDs, or raw memory. `/debug` deliberately retains those details for deterministic engineering and future provider integration.

## Accessibility and mobile posture

The owner shell uses semantic landmarks, labelled native controls, visible focus, route focus handoff, textual state descriptions, reduced-motion behavior, dynamic viewport sizing, safe-area padding, and minimum mobile touch targets. Mixed Hebrew/English, phone, email, vehicle, time, and currency data are isolated rather than globally forced into one direction.

Browser responsive QA covers 1440×1024, 1100×760, 393×852, and 375×812, including multiple scroll positions. Physical Safari remains a separate device acceptance pass; the implementation is WebKit-defensive but is not represented as a native-Safari measurement.
