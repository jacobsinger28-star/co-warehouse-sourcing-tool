# Migration — staged source assets

Raw code, config, and data copied from the four source projects, ready to be reorganized into the
unified app once the Claude Design UI lands. **Nothing here is the new app yet** — this is staging.

## What came from where

| Folder | Source | Contents |
|---|---|---|
| `offmarket/` | `../../offmarket-scraping` | Off-market pipeline: `lib/ ingest/ transform/ scoring/ sync/ outreach/ imagery/ tools/ db/ markets/ prompts/`, `weights.yaml`, `Makefile`, `requirements.txt`, `docs/`, `DATA_NOTES*`. Postgres/PostGIS, APN-keyed. |
| `onmarket/backend/` | `../../general-scraping/backend` | On-market scraper: FastAPI `main.py`, `database.py` (SQLite), `scrapers/` (crexi, colliers, brokerage, broker_bio, markets), `scorer.py`, `geocoder.py`, `pipedrive.py`, `outreach/`, `email_service.py`, `excel_generator.py`. |
| `onmarket/frontend-reference/` | `../../general-scraping/frontend` | The OLD React UI — kept only as a **feature reference** (filters, columns, LiveSearch, DealMap). The new UI comes from Claude Design; do not build on this. |
| `onmarket/` (Dockerfile, railway.toml) | `../../general-scraping` | Railway deploy reference. |
| `deals-database/` | `../../deals-database` | Deals/LOI archive design + `tools/` (validate/scaffold index) + `data/deal-index.example.csv` + Claude-Project assets. Mostly Stage-0 conceptual. |

## Sensitive data → `../private/` (gitignored, never deploy publicly)

| Path | What | Why protected |
|---|---|---|
| `private/data/onmarket/live_listings.db`, `geo_cache.db` | On-market listings + geocode cache | Real broker emails/phones |
| `private/data/onmarket/columbus_*.csv` | County-record lead exports | Owner names + mailing addresses |
| `private/data/offmarket/exports/` | Ranked leads, contact research, skip-trace, dial-ready CSV/JSON + call sheets | Owner PII |
| `private/data/offmarket/imports/` | Submarket GeoJSON polygons + `land_use_codes.yaml` (config — non-PII, can move to open tree) | staged with the rest for now |
| `private/data/offmarket/Leads.xlsx` | Populated lead workbook | Owner PII |
| `private/columbus-supply-model/` | CoStar supply model (code + xlsx + brief + raw text) | **CoStar/Sabre-licensed — internal only, never distribute** |

## NOT copied (intentionally)

- **`.env` files** — secrets. The only key in use was `PIPEDRIVE_API_TOKEN` (on-market). Off-market
  needs `DATABASE_URL`, `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`, `AIRTABLE_API_KEY`/`_BASE_ID`,
  `PIPEDRIVE_API_TOKEN`/`_DOMAIN` (see `offmarket/.env.example`). Recreate a single `.env` for the
  merged app later.
- Venvs, `node_modules`, `.git`, `__pycache__`, `.pytest_cache`, build output.
- Off-market `exports/` HTML dashboards + `simi-sourcing/`/`vercel_site/` builds (~28M) — the old UI
  being replaced. Only the underlying lead **data** (CSV/JSON) was staged.
- Off-market `image_cache/` (7.5M, regenerable VLM imagery).

## The one real data step still pending

The authoritative off-market data lives in a **local Postgres/PostGIS DB** (`nashville`, with per-metro
schemas), not in files — only CSV snapshots were staged. To migrate it for real:
`pg_dump` each market schema → load into the merged store. (On-market data IS file-based —
`live_listings.db` is complete and staged.)

## Live data wiring — frontend Properties + map (DONE)

The console's **Properties** module (table + brokers + the real Leaflet map) now renders **real**
sourced data instead of the synthetic `frontend/src/data.js` sample.

- **Generator:** `tools/build_real_data.py` (committed, no PII) reads the two upstream stores read-only
  and emits `frontend/public/data.real.json`:
  - off-market → `../offmarket-scraping/exports/map_data.json` (2,296 scored owner leads, APN-keyed,
    100% geocoded; Actionable/Tentative/Pass derived by score rank since the model is 0–100 points,
    not a pre-bucketed label). Carries the real `comp` breakdown → drawer shows genuine sub-scores.
  - on-market → `../general-scraping/backend/live_listings.db` (`listings`, 150 geocoded; national
    brokerage scrape — category + lat/lng + specs, broker contacts currently empty).
- **Output is GITIGNORED** (`frontend/public/data.real.json` — owner/broker PII + licensed fields).
  Rebuild anytime with `python3 tools/build_real_data.py` after re-scraping upstream.
- **Fallback:** `App.jsx` fetches `/data.real.json` at runtime; if absent (fresh clone / public
  deploy) it falls back to the committed synthetic `src/data.js`. The top-bar pill shows
  **"Live data · N"** vs **"Sample data"** accordingly.
- **Map:** `frontend/src/components/DealMap.jsx` — react-leaflet + cluster, ported from
  `onmarket/frontend-reference/src/components/DealMap.jsx`, restyled to the console's tokens
  (clean = CARTO light/dark, satellite = Esri imagery; markers colored by category, clustered).

Still on sample data: Supply Model (uses the real Columbus figures already), AI Caller, Deals DB.

## Before any public push / Railway deploy — scrub list

- Hardcoded internals in code (acceptable in a **private** repo, scrub before any public exposure):
  `onmarket/backend/pipedrive.py` (team Pipedrive user roster + custom-field IDs),
  `onmarket/frontend-reference/src/components/EmailConfig.jsx` (`*@simicap.com` addresses).
- Confirm `/private/` and `.env` stay gitignored (see `../.gitignore`).
