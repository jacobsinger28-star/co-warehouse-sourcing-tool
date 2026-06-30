# Nashville Industrial Sourcing

Automated pipeline that surfaces **off-market industrial properties** in Davidson
County, TN for a cowarehousing acquisition strategy — vacant/neglected ≥75k SF
warehouses with motivated owners — and turns them into a **ranked call queue** with
generated call sheets.

The output is a phone list, not mailers. Vacancy is inferred from imagery (VLM), never
from listing sites. Anything actively listed on Crexi/LoopNet is broker-controlled and
deliberately excluded. Built to be re-pointable across metros — 6 markets are live.

> Full spec: [`docs/ENGINEER_BRIEF.md`](docs/ENGINEER_BRIEF.md) ·
> founder dependencies: [`docs/FOUNDER_INPUTS.md`](docs/FOUNDER_INPUTS.md) ·
> what the real data looks like: [`DATA_NOTES.md`](DATA_NOTES.md)

## Stack
Python · Postgres/PostGIS (local; Supabase later) · ArcGIS Hub feature services (parcels,
CAMA, violations, permits) · Claude vision API · Pipedrive (CRM) · GitHub Actions (weekly `make refresh`).

> **Data-layer correction:** the brief's "Nashville Socrata API" is gone — the portal
> migrated to ArcGIS Hub, and building SF lives in a separate CAMA layer. Details and
> the confirmed endpoints are in [`DATA_NOTES.md`](DATA_NOTES.md) and `lib/sources.py`.

## Pipeline (`make refresh`)
```
pull_* → import_csv → normalize → build_universe → score(provisional)
       → fetch_images(top 200) → vlm_score → score(final) → airtable_sync
```
Every stage is idempotent (upsert on `apn`); raw responses land in staging before any
transform; image/VLM results are disk-cached so reruns cost $0.

## Status
**Live status of record: [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) (most-recent section).**
Far past the original Day-2 snapshot:

- **6 markets** built — Nashville, Charlotte, Columbus, Cleveland/Cuyahoga, Cincinnati/Hamilton,
  Charleston — in ONE unified ranked dashboard + interactive map (live on Vercel, encrypted)
- Owner-contact enrichment (Nashville/Charlotte/Columbus) · Pipedrive Leads sync · AI-dialer +
  call sheets (stub-safe by default) · imagery vacancy via the Chrome-extension VLM path
- Fair cross-market ranking (per-market ceiling + blended rank — HEALTH_AUDIT §A1)
- Hermetic + DB test tiers (`make test-fast` / `make test-db`); test-architecture Layers 0–3 built
  ([`docs/TEST_ARCHITECTURE.md`](docs/TEST_ARCHITECTURE.md))
- [ ] API-key VLM + Airtable (still stubs) · a real skip-trace account · TEST_ARCHITECTURE Layer 4
- Open backlog: [`docs/HEALTH_AUDIT_2026-06-18.md`](docs/HEALTH_AUDIT_2026-06-18.md) (21 findings)

See `RUNBOOK.md` for operations.

## Quickstart (dev)
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # fill in DATABASE_URL + API keys
python tools/discover_sources.py   # sanity-check the live data sources (no DB needed)
pytest -q                        # scoring/gate tests
```
