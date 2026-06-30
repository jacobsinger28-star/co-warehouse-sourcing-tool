# CLAUDE.md — start here

Orientation for an agent picking this project up cold. Read this first, then
`docs/BUILD_LOG.md` (what's been built + every bug/decision/risk) and `DATA_NOTES.md`
(what the real public data looks like). The canonical list of every tool/key/account/
dataset the project needs (with status + the acquisition checklist) is
`docs/TOOLS_REGISTRY.md`; imagery free-vs-paid detail is `docs/IMAGERY_TOOLS.md`.
**Before you touch shared code (`transform/`, `scoring/`, `lib/`) or add a market, read
`docs/TEST_ARCHITECTURE.md`** — it's the spec for how the suite stops agent sessions from
silently overriding each other. Layers 0–3 are now BUILT (CI ratchet, market contract,
ledger invariants); Layer 4 (golden DB) + the local Stop hook are the remaining gaps.
Last updated 2026-06-24.

## What this is
Automated pipeline that surfaces **off-market industrial properties** (75k+ SF
warehouses, vacant / neglected / motivated owners) in Davidson County, TN for a
cowarehousing acquisition play, and ranks them into a **call queue**. Output is a
phone list + call sheets — no mailers. Vacancy is inferred from imagery (VLM), never
from listing sites; anything on Crexi/LoopNet is deliberately excluded. Built to be
re-pointable at other markets later.

The full original spec is `docs/ENGINEER_BRIEF.md`; founder dependencies/deadlines are
`docs/FOUNDER_INPUTS.md`. Those are the contract. **But the brief was written against a
stale data layer — read DATA_NOTES.md for the three corrections before trusting it.**

## Stack
Python 3.13 · Postgres + PostGIS (local now, Supabase later) · ArcGIS Hub feature
services (parcels, CAMA, violations, permits — NOT Socrata) · Claude vision API (VLM via
the Chrome-extension human-VLM path; API-key VLM still a stub) · Pipedrive (CRM/Leads) ·
Airtable (still a stub) · GitHub Actions weekly cron.

## How to run it (local dev)

**1. The database is a local Postgres.app server that must be started manually** (it's
a GUI app; start its server without the GUI):
```bash
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
pg_ctl -D "$HOME/Library/Application Support/Postgres/var-11" -o "-p 5432" \
       -l /tmp/pg_nashville.log -w start      # PostgreSQL 11, PostGIS 2.5
pg_isready -p 5432                            # expect: accepting connections
```
Database is `nashville`; connection string in `.env` is
`postgresql://razkorteran@localhost:5432/nashville` (trust auth, no password).
Schema lives in `db/migrations/00{1,2,3,4}_*.sql` and is already applied + re-runnable.

**2. Python deps are in a venv** (`.venv`). Run everything through it:
```bash
.venv/bin/python -m pytest tests/ -q          # full suite (hermetic + DB tiers)
make test-fast                                # hermetic tier only (no DB) — the CI ratchet
make refresh                                  # full pipeline (uses .venv via Makefile PYTHON)
```

**3. Key make targets:** `refresh` (full pipeline), `test`, `dashboard` (local HTML
viewer → `exports/dashboard.html`), `dashboard-review` (shareable feedback copy).

## Repo map
```
lib/        config.py (weights/landuse loaders) · sources.py (confirmed ArcGIS endpoints)
            db.py (connection + JobRun observability) · arcgis.py (REST client, POST+paging)
            normalize_text.py (owner/entity/address parsing — pure, tested)
ingest/     pull_parcels.py · pull_violations.py · pull_permits.py · import_csv.py
            (Trustee tax + SOS contacts + lis-pendens CSV loaders)
transform/  normalize.py (entities/portfolios) · build_universe.py (gates)
scoring/    rules.py (PURE scoring engine, weights-driven, tested) · score.py (DB wrapper)
imagery/    fetch_images.py · vlm_score.py        — STUBS (need API keys)
sync/       airtable_sync.py                       — STUB (needs keys)
outreach/   skiptrace_export.py · skiptrace_import.py · call_sheets.py (built + tested)
tools/      discover_sources.py (re-verify live ArcGIS schema) · make_dashboard.py
db/migrations/  001 schema · 002 staging+universe cols · 003 distress staging+fixes · 004 outreach
weights.yaml    founder-editable scoring config (no weight is hardcoded in Python)
exports/        ranked CSVs + dashboards (gitignored — contains owner PII)
```

## Current status (2026-06-24)
**The live status of record is `docs/BUILD_LOG.md` (most-recent §) — this is a high-level pointer,
not a frozen snapshot.** In short, far past the original Day-2 plan:
- **6 markets** built — Nashville, Charlotte, Columbus, Cleveland/Cuyahoga, Cincinnati/Hamilton,
  Charleston — aggregated into ONE unified ranked dashboard + interactive map (live on Vercel,
  password-encrypted). Owner-contact enrichment live for Nashville/Charlotte/Columbus.
- Two test tiers — hermetic (`make test-fast`, no DB) + a small DB tier (`make test-db`).
  Test architecture Layers 0–3 built (CI ratchet, market-contract, ledger invariants) —
  `docs/TEST_ARCHITECTURE.md`.
- Cross-market ranking is fair (per-market reachable ceiling + blended rank — HEALTH_AUDIT §A1).
- Pipedrive Leads sync built; AI-dialer + call sheets built (stub-safe by default — no real calls
  placed without an explicit non-stub provider). Imagery vacancy via the Chrome-extension VLM path.

**Not built / blocked:** the API-key VLM and Airtable remain honest stubs; a real skip-trace *run*
needs a BatchSkipTracing account. **Open backlog:** `docs/HEALTH_AUDIT_2026-06-18.md` (21 findings,
several fixed) + `docs/TEST_ARCHITECTURE.md` Layer 4 + the local Stop hook.

## What's needed from the founder to unblock
**Canonical, always-current list → `docs/TOOLS_REGISTRY.md`** (status + costs + end-of-day
acquisition checklist). In short: `GOOGLE_MAPS_API_KEY` · `ANTHROPIC_API_KEY` ·
`AIRTABLE_API_KEY`+`AIRTABLE_BASE_ID` (all go in `.env`) · the Trustee delinquent-tax CSV
(`imports/trustee_delinquent.csv`) · top-100 A/B/C grades for score calibration · optionally
real submarket polygons. Paid-tool options + free imagery sources: `docs/IMAGERY_TOOLS.md`.

## Conventions / gotchas (don't relearn these the hard way)
- **Share on green (standing rule).** After ANY change that builds and passes `make test`,
  run **`make share`**: it rebuilds the unified review dashboard and refreshes
  `exports/vercel_site/index.html` + the DB-free snapshot. This is LOCAL only — nothing leaves
  the machine — so it's safe to do automatically. `make share` depends on `test`, so a red
  suite aborts before anything is rebuilt. **The actual upload is a separate, deliberate human
  step: `make deploy`** (or `make publish` = share+deploy). Deploy sends the dashboard's owner
  PII to Vercel (external host, marked internal/do-not-publish), so it must NOT be wired into an
  auto-hook and the agent must not run it without the user's explicit go-ahead each time.
  One-time Vercel link + password gate: `exports/vercel_site/DEPLOY.md`.
- **One dashboard, all cities.** `tools/make_dashboard.py` aggregates EVERY built market
  (markets/*.yaml whose schema has universe rows) into a single file with a City column +
  filter — never one file per market. A market with no rows yet (e.g. Columbus pre-build) is
  auto-skipped, so the same command yields more cities as they land.
- **No ★ on the map. Ever.** The gold "industrial core" anchor marker was removed permanently
  (founder, 2026-06-20 — BUILD_LOG §29). Do NOT re-add a per-market star/anchor marker to
  `tools/make_map.py`. Proximity scoring uses the per-row `distance_miles_icbd` column, not a
  map centroid, so nothing needs it.
- **No weight is hardcoded** — all scoring numbers come from `weights.yaml` via `lib/config`.
- **Scoring math lives only in `scoring/rules.py`** (pure, no I/O). `score.py` just feeds it.
- **ArcGIS, not Socrata.** Use `lib/arcgis.py` (it POSTs — batched `IN(...)` queries 404 on GET).
- **building_sf = SUM of all buildings on the parcel** (founder decision); `building_sf_largest`
  + `building_count` are stored alongside. See `docs/BUILD_LOG.md` §3.
- **Migrations must stay re-runnable** (they get applied to Supabase later) — guard `ADD CONSTRAINT`.
- **Permits feed only goes back ~3 years**, not 10 — the `no_permits_10yr` signal is weaker
  than its weight assumes. Top open risk; see BUILD_LOG §4.
- `exports/`, `.env`, `image_cache/`, the Trustee CSV are **gitignored (PII)** — never commit them.

## If you MOVE or re-clone this project
- `.venv` has absolute paths baked in → **recreate it**: `python3 -m venv .venv &&
  .venv/bin/pip install -r requirements.txt`. (Exception — an *in-place* folder move on the
  same machine doesn't need a recreate: `.venv/bin/python` is a symlink to the absolute
  interpreter and everything runs via `python -m`, so only the console-script shebangs in
  `.venv/bin/*` + `pyvenv.cfg` need their old path rewritten to the new one. See BUILD_LOG §6a.)
- `.env` is gitignored → **recreate it** (see `.env.example`); for local dev, the DATABASE_URL above.
- The Postgres **data lives outside the repo** (`~/Library/Application Support/Postgres`),
  so the DB and its 2,301 rows survive a project-folder move untouched. Just restart the server (step 1).
- **Git:** active development on `master` (run `git log` for history). Recent test-architecture
  + cross-market-ranking work landed on branch `test-arch-layers-0-3`. Commit when the founder
  gives the word; nothing is auto-pushed.
