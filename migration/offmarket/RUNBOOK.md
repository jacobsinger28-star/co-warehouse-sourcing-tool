# RUNBOOK

Operational guide. Fills in as stages land. Today it covers what exists (Day 1).

## Prereqs
- Python 3.11+ and `pip install -r requirements.txt`
- A Postgres+PostGIS database. Two options (decision pending):
  - **Supabase** — set `DATABASE_URL` in `.env`, enable the `postgis` extension.
  - **Local** — Postgres.app is installed; `createdb nashville && psql nashville -c 'CREATE EXTENSION postgis;'`
- `.env` filled from `.env.example`.

## Apply the schema
```bash
psql "$DATABASE_URL" -f db/migrations/001_schema.sql
```

## Sanity-check the data sources (no DB, no keys)
```bash
python tools/discover_sources.py          # field lists + counts from live ArcGIS
python tools/discover_sources.py --fields-only
```

## Run the scoring tests
```bash
pytest tests/ -v
```

## Full pipeline (once ingestion lands)
```bash
make refresh        # pull → normalize → universe → score → images → vlm → score → sync
make test
```

## Local dashboard (read-only viewer)
```bash
make dashboard                  # regenerates exports/dashboard.html from the DB
open exports/dashboard.html     # opens in your browser — no server needed
```
Also regenerated automatically at the end of every `make refresh`. The file contains
owner names/addresses and distress evidence — it lives in gitignored `exports/`;
do not publish it to any public URL. The Airtable board (Day 8) is the working
surface for grading and call dispositions; this viewer is for browsing and QA.

## Shareable review copy (send to colleagues for feedback)
```bash
make dashboard-review           # -> exports/dashboard_review.html
```
Same data as the dashboard, plus: a feedback banner framing the ask, per-row
Good fit / Unsure / Not a target buttons + a notes box, and a "Download my feedback"
button that exports the reviewer's marks as a small CSV to email back. Marks persist
in the reviewer's browser (localStorage) so they can stop and resume. Fully offline —
colleagues just double-click the file; nothing is sent anywhere automatically.
- To collect: each reviewer emails back their `feedback_<name>.csv`. Drop them in
  `imports/` and they can later seed score calibration / a "human says not a fit" flag.
- Same PII warning applies — it lists owner names + addresses. Send over a trusted
  channel; if your mail server blocks .html attachments, zip it first.

## Founder-facing commands (later days)
```bash
make skiptrace-export                    # A-tier owners → CSV for BatchSkipTracing
make skiptrace-import FILE=exports/...    # phone numbers back into contacts
make call-sheets                         # per-property dial sheets
```

## QA gates to run before trusting output (brief §9)
1. Universe row count ~150–1,200.
2. 20-row founder spot check ≥90% real industrial.
3. Zero duplicate APN, zero null geometry.
4. building_sf vs footprint mismatch >40% → flagged, never silently included.
5. Violation join rate ≥70% (we join on APN — expect higher); hand-check 10.
6. Every `distress_signals` row has a `source_ref` (DB constraint enforces it).
7. `pytest` green: gates + score-sum invariants.
8. VLM: invalid responses rejected/logged; `not_visible` allowed; 25-row audit.
9. Skip-trace hit rate measured.
10. `make refresh` runs clean twice with identical counts.

## Troubleshooting
- ArcGIS layer returns `error` JSON → schema may have changed; re-run `discover_sources.py`
  and diff against `lib/sources.py` / `DATA_NOTES.md`.
- ArcGIS paging: layers cap at 1000–2000 rows/request; page with `resultOffset`.
