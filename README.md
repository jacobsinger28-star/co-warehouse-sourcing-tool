# SimiCapital Sourcing Platform

The unified internal operator console that merges the firm's separate sourcing tools into **one
single-page app** (no routing — in-page tabs, toggles, and drawers). Destined for Railway.

## Modules (all on one page)

1. **Properties** — combined off-market (county GIS → owner) + on-market (broker listings) universe.
   A three-way **Map / Properties / Brokers** view toggle on one page, all sharing one filter state
   and one selection (the **Brokers table lives here**, not on a separate page). Filter by channel
   (off/on-market), score, market, source, SF, etc.; multi-select → Pipedrive / call queue; detail drawer.
2. **Supply Model** — interactive CoStar market-supply analysis (Columbus v1; re-pointable).
3. **AI Caller** — ranked call queue + dialer + TCPA/DNC compliance + disposition logging.
4. **Deals DB** — plain-English search over past deals/LOIs + the "previously contacted?" dedupe spine.

A persistent top bar with a **"Keep Sourcing"** toggle continuously scrapes both channels at once.

## Source projects being merged

- `../offmarket-scraping` — off-market pipeline (Postgres/PostGIS, scoring, VLM, AI dialer, Pipedrive Leads)
- `../general-scraping` — on-market scraper (FastAPI + React + SQLite, Crexi/Colliers, Pipedrive Deals)
- `../offmarket-scraping/private/columbus-supply-model` — CoStar supply model (Sabre-licensed; internal)
- `../deals-database` — deals/LOI archive + dedupe spine

## Status

- [x] Design prompt for Claude Design → [`design/DESIGN-PROMPT.md`](design/DESIGN-PROMPT.md)
- [x] Generate the UI in Claude Design; export → [`design/unified-operator-console-for-cre-sourcing/`](design/unified-operator-console-for-cre-sourcing)
- [x] Build the frontend (Vite + React SPA) → [`frontend/`](frontend) — all 4 modules wired, `npm run build` + SSR render verified
- [ ] Wire the frontend to a backend API (scrape queue, Pipedrive, real map, auth)
- [ ] Migrate data from both projects into one store
- [ ] Deploy to Railway

See [`design/DESIGN-PROMPT.md`](design/DESIGN-PROMPT.md) for the full prompt + per-module follow-ups.
