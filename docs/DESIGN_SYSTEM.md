# CLOSER owner visual system — Phase 4.2

The normal owner application uses one Neo-Luxury operating environment. It is a dark product system, not a black admin dashboard: commercial priority comes from type, rhythm, separators, and restrained material depth before card containers or status color.

## Foundation

- **Environment:** near-black `#070912`, deep graphite/navy surfaces, cool white type, and restrained indigo/violet light.
- **Semantic accents:** human review `#ff7186`, verified collection `#dec181`, completed truth `#7fd5b1`, and primary action `#7864ff`. Color always accompanies text.
- **Surface levels:** continuous canvas; quiet operational section; customer/work surface; command surface; exception surface. Repeated records normally use separators instead of individual floating cards.
- **Type:** local system stack for dependable Hebrew rendering. Owner decisions use compact high-contrast headings; supporting copy is never required to decode the action.
- **Geometry:** 9–14px controls and operational surfaces, 18px command surfaces. Shadows are restrained and reserved for identity/command depth.

The scoped owner tokens and route compositions live in `components/product/ProductLayout.css`. The earlier light structural rules remain available to engineering screens, while `.owner-shell` deliberately owns the complete normal product presentation.

## Shell and navigation

Desktop uses one fixed RTL navigation rail: **היום, לקוחות, יומן ועבודות, כסף, עוד**. Mobile uses the same five destinations in a 56px bottom bar with safe-area padding. The business selector is integrated into a 52px mobile top bar and keeps a native labelled select.

`/debug`, `/demo`, `/appointments`, and `/quotes` retain the utilitarian engineering shell and are absent from owner navigation.

## Product surfaces

- **Command:** the Today operating state and first owner decision.
- **Attention:** a thin semantic signal, customer context, reason, grounded truth, and one action. Human Takeover is strongest.
- **Customer:** a separated operating row organised by commercial state, not contact metadata.
- **Journey:** the customer’s current lead-to-cash position; appointment and quote/job journeys share one visual contract.
- **Schedule:** time, customer, service/job, validated status, and deposit/balance context.
- **Financial:** large verified amount followed by actionable per-customer truth; no speculative analytics.
- **Exception:** restrained human-control treatment that explains automation is paused until explicit resume.
- **Empty:** compact explanatory row, never a giant blank card.

## Identity components

`MaskedHeading` remains a Today identity device. It renders semantic text once for assistive technology and uses ordinary DOM word spans for the visible material fill. This preserves WebKit Hebrew glyph shaping and mixed RTL/LTR order without reversing strings or drawing text in SVG.

`MoltenMetal` is used only behind Today. It is decorative, lazy-loaded with the Today route, pauses when hidden/offscreen, reduces mobile detail, and falls back to a static material when WebGL 2 or motion permission is unavailable. Other routes use CSS material surfaces and do not load a shader for decoration.

## Responsive and bidi rules

- Use logical inline/block properties and `dir="rtl"` at the owner shell.
- Isolate phone numbers, email, dates, currency, and terms such as `BMW M240i` with `bdi`, `dir="auto"`, or plaintext bidi where appropriate.
- At 820px the sidebar becomes bottom navigation; Inbox switches between list and one active thread; customer columns become a single journey narrative.
- At 520px essential controls remain at least 44px, conversation actions stay visible, and all seven journey milestones fit without horizontal page overflow.
- Use `100dvh` and `env(safe-area-inset-bottom)` for Safari/mobile chrome boundaries.

## Interaction and accessibility

- One `main` landmark, semantic headings/regions/lists, native links/buttons/selects, and a visible skip link.
- A high-contrast 3px `:focus-visible` ring; route changes focus the main content; opening and closing a mobile conversation moves focus deliberately.
- Human Takeover, money, closed, and missing-information states are expressed in text and icon as well as color.
- Reduced motion removes nonessential animation and replaces the ambient shader with the static treatment.
- Mobile owner controls use 44px or larger touch targets; bottom navigation uses 56px targets.

Lucide remains the single icon family. Directional arrows follow RTL navigation: forward/drill-in points left, back points right. Icons never substitute for an accessible name.
