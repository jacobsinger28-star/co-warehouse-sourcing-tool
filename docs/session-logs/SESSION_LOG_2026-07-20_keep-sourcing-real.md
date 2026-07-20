# Session Log — 2026-07-20 · Keep Sourcing made real (EasyBay engine revived)

*Goal: make the console's "Keep Sourcing" button actually source, on the Railway deploy.*

## Backstory uncovered

- The button was a **design mockup since the console's first commit** (a `setInterval` bumping
  counters with `Math.random`). The "it used to work" memory was real but belonged to the **old
  repo**: `jacobsinger28-star/co-warehouse-sourcing-tool` was Jacob's **EasyBay Sourcing Tool**
  (created 2026-05-12) — FastAPI + Playwright brokerage scrapers (CBRE/JLL/Cushman/Colliers/
  Newmark/NAI/Crexi) with `/live/scrape|stop|status`, running on this same Railway service.
- The console was pushed over that repo on **2026-07-01**; Railway rebuilt and the working engine
  vanished. Pre-override head `a41d066` ("Allow Tentative deals to be selected and pushed to
  Pipedrive") recovered via `git fetch origin a41d066…` — nothing was lost; the engine also lives
  on (newer) as `general-scraping/backend/`.

## What shipped (commit 0b4a832)

- **`frontend/backend/`** — FastAPI sidecar `live_api.py` + `database.py`/`geocoder.py`/`scorer.py`/
  `scrapers/` ported from general-scraping. Endpoints `/live/scrape` `/live/stop` `/live/status`
  `/live/rows`; listings scored (physical-only), geocoded (Nominatim, cached), upserted to SQLite on
  the **DATA_DIR volume**. `/live/rows` returns console-shaped `{props, brokers}` (same transform as
  `tools/build_real_data.py::load_onmarket`).
- **`server.mjs`** — authed proxy `POST /api/live/:action` (fixed route table, same Supabase-JWT /
  legacy-password gate as `/api/data`, rate-limited). Sidecar binds 127.0.0.1 only.
- **`src/liveApi.js` + `App.jsx`** — Keep Sourcing → real `/live/scrape`; strip + status modal poll
  `/live/status` (3s while running / 60s idle): per-source bars = real per-brokerage counts,
  `+N new` = listings delta since run start, Updated = real job timestamp; Stop → graceful
  `/live/stop`; when a run ends, `/live/rows` refresh **supersedes the baked on-market rows**.
  `SCRAPE_SOURCES` now lists the 7 real scrapers (County GIS strip entry dropped — off-market
  refresh is still a batch pipeline with no HTTP wrapper).
- **`Dockerfile` + `start.sh`** — runtime = `mcr.microsoft.com/playwright/python:v1.44.0-jammy`
  (Chromium baked, matches pinned `playwright==1.44.0`) + NodeSource Node 20; start.sh runs uvicorn
  (internal :8000) + node (on $PORT). `.dockerignore` hardened: `*.db*`, `.env*`, pycache never
  reach the image.

## Verified

- **Local E2E** (sidecar on :8001, node on :8090, Chrome): gate unlock → Keep Sourcing click →
  `POST /live/scrape` → Playwright launched, Cushman scrape stored **4 real listings** (scored
  Tentative w/ reasons, geocoded — e.g. 10923 S Sam Houston Pkwy E, Houston) → strip showed
  **"+4 new"** with the Cush bar filling → Stop → job `status:"stopped"`, `listings_found:4` →
  `/live/rows` returned console-shaped rows. Unauthed `/api/live/*` → 401; unknown action → 404.
- **Production** (after push): Railway deploy successful (~4.5 min); deploy logs show volume
  mounted, `[server] listening on :8080 (auth=supabase+password)` AND
  `Uvicorn running on http://127.0.0.1:8000`; new bundle `index-BifXE_eD.js` served; unauthed
  `POST /api/live/status|scrape` → 401 (fail closed).

## Gotchas / notes

- Local-E2E gate friction: legacy mode checks a hardcoded client-side `PW_HASH` (Gate.jsx) and
  `frontend/.env.local` bakes `VITE_SUPABASE_*` into any local build — test with those blanked and
  a temporary hash swap (reverted before commit).
- greenlet/playwright wheels fail on py3.13 — local test venv used python3.12 + playwright 1.61
  (prod pins 1.44 to match the image's browsers).
- A nationwide run takes a while and only in-metro listings surface in the console (the
  `ALLOWED_MARKETS` filter applies to live rows too); on Railway the volume DB starts empty, so
  baked on-market rows remain until the first real run completes.

## Open

- Off-market channel refresh (county pipeline `make refresh`) still batch-only — no HTTP wrapper.
- Scraper adapters last hardened in June; expect per-site fixes as brokerage sites drift.
- Send→Pipedrive from the console still unwired (needs `PIPEDRIVE_API_TOKEN` server-side).
