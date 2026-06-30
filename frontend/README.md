# Sourcing Console — frontend

The unified operator console, built as a **Vite + React** SPA from the Claude Design
handoff (`../design/unified-operator-console-for-cre-sourcing/`). One page, no routing —
module switching, the Map/Properties/Brokers view toggle, the detail drawer, and the bulk
bar are all in-page state.

## Run

```bash
npm install
npm run dev      # http://localhost:3001
npm run build    # → dist/  (verified: 37 modules, ~205 KB JS)
```

## What's here

- `src/App.jsx` — the shell (top bar + Keep Sourcing + module switcher) **and** the
  Properties module (filter rail, table, brokers table, faux map, detail drawer, bulk bar,
  empty state). Holds all top-level state.
- `src/modules/SupplyModel.jsx` — CoStar supply model with a live new-development calc.
- `src/modules/AICaller.jsx` — call queue + active call + compliance banner + recents.
- `src/modules/DealsDB.jsx` — NL search, cited answer, deals table, dedupe guardrail.
- `src/data.js` — **SAMPLE data only** (synthetic; not real SimiCapital deals).
- `src/css.js` — tiny CSS-string → React-style-object parser, so the design's inline
  styles port near-verbatim. `src/helpers.js` — formatting + shared style fragments.
- `src/index.css` — design tokens (`:root`), dark/light themes, teal/bronze accents.

Interactivity wired: module + view switching, channel + score filtering, live "Keep
Sourcing" simulation, multi-select + bulk bar, drawer, map popups, supply calc, deals
dedupe, theme/accent toggles.

## Before this is production — the wiring punch-list

These are deliberately stubbed (mirrors the design-feedback list):

1. **Real map.** The Map view is a faux CSS grid with pins at hardcoded `x/y`. Swap for
   Leaflet/Mapbox + geocoded `lat/lng` (the on-market backend already geocodes).
2. **Backend data.** Replace `src/data.js` with live calls — properties/brokers from the
   merged store, `Keep Sourcing` → the scrape job queue, `Send to Pipedrive` → the API.
   Add a `server.proxy` block in `vite.config.js` for `/api` etc.
3. **Mark sample data** clearly until real data lands (esp. Deals DB answers).
4. **Auth** before exposing off-market owner PII (the design has none yet).
5. **a11y polish** — the unicode glyph icons (⌕ ◐ ⊘ ›) and placeholder-only inputs should
   move to a real icon set + labels; add focus states.

## Verified

`npm run build` passes clean; a full server-render of `<App/>` mounts with no runtime
errors and all modules present (build + SSR smoke, 2026-06-25).
