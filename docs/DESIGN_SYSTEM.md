# Design system — Phase 4 implementation record

## Phase 4.1B prototype layer

The Command Center tests a new, isolated visual language on `/actions` only. It is not yet a production design system and must not be propagated before explicit owner approval.

- **Environment:** near-black `#07080d`, graphite/deep-navy surfaces, and rare indigo/violet illumination.
- **Identity:** one semantic Hebrew/English `MaskedHeading` filled with an original liquid-metal material. RTL words use SVG `direction="rtl"` with `text-anchor="start"`; Latin words remain LTR with `text-anchor="end"`.
- **Ambient motion:** one decorative `MoltenMetal` WebGL 2 layer. It pauses offscreen and when the page is hidden, caps desktop DPR, lowers mobile detail/glow/opacity, disables mobile pointer response and grain, and falls back to a static material for reduced motion or missing WebGL 2.
- **Actions:** an original CLOSER card family with a small status signal, customer/service identity, business reason, one structured truth band, and one primary action. Card 1 influenced only the composed object and framed information concept; no proprietary code was used.
- **Responsive order:** identity and operating state → owner decision count → top action → remaining queue → Today → Money → prepared automation proof. Mobile uses native-width stacking and the existing bottom-navigation boundary rather than shrinking desktop.
- **Accessibility:** semantic headings and regions, one page-level main landmark, native links/selects, customer-specific action names, visible focus, text-plus-color states, 44px mobile actions, decorative shaders hidden from assistive technology, and reduced-motion fallback.

The prototype styles are intentionally scoped through `.command-center-shell` and `.command-*` selectors. The supplied visual components keep their own focused stylesheets. Unused prototype tokens were removed; the three existing breakpoints remain ordered at 1120, 820, and 520 pixels.

> **Status:** These tokens and components document the technically verified Phase 4 UI. They remain useful implementation evidence but are not an owner-approved final production direction and must not be propagated by default. The future experience and approval gate are defined by the [CLOSER Product Bible](PRODUCT_BIBLE.md).

Phase 4 introduces a restrained production presentation system for the three core product experiences. Its visual direction is calm and operational: graphite navigation, crisp light working surfaces, one indigo action accent, and hierarchy created primarily with typography, spacing, and separators.

## Foundations

The production shell is Hebrew-first and RTL. It uses the local system font stack (`Arial`, `Segoe UI`, `system-ui`) so Hebrew remains legible without a network font. Text weights are limited to regular, medium, and semibold; small muted copy is not used for essential actions.

Core color tokens:

- canvas `#f4f6f8`, surface `#ffffff`, subtle surface `#f8f9fb`
- primary ink `#171a21`, secondary and muted ink `#626b7a`
- graphite navigation `#171a20`, elevated navigation `#20242c`
- indigo action `#3454d1`, hover `#2945b8`, soft accent `#eef2ff`
- semantic success `#147a55`, warning `#946200`, danger `#c43e4b`
- standard border `#e2e6ec`, strong border `#cbd2dc`

The spacing rhythm uses 4, 8, 12, 16, 24, 32, 40, 48, and 64 pixels. Controls use an 8px radius, grouped surfaces 12px, and overlays 16px. Shadows are reserved for overlays; normal sections use surface contrast and separators.

## Components

The production component set is intentionally small:

- `ProductLayout` provides desktop navigation, mobile navigation, the business selector, skip link, and RTL boundary.
- `ProductPage` and `SectionHeader` establish page and section hierarchy.
- `ActionRow` presents one customer, one reason, and one clear action.
- `CustomerAvatar`, `EmptyState`, `ErrorBanner`, and `SuccessBanner` provide consistent supporting states.
- Inbox-specific conversation rows, message bubbles, recommendation strip, takeover banner, and composer are composed where used.
- Customer workspace work, payment, facts, and activity summaries remain focused presentation components rather than generic dashboard cards.

Lucide supplies the single outline icon language. Directional icons follow the action in RTL: forward/drill-in points left and back points right. Icons support labels and never replace necessary text.

## Interaction states

Primary controls use indigo; secondary controls use a neutral surface and indigo text; quiet controls avoid unnecessary visual weight. All interactive elements have visible `:focus-visible` outlines. Disabled controls suppress action affordance, and hover feedback is restrained. Empty, success, error, human-takeover, closed-won, and outstanding-balance states use semantic color sparingly and always include text.

Motion is limited to short color, panel, and control feedback. `prefers-reduced-motion` removes nonessential transition and animation duration.

## Responsive rules

- Above 1050px, the fixed RTL sidebar is 232px and content uses the full working width.
- From 821–1050px, the sidebar and Inbox list narrow without reducing action clarity.
- At 820px and below, the sidebar becomes a three-item bottom navigation and the top bar simplifies.
- On mobile, Today becomes a single column, Inbox moves between the list and one active thread, and Customer Workspace puts payment truth before secondary detail.
- At 520px and below, actions become full-width or icon-forward where labels would crowd; touch targets remain at least 44px.

Use logical CSS properties (`inline` and `block`) for layout. Phone numbers, times, email addresses, and mixed Hebrew/English content use explicit LTR isolation with `bdi` where needed. Production pages must not create horizontal overflow or dense desktop tables on mobile.

## Accessibility rules

- Preserve semantic landmarks, headings, lists, labels, and native buttons/links.
- Keep a visible keyboard skip link and predictable focus when opening a mobile conversation.
- Associate status changes with `role="status"` or `role="alert"` where appropriate.
- Do not communicate Human Takeover, payment state, or completion by color alone.
- Maintain strong text/background contrast and 44px mobile touch targets.
- Test keyboard order, screen-reader names, zoom/reflow, and reduced motion in addition to visual inspection.

## Production versus engineering UI

The production design system applies to `/actions`, `/inbox`, and `/customer/:id`. These routes translate commercial truth into plain Hebrew and omit confidence scores, enum values, reason codes, provider/tool names, operation keys, IDs, and raw memory structures.

`/debug`, `/demo`, `/appointments`, and `/quotes` retain their functional engineering presentation for deterministic simulation and inspection. They may expose implementation details needed by developers and must not be treated as production UX patterns.
