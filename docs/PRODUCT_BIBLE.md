# CLOSER product bible

## Status and authority

This document is the primary strategic product reference for CLOSER. It defines what the product is, whom it serves, the outcomes it should optimize, and the sequence in which it should evolve. Architecture and implementation documents describe the verified system as it exists; when a forward-looking product statement conflicts with this document, this document governs.

Phase 4.1A is a direction reset only. It does not change application behavior, domain rules, or the verified Phase 1–4 implementation.

## Product definition

CLOSER is a **lead-to-cash autopilot for service businesses**.

> CLOSER takes every customer inquiry and continuously moves it toward the next best business action — until the customer books, approves, completes the service, and pays.

> CLOSER לוקח כל פנייה ומקדם אותה אוטומטית לשלב הבא — עד שהלקוח סוגר ומשלם.

In plain language: CLOSER centralizes incoming demand, understands who needs attention and what should happen next, and helps move each customer from first inquiry to payment without forgotten leads or constant manual chasing.

CLOSER is not defined by messaging, AI, CRM records, calendars, quotes, or payments. Those are capabilities inside one continuous commercial operating system.

## North star

Every meaningful feature must do at least one of these:

1. move a customer closer from inquiry to collected revenue; or
2. reduce the owner's manual work along that journey.

If a feature does neither, it is not a priority.

CLOSER should optimize for fewer forgotten inquiries, faster useful responses, fewer stalled opportunities, more complete information, more completed bookings or accepted quotes, timely deposits and follow-ups, fewer unpaid balances, and fewer owner interventions.

It should not optimize for AI-message volume, CRM-record volume, dashboard count, or vanity automation metrics.

## Target customer and pilot wedge

CLOSER initially serves owner-led and small-team service businesses where:

- inquiries often arrive through WhatsApp, social channels, forms, or direct owner input;
- each inquiry can have meaningful commercial value;
- booking or quoting requires several steps and structured information;
- follow-up materially affects conversion;
- appointments or jobs, deposits, completion, and payment all matter; and
- owners currently coordinate much of the journey manually.

The product remains one configurable, multi-tenant system with initial support for:

- auto detailing, PPF, and automotive services;
- beauty and aesthetics clinics; and
- home services and trades.

It must not become a separate application per vertical. Service and business configuration determine behavior.

Auto detailing and PPF are the strongest initial pilot candidate because the commercial path is concrete and measurable: vehicle → service → details/photos → quote → deposit → job → balance.

## Core commercial journeys

CLOSER supports two primary journey families and should always understand the customer's current step, blocker, and next best action.

### Appointment service

Inquiry → conversation → information collection → qualified → ready to book → appointment → deposit when required → confirmation → service completion → remaining balance → collection → closed won.

### Quote and job

Inquiry → conversation → information collection → quote-ready → quote → acceptance → deposit when required → job scheduling → job completion → remaining balance → collection → closed won.

The journey is not complete merely because an appointment exists, a quote is accepted, or work is marked complete. Closed won requires the appropriate completed outcome and no remaining balance.

## Data-source and operating model

CLOSER is designed for multiple sources feeding one tenant-safe customer and commercial record:

1. WhatsApp Business Platform;
2. Meta and Instagram leads;
3. website forms;
4. manual owner input;
5. calendar sources;
6. payment providers; and
7. future communication sources.

WhatsApp is an important first connector, not the product identity.

The conceptual flow is:

**Connectors → raw events → customer identity → customer/opportunity → conversation intelligence → commercial journey → next best action → automation policy → owner command center.**

Connectors and providers may report events. Application and domain services remain responsible for tenant ownership, identity, deduplication, validation, reconciliation, and mutation.

## Facts, claims, and system truth

AI may understand a customer's statement, but a statement is not automatically business truth.

- “I already paid” may become a structured customer claim; only a validated payment source or authorized business action changes financial truth.
- “Book me Monday at 10” is a request; only validated availability and application logic create a confirmed appointment.
- “They told me it costs ₪800” does not establish a price; only verified BusinessKnowledge, validated pricing rules, or an approved quote does.

AI is a reasoning, extraction, and recommendation layer. It is never the system of record.

## AI role and autonomy

The assistant is a constrained digital worker. It may understand intent, extract normalized facts, identify missing information, answer safe questions, collect information, recommend the next action, request validated tools, schedule permitted follow-up, and hand off when judgment is required.

Autonomy remains explicit:

- **Level 1 — safe information:** verified hours, address, fixed configured price, service description, service area, payment methods, and explicit policy.
- **Level 2 — information collection:** service type, vehicle details, photos, address, preferred time, and job details.
- **Level 3 — commercial progression:** propose validated slots, prepare a quote draft, request a deposit, or schedule a validated follow-up. Application and domain validation control execution.
- **Level 4 — human handoff:** medical or sensitive topics, complaints, refunds, unusual discounts, unsupported pricing or policy, legal or safety judgment, explicit human requests, low confidence, and conflicting information.

The assistant must never bypass tenant isolation, financial truth, scheduling validation, consent, Human Takeover, idempotency, or application mutation boundaries. Providers do not receive repository or mutation access.

## Owner experience

The owner should not have to monitor conversations all day. CLOSER should behave like an operator working in the background and surface only what merits attention.

The experience should answer:

- What needs me?
- What is happening today?
- Which customers are stuck?
- Who is ready to close?
- Who still owes money?
- What has CLOSER already handled?

### Product hierarchy

The recommended hierarchy is:

1. **Today / Command Center**
2. **Customers / Opportunities**
3. **Calendar / Jobs**
4. **Money**
5. **More**

Conversations or Inbox may live under More or open contextually from a customer or action. Exact navigation should be tested, but messaging must not define the product hierarchy.

### Today / Command Center

Today is the primary surface. It should say what the business must do now, what commitments happen today, what is blocked, what is ready to close, and what remains to collect.

Each item should explain the customer, real reason, useful amount or age where appropriate, and one clear action. A small, quiet summary may show useful work CLOSER handled since the owner's last visit, but it must prove operational value rather than become a vanity dashboard.

### Customer / Opportunity Workspace

The workspace tells one customer's commercial story; it is not primarily a contact profile. It should show journey progression, the current step, the blocker, the next action, current service, known facts, validated commercial state, and a short communication context.

The owner should immediately understand what the customer wants, where the opportunity stands, what prevents progress, what should happen next, and whether money has actually been paid.

### Calendar / Jobs

Calendar and Jobs add commercial context to commitments; they do not attempt to replace a full calendar product. Each commitment should connect the customer, journey, communication, and payment truth.

### Money

Money should remain simple: who owes, how much, for what, and what action is required. Do not expose speculative value, weighted revenue, attribution confidence, revenue-operations language, or accounting complexity.

### Conversations

Conversation is evidence and context, not the center of the product. Owners open it when human judgment or direct communication is needed. CLOSER should summarize structured commercial meaning outside the raw message stream.

## Follow-up

Follow-up is a core source of value because stalled opportunities should not be forgotten. Production follow-up must respect current journey truth, consent, Human Takeover, closed states, WhatsApp service windows, approved templates where required, and deduplication/idempotency.

Follow-up is not simply “send an AI message after N days.” It is a validated commercial action governed by policy and current facts.

## Explicit product boundaries

CLOSER is not a WhatsApp clone, chatbot, generic CRM, inbox product, calendar, accounting system, payment dashboard, workflow builder, or omnichannel communications suite.

These are deliberately deprioritized until the core product is validated:

- generic workflow builder or custom CRM-field builder;
- giant omnichannel inbox;
- full accounting system or complex analytics suite;
- dozens of dashboards;
- marketplace;
- voice AI or separate agents for every task;
- separate products per industry;
- desktop-first enterprise tables throughout the product;
- native mobile app before core-product validation; and
- marketing website before a strong pilot product.

Complexity belongs in the engine. The owner experience should remain simple.

## Pilot outcomes and measurement

Pilot measurement should eventually cover:

- first useful response time;
- inquiries without a NextAction;
- information-collection completion;
- appointment and quote progression;
- quote acceptance and deposit completion;
- follow-ups performed on time;
- outstanding balances and collected revenue;
- manual owner interventions and time saved; and
- opportunities recovered after inactivity.

The central validation questions are: Did the business miss fewer customers, close more, collect faster, and spend less time chasing people?

## Visual and experience direction

The Phase 4 interface is a technically verified implementation baseline, not an owner-approved final production direction. It is too white, plain, generic, CRM-like, inbox-oriented, and low in perceived premium value to propagate as the final system.

The next exploration should test a **Neo Luxury Command Center** direction: graphite or near-black foundations, deep navy surfaces, restrained electric indigo/blue/violet accents, controlled glow, refined depth, premium typography and actions, subtle motion, strong hierarchy, and excellent mobile behavior.

Visual effects must support comprehension and action. React Bits may be evaluated selectively later for a premium button, controlled glow, navigation, subtle list movement, spotlight surface, or transition; the product must not become an animation demo.

The design rule is: first decide what the owner should understand, then what the owner should do, then how it should look.

Codex may review UX and visual quality but may not approve a production visual direction on behalf of the product owner. A major redesign must begin with one representative Home / Command Center screen, be reviewed by the owner on real desktop and mobile, and propagate only after explicit approval.

## Verified engine to preserve

The product-direction reset does not invalidate the verified engine: tenant isolation, BusinessKnowledge, structured conversation decisions and memory, assistant safety and tools, Human Takeover, NextAction, appointment and quote/job journeys, deposits, payments, refunds, financial truth, journey reconciliation, idempotency, and the activity timeline remain foundational.

Future presentation work must build on these boundaries rather than rebuilding them.

## Revised roadmap

The recommended sequence is:

1. Product reset and Product Bible.
2. New Home / Command Center prototype.
3. Product-owner visual approval on desktop and mobile.
4. Production UX system propagation.
5. Production backend, authentication, and server tenant boundary.
6. Durable database, event ingestion, and jobs.
7. WhatsApp Business Platform integration.
8. Real AI in shadow mode.
9. Evaluation corpus and quality measurement.
10. Safe limited autopilot.
11. Calendar and payment integrations.
12. Pilot business.
13. Product measurement and iteration.
14. Additional channels and vertical expansion.

Technical dependencies may adjust sequencing, but they must not erase the strategic gates: prove the command-center experience, obtain owner approval, establish server-side trust, evaluate real AI before autonomy, and validate the product with a focused pilot before broad expansion.
