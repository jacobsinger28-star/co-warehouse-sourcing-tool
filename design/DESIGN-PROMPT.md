# Claude Design Prompt — SimiCapital Sourcing Platform

> The unified internal operator console that merges five tools into ONE single-page app:
> off-market sourcing · on-market broker listings · CoStar supply model · AI caller · deals database.
> This file is the input for **Claude Design**. Paste **Prompt A** first to generate the shell +
> hero screen, then use the per-module follow-up prompts to flesh out each tab.

---

## How to use this

1. Paste **Prompt A — Master shell + Properties** into Claude Design. That produces the full app
   chrome (top bar, Keep-Sourcing control, module switcher) with the **Properties** module active,
   showing both the table and the map toggle.
2. Then run each **Module follow-up prompt** ("keep the same shell, now show the X module") to design
   Supply Model, AI Caller, and Deals DB on the identical shell. (Brokers is NOT a separate module —
   it's a third view *inside* the Properties page, designed in Prompt A.)
3. Iterate per screen. Keep the **Visual System** (bottom of this file) constant across all of them.

Design goal in one line: an **institutional-CRE deal terminal** — Blackstone / Prologis / Bloomberg,
not a consumer-SaaS startup. Dense, refined, dark-first, every pixel is working data. No marketing fluff.

---

## Prompt A — Master shell + Properties (paste this first)

```
Design a single-page internal web application — an "operator console" — for a commercial real estate
firm that acquires industrial/warehouse buildings. It unifies five tools into ONE screen with NO page
reloads and NO routing: the user switches modules and views using in-page toggles, tabs, and side
drawers only. Desktop-first, data-dense, used daily by a few internal analysts (not customers).

VISUAL DIRECTION: institutional CRE deal terminal — think Blackstone / Prologis / a Bloomberg-style
trading screen. Dark-mode first (deep charcoal/navy surfaces ~#0E1116, hairline borders, restrained).
One refined accent color (muted bronze-gold OR cool teal — pick one) used sparingly for the primary
action and the live "sourcing" state. Clean grotesk sans (Inter/Geist) with tabular/monospaced
numerals for SF, $, and scores. Tight, scannable tables. NOT a marketing site: no gradient hero, no
playful illustrations, no rounded pastel cards.

GLOBAL TOP BAR (always visible):
- Left: wordmark "SimiCapital · Sourcing" and a multi-select market/metro selector
  (Nashville, Charlotte, Columbus, Cleveland, Cincinnati, Charleston, Raleigh, Miami, Boca Raton,
  West Palm Beach; default "All markets").
- Center/right: a prominent PRIMARY "Keep Sourcing" button. It is a toggle — when ON the app
  continuously scrapes new properties from BOTH channels at once (off-market county GIS + on-market
  broker listings). When running, it becomes a live status pill with a pulsing dot:
  "Sourcing… 1,847 properties · +12 new" plus a thin per-source progress strip
  (County GIS · Crexi · Colliers · CBRE · JLL · Cushman) and a Stop control + "last updated 2m ago".
- Far right: global search (address / owner / broker / APN) and a user avatar.

PRIMARY MODULE SWITCHER (segmented control, in-page, no routing — switching is instant and preserves
state): Properties · Supply Model · AI Caller · Deals DB.

ACTIVE MODULE = PROPERTIES (design this in full detail):
A single combined universe of OFF-MARKET owner leads AND ON-MARKET broker listings in one place.
Layout = a persistent LEFT FILTER RAIL + a main content area with a THREE-WAY view toggle in the
content's top-right: Map / Properties / Brokers. All three are the SAME page sharing the SAME filter
rail and selection state — switching between them happens IN PLACE, never a reroute or page change.

SHARED FILTER RAIL (applies identically to map and table):
- Channel: Off-market / On-market / Both (segmented; the two channels keep a consistent color + icon
  everywhere — badges, pins, chips).
- Score: chips Actionable (green) / Tentative (yellow) / Pass (red), plus a 0–100 distress-score
  range slider for off-market.
- Market / metro · State · Source (County GIS, Crexi, Colliers, CBRE, JLL, Cushman, Newmark, NAI).
- Building SF range (50k–300k) · Clear height (≥ ft) · Year built · Zoning (industrial).
- Owner type (LLC / trust / individual) · Out-of-state owner (off-market) ·
  Signals: tax-delinquent, code violations, inferred-vacant (off-market).
- Has owner contact / Has broker contact · free-text search.
- Footer: "847 of 1,847 match" live count + "Clear all".

MAP VIEW: clustered pins on a clean/satellite basemap, colored by score category and badged by
channel (off vs on look different). Click a pin -> an inline popup with the key facts + the same row
actions (never navigates away). A map selection reflects in the table.

TABLE VIEW (Properties): dense, sortable, with whole-row tint by score category (subtle
green/yellow/red). Columns: [select checkbox] · Channel badge · Address · Market · SF · Score
(category chip + numeric) · Key signal · Owner (off-market) / Broker + firm (on-market) ·
Asking $/SF (on-market) · Year built · Contact status · Actions. Multi-select reveals a sticky bottom
action bar: "Send N to Pipedrive", "Add N to AI call queue". Clicking a row opens a RIGHT-SIDE DETAIL
DRAWER (in-page, no reroute) with the full property record: address, owner-on-title + mailing address +
out-of-state flag, building SF / year / clear height, score breakdown by component, distress evidence,
imagery if any, and contact actions.

BROKERS VIEW (the third toggle — same page, same left filter rail, NO reroute): a dense table of the
listing brokers harvested from the on-market scraping, sitting right alongside the property table.
Columns: [select checkbox] · Broker name · Firm / brokerage · Phone · Cell (highlighted) · Email ·
Market(s) · Specialty · # active listings · Source · Pipedrive status (synced / not) · Actions
(Send to Pipedrive as a Person · Add to call queue · "View their listings" which flips back to the
Properties table filtered to that broker). Same multi-select + sticky bulk-action bar ("Send N to
Pipedrive"). The shared filter rail still applies (market, source/firm, has-cell, search).

Use REAL industrial-CRE example data (the metros above, 50k–300k SF buildings, the green/yellow/red
score categories, owner LLCs for off-market rows and broker names + brokerages for on-market rows) so
it reads like a real product — do not use generic lorem placeholders.

Deliver the dark theme as primary. Make the Properties table the default visible view and clearly show
the three-way Map / Properties / Brokers toggle (all sharing the one filter rail), the multi-select
action bar, and the detail drawer.
```

---

## Module follow-up prompts (run each after Prompt A — "same shell, switch the active module")

> Note: the **Brokers** table is NOT a module here — it's the third view on the Properties page
> (Map / Properties / Brokers), already specified in Prompt A.

### Supply Model (CoStar)
```
Same app shell. Now show the SUPPLY MODEL module — an interactive CoStar market-supply analysis
(currently Columbus, built to re-point at any market). Tag it "Internal · CoStar-licensed".
Top KPI stat cards: Total existing supply 9.83M SF · 99 buildings · metro vacancy 6.2% · avg rent
$8.40/SF. A submarket breakdown (horizontal bars or treemap): Hilliard 57% · SW Columbus 17% ·
Downtown West 16% · Grandview 9%. A "New Development Impact" panel: inputs for a building's SF and a
submarket dropdown, with a live readout — e.g. "250,000 SF = +2.5% of metro supply, +4.4% of Hilliard".
A market selector at the top. Same dark deal-terminal styling, tabular numerals.
```

### AI Caller
```
Same app shell. Now show the AI CALLER module — the outreach cockpit. Three regions:
(1) a ranked CALL QUEUE list (address · owner · phone · score · last disposition),
(2) an ACTIVE-CALL card: the number being dialed, the AI-disclosure opener shown as text, a live
    transcript area, and disposition buttons (Warm · No answer · Not interested · Do-not-call),
(3) a RECENT CALLS log with dispositions.
Put COMPLIANCE state front and center: "DNC-checked ✓", a TCPA calling-window indicator, a
"100 calls / run cap", and a clear "Stub-safe — no live calls without an active provider" banner.
Warm dispositions note that they create a Pipedrive follow-up task. Restrained, serious styling — this
is legally sensitive, not a flashy autodialer.
```

### Deals DB
```
Same app shell. Now show the DEALS DB module — a search-first memory of past deals and LOIs.
A large plain-English search/chat box with example queries as ghost text ("Have we ever LOI'd this
owner?", "What did we offer on Park Ave in 2022?", "List every deal we passed on for cap rate").
Below it: an answer area that responds with citations to source documents, and a structured results
table: Deal · Property (address/market) · Owner / principal · Our offer (LOI) · Cap rate · Status ·
Why passed · Date · Relationship owner. Plus a compact "Dedupe check" widget: enter an owner or
address -> "Previously contacted? yes / no · when · outcome · who" (the guardrail the sourcing engine
calls before any outreach). Internal/confidential tone; nothing auto-sends.
```

---

## Visual System (keep constant across every screen)

- **Theme:** dark-first. Surfaces ~#0E1116 / #151A21; hairline borders ~#232A33; primary text near-white,
  secondary muted gray. Provide a light variant but lead with dark.
- **Accent:** ONE refined accent (muted bronze-gold or cool teal) for the primary action + the live
  "sourcing" state only. Never rainbow.
- **Channel coding:** off-market vs on-market each get a fixed hue + icon, used consistently in badges,
  map pins, filter chips, and the channel toggle.
- **Score coding:** green (Actionable) / amber (Tentative) / red (Pass) — as subtle row tints and small
  chips, never loud fills.
- **Type:** Inter / Geist; **tabular/monospaced numerals** for SF, $, %, and scores. Two weights only.
- **Density:** Bloomberg-terminal tight; generous spacing only where it aids reading.
- **Component kit:** segmented controls · chips · sticky bulk-action bar · right-side detail drawer ·
  KPI stat cards · live status pill with pulsing dot · thin per-source progress strip · clustered map.
- **States to show:** sourcing-in-progress (live) · loading skeletons · empty · selected-rows.

## Hard constraints (do NOT violate)

- **No routing / no page reloads.** Module switching, Map/Table, broker drill-in, and detail views are
  all in-page (tabs, toggles, drawers).
- **Map and table share ONE filter state and ONE selection state.**
- **Internal operator tool, not a marketing site or a customer app.**
- **Use real SimiCapital data shapes** (industrial CRE, the listed metros, 50k–300k SF, the score
  categories, the CoStar numbers, owner LLCs vs broker names) — not generic placeholders.

## Data appendix (real values to seed the mock)

- **Markets:** Nashville · Charlotte · Columbus · Cleveland · Cincinnati · Charleston (off-market);
  Charlotte · Raleigh · Charleston · Columbus · Miami · Boca Raton · West Palm Beach (on-market).
- **Sources:** County GIS / ArcGIS (off-market) · Crexi · Colliers · CBRE · JLL · Cushman · Newmark · NAI.
- **Buy box:** industrial, ~50k–300k SF, clear height ≥ ~14–24 ft, industrial zoning, dock/grade doors.
- **Scores:** Actionable / Tentative / Pass (qualitative buy-box) + 0–100 distress score (off-market).
- **CoStar (Columbus):** 9.83M SF total, 99 buildings, vacancy 6.2%, rent $8.40/SF; Hilliard 57% /
  SW Columbus 17% / Downtown West 16% / Grandview 9%; 250K SF build = +2.5% metro / +4.4% Hilliard.
- **CRM:** Pipedrive — off-market pushes owner Leads; on-market pushes broker Deals + Person.

---

## Fixes — refinement pass (paste into Claude Design with the console open)

Follow-up prompt addressing the design-review findings. Covers only mockup-addressable fixes
(real map view · "Sample data" markers · one icon set · focus states + labels · lock to one accent ·
responsive min-width). Tooling/handoff feedback is intentionally excluded — re-prompting can't change it.

```
Keep the existing SimiCapital Console design and visual system intact — the dark institutional CRE operator console, #0E1116 surfaces, Inter + JetBrains Mono, the 52px top bar, the 4-module switcher (Properties · Supply Model · AI Caller · Deals DB), the Properties Map/Properties/Brokers view toggle sharing one filter rail, the detail drawer, the bulk-action bar, and the "Keep Sourcing" live status pill. Do not redesign the layout, restructure the modules, or change the type or spacing scale. Apply exactly these six refinements, each tied to its existing location:

1. MAP VIEW — make it read as a real map, not a CSS grid with hardcoded pins. The Map view (the isMapView block) currently renders a flat tinted basemap (mapBgStyle / mapGridStyle) with circular markers absolute-positioned at hardcoded left:X% / top:Y% from each property's x/y. Replace the faux grid with a believable stylized basemap: in "Clean" mode a muted dark cartographic vector basemap — a soft land/water split, a faint coastline or waterway, low-contrast road/highway lines thinning toward the edges, sparse block/parcel hairlines in denser areas, and 3–4 small muted place labels (e.g. "Charleston", "Columbus", "Charlotte") in the existing --text3 tone; in "Satellite" mode a darkened muted aerial texture with the same labels in a lighter halo. Keep the existing Clean/Satellite toggle (top-left pill) working and keep the legend card (top-right). Add the standard map chrome the eye expects: a small "+ / −" zoom stack and north indicator in a bottom-right control plus a tiny scale bar ("2 mi"), all non-functional but visually correct. Redesign the markers so channel is shape-encoded and score is color-encoded: off-market = a hollow ring/outline marker, on-market = a filled teardrop/pin marker, both colored by score (Actionable green / Tentative amber / Pass red), each with a subtle drop shadow or pointer tail so it sits "on" the map rather than floating; distribute them at geographically plausible positions clustered near their city labels rather than evenly scattered, and cluster bunched markers into a count bubble (e.g. "6", "12") at lower zoom. On hover, lift the marker and show a small tooltip with address + score; on click, open the existing bottom-left popup card (hasPopup) with its current content and styling; the selected marker gets an accent focus ring. Pin a small explicit caption in a low-emphasis corner of the map (e.g. bottom-center or bottom-right, --text3, ~10–11px): "Preview map — live Leaflet/Mapbox map on implementation", so it unmistakably reads as a stand-in, not a literal pixel target.

2. SAMPLE DATA markers — the content reads as real records, especially the Deals DB answer ("We submitted a $7.1M LOI at a 7.2% cap… 1450 Meeting St…") and the deals table. Add three subtle but unambiguous "sample" markers: (a) a small "Sample data" pill in the global top bar (muted styling — --surface2 / --text2 with a hairline border — placed near the wordmark or beside the "JS" avatar so it's visible across modules); (b) an inline "sample" tag on the Deals DB answer card (the dealsAnswered card with the accent-line border, next to the uppercase "Answer" label); and (c) a "sample" tag in the Deals DB deals-table header (the table with DEAL / OWNER / OUR LOI / CAP / STATUS columns). Keep them quiet and consistent — small uppercase label/mono tone, not loud.

3. ICONS — replace every unicode glyph with one consistent monochrome line-icon set (Lucide or Phosphor style), drawn as inline SVG at ~13–15px, 1.5px stroke, no fill, currentColor, sized to match the dense terminal look with uniform stroke weight and optical size. Replace specifically: the search ⌕ in the top-bar search and in the Deals DB search (search/magnifier icon); the theme toggle ◐ (sun/moon icon); the empty-state ⊘ (slash-circle / filter-off icon); the table row chevron › (chevron-right); the out-of-state owner flag ⚑ in the drawer (flag icon); the AI Caller compliance-banner ⚠ (alert-triangle); the markets-button caret ▼ (chevron-down); and the ✕ close buttons in the popup, drawer, and bulk bar (x icon). Also swap the inline ✓ checks (DNC-checked, "Synced ✓") and the ↳ source-citation arrows in the Deals answer card for matching line icons. None should fall back to a system glyph.

4. ACCESSIBILITY — add a visible 2px keyboard-focus ring in the accent color (--accent) with a small offset, clearly distinct from hover, on every interactive element (buttons, the module switcher and view toggles, channel/score chips and segmented controls, checkboxes, selects, text inputs, table rows, map markers and map controls, disposition buttons, and the drawer/popup/bulk controls), visible in both dark and light themes. Give real visible labels or aria-labels to every icon-only and placeholder-only control: the top-bar search input, the Deals DB search input, every filter-rail select (Market, Source, Owner type), the Supply Model market/submarket selects, the markets-menu button, the theme toggle, the map Clean/Satellite and zoom controls, and the icon-only ✕ close buttons. Where layout already has room (e.g. above the rail selects), add a small visible field label; elsewhere add an aria-label.

5. ACCENT — lock to a single accent. The design currently ships a runtime teal/bronze toggle via the data-accent prop and the [data-accent="bronze"] override block. Remove the bronze option entirely: keep TEAL (--accent:#2EA6A0 and its --accent-dim / --accent-line variants) as the one and only accent, delete the [data-accent="bronze"] CSS block, and remove the accent enum from the prop schema so there is no bronze switch anywhere. Leave the dark/light theme toggle as-is.

6. RESPONSIVE — keep the desktop layout primary and unchanged at the top tier, but make the console genuinely usable, native-feeling on tablet and phone. Use three fluid tiers with concrete breakpoints and as few layout-mode jumps as possible: DESKTOP at ≥1180px, TABLET from 768–1179px, PHONE at <768px. Within each tier everything is fluid (percentages/flex/minmax, never fixed pixel widths that overflow); the named transforms only happen as you cross a breakpoint. Preserve continuity — a region should change form at most once per step down, and scroll position plus selection state must survive a tier change. Tie all three tiers to the same components: reuse the existing detail drawer as the phone full-screen sheet, the existing filter-rail contents as the tablet slide-over and phone bottom sheet, and the existing toggles/segmented controls rather than introducing new ones.

DESKTOP (≥1180px) — keep the current design exactly as specified, unchanged in proportion and behavior. This is the reference layout. The old hard ~1180px min-width / ~1100px breakage is gone, but at and above 1180px nothing changes. Top bar (52px), module switcher (42px), the 256px Properties filter rail, the 430px right detail drawer, the 300/center/300 AI Caller columns, the Supply Model 4-KPI row + 2-column grid, and the Deals DB wide table + 280px dedupe sidebar all keep their current widths and behaviors; the content areas between fixed elements flex.

TABLET (768–1179px) — same overall shell, denser, with as few mode jumps as possible.
- TOP BAR: stays one row at 52px but tightens. The wordmark drops the "· Sourcing" suffix (keep "SimiCapital"). The market/metro multi-select collapses to a compact dropdown button showing "Markets (N)" instead of inline chips. The "Keep Sourcing" toggle keeps its full live-status pill (pulsing dot + Stop) but the per-source progress strip compresses to a single aggregate progress bar with an "N sources" count, the per-source breakdown moving into a tap-popover. The search input shrinks toward ~160px. Theme toggle and avatar stay.
- MODULE SWITCHER: the 4-tab segmented control stays full-width and visible with labels intact (they fit). The off/on-market legend stays on the right as two small dots with counts only (full legend in an "i" popover).
- PROPERTIES filter rail: the 256px left rail is no longer persistent — it collapses to an overlay. Show a "Filters (N)" button at the top-left of the content area; tapping it slides the rail in from the left as a left-anchored overlay panel (~256–300px, same controls, scrollable) over a scrim, with the "N of 1,847 match" footer pinned at its bottom and a Done/X to dismiss. The content area now uses the full width.
- PROPERTIES tables (Properties + Brokers): STAY TABULAR — do not card them yet. Reduce to the ~6 most important columns (Properties: name/address, market, SF, score, distress signal, owner-type; Brokers: name, firm, market, active listings, last contact); move the rest behind a per-row expand chevron or the detail drawer. Horizontal scroll on the table itself is acceptable here with the first column (name/address) sticky; keep row density. The Map/Properties/Brokers toggle stays.
- PROPERTIES Map view: stays full-bleed; floating controls collapse into a single control-cluster button that expands on tap; the bottom-left popup card stays but caps its width to ~70% of viewport.
- PROPERTIES drawer: the 430px right detail drawer narrows to ~min(430px, 60vw) and overlays the content from the right with a scrim (it no longer coexists with a visible rail). Closing returns to the table with selection intact.
- BULK-ACTION BAR: stays floating bottom-center, full set of actions, slightly narrower/wider as space allows.
- SUPPLY MODEL: the 4 KPI stat cards reflow from one row to a 2×2 grid. The submarket-bars | calculator grid stays 2-column with the calculator as the narrower column; if it gets tight, stack to bars on top, calculator below.
- AI CALLER: the 3-column grid becomes 2-column — the center active-call pane (number, AI-disclosure opener, live transcript, disposition buttons) stays prominent in the main area; the call queue and recent calls collapse into a single right column as two stacked, independently-scrolling collapsible sections (or a small Queue/Recent 2-tab toggle). The compliance banner stays full-width on top.
- DEALS DB: search box + example chips and the answer card stay full-width. The deals table keeps the tabular ~6-column reduction + sticky first column + horizontal scroll as above; the 280px dedupe-check sidebar moves below the table as a full-width "Dedupe check" panel (or stays a narrow right column only if space comfortably allows ~6 columns).

PHONE (<768px) — restructure into native-app patterns; single column throughout.
- MODULE SWITCHER becomes a FIXED BOTTOM TAB BAR (4 tabs: Properties · Supply · Caller · Deals) with icon + short label, ~56px tall, bottom safe-area inset, active tab highlighted. It replaces the top segmented control entirely. The off/on-market legend moves into the Properties view itself as small inline dots above the list.
- TOP BAR collapses to a slim ~48px single row that never wraps: left = compact wordmark "SimiCapital"; right = a cluster of icon-only controls — a search icon (opens a full-width search overlay), a "Keep Sourcing" status icon (pulsing dot when running; tap opens a sheet with the status pill, aggregate progress, per-source breakdown, and Stop), theme toggle, and an avatar/overflow (tap → account sheet holding theme + account). The market/metro multi-select moves out of the top bar: on Properties it lives inside the Filters sheet; elsewhere it's reachable from the account/overflow sheet.
- PROPERTIES tables (Properties AND Brokers): become TAP-FRIENDLY STACKED CARDS, never horizontal scroll. Each card shows the address/name as a bold title, an off/on-market channel tag, the score chip, and 2–3 key facts as label:value pairs (Properties: market · SF · owner-type; Brokers: firm · active listings · last contact), with a right chevron. Keep the list virtualized for density. Tapping a card opens the detail as a FULL-SCREEN SHEET (the existing right drawer at 100vw/100vh) that slides up, with its own back/close header and all columns/fields stacked vertically inside; closing returns to the exact scroll position + selection.
- PROPERTIES views toggle: the Map/Properties/Brokers 3-way toggle becomes a compact segmented control pinned just under the top bar.
- PROPERTIES Map view: full-bleed/full-screen between top bar and bottom tab bar; floating controls shrink to a single stacked control cluster; the bottom-left popup card becomes a bottom sheet that rises above the tab bar when a pin is tapped.
- PROPERTIES filter rail: becomes a "Filters (N)" button (with active-count badge) that opens a full-height BOTTOM SHEET containing all rail controls (channel segmented, score chips, distress slider, market/source selects, SF/clear-height/year, owner-type, signal checkboxes) with a sticky "Apply / Clear" footer and the live "N of 1,847 match" count in that footer. Active filters also surface as removable chips above the list so users can clear them without reopening the sheet.
- BULK-ACTION BAR: on multi-select it becomes a FULL-WIDTH STICKY BOTTOM BAR sitting directly above the tab bar — selection count + the 2–3 primary actions, the rest behind a "More" overflow; it temporarily covers/replaces the tab bar area while a selection is active.
- SUPPLY MODEL: the 4 KPI stat cards become a single vertical stack of full-width cards (or 2×2 if they stay legible); the submarket bars and the new-development calculator stack vertically, bars first, calculator below, each full-width with thumb-sized, full-width inputs.
- AI CALLER: the 3 columns collapse to a SINGLE-COLUMN stack with a Queue / Active / Recent sub-tab strip directly under the compliance banner, showing ONE pane full-width at a time. Active is the default tab and holds the number, the AI-disclosure opener, the full-height scrollable live transcript, and the disposition buttons pinned as a sticky bottom action row (above the tab bar). The compliance banner stays pinned at the top, condensed to one line with tap-to-expand.
- DEALS DB: single-column stack — search box + example chips at top (chips become a horizontal snap-scroll row), then the full-width answer card, then the deals table as the same STACKED-CARD pattern as Properties (deal name + status tag + 2–3 key-term facts + chevron → full-screen detail sheet), then the dedupe-check as a collapsible "Dedupe check" accordion below the results (or a small "possible duplicate" flag inline on each card).
- GENERAL PHONE RULES: all primary tap targets ≥44px; sheets (detail, filters, status, search, account) are full-width, dismissible by swipe-down or a close chevron, trap focus, and never trap scroll; respect top notch and bottom safe-area insets; only one overlay/sheet open at a time.

CROSS-CUTTING: never allow a dense table to force horizontal page scroll on phone (cards only) — table-level horizontal scroll is permitted only on tablet with a sticky first column. Keep all primary actions reachable without horizontal scrolling; tap targets ≥44px on tablet/phone; all overlays (rail, drawer, sheets) have a scrim + explicit close. The four modules stay reachable from the switcher at every tier. At and above 1180px the desktop layout and proportions remain exactly as originally specified.
```

