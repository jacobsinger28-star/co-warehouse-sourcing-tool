# Changelog

## 2026-06-23 — Crexi source for the buy-box markets + Pipedrive market guardrail

**New listing source + market scoping. Backend + frontend.**

### Added
- **`scrapers/crexi.py` — `CrexiScraper`**, a direct `api.crexi.com` scraper
  (no auth, no browser at runtime; mirrors the Colliers/RCM direct-API pattern).
  Crexi is the free on-market source that actually covers the buy-box markets
  where Colliers is empty. Per market it POSTs `/assets/search` with a lat/long
  bounding box + `types:["industrial"]`, paginates via `count`/`offset`, then for
  each kept listing fetches `/assets/{id}` (building SF + regex-able specs) and
  `/assets/{id}/brokers` (listing broker name + brokerage). Bounded-concurrency
  enrichment (`_ENRICH_CONCURRENCY`). Filters: On-Market only, 75k–300k SF
  (backfilled from the detail when the search omits it), US.
  - *Smoke-tested live:* 166 in-buy-box industrial-for-sale listings across all
    seven markets (Charlotte/Raleigh/Charleston/Columbus/Miami/Boca/West Palm),
    100% with a broker name — vs ~0 from Colliers. Run `python -m scripts.smoke_crexi`.
  - **Broker-contact limit:** Crexi gates email/phone behind a lead form, so it
    yields broker NAME + BROKERAGE + a clickable Crexi profile/listing URL, not a
    phone/email. (Enrich later via Apollo / skip-trace.)
- **`scrapers/markets.py` — `TARGET_MARKETS`**, the single source of truth for
  the seven buy-box markets: bounding boxes (Crexi geo-filter) + city/state lists
  and `is_in_target_market(row)` (lat/lng first, address fallback).
- **Crexi** added to the brokerage selector in `LiveSearch.jsx`.

### Changed
- **`BrokerageScraper`** gained a `crexi_mode` site + dispatch branch (mirrors the
  `colliers_use_api` path). A nationwide "Run All" now also scans Crexi, scoped
  to the buy-box markets.
- **`/pipedrive/import` buy-box guardrail:** only brokers whose listing is in a
  target market are pushed (override with `restrict_to_markets:false`); skipped
  out-of-market rows are reported back and surfaced in the send toast. Fixes the
  out-of-market leak (previously 53 of 54 uploaded brokers were out-of-market).
- **`pipedrive.py`** broker source note now includes the brokerage + Crexi
  profile link (read from the listing's `raw_data`; no schema change).

## 2026-06-23 — Broker contacts → Pipedrive, on-market hardening, DB persistence

Goal: get every listing broker's phone number from the scrape into Pipedrive as
a real, verifiable contact. Spanned scraper → DB → Pipedrive → frontend.

### Added
- **Broker contact persistence** (`backend/database.py`): new `broker_name`,
  `broker_email`, `broker_phone`, `broker_cell` columns + migrations + upsert.
  Previously the Colliers scraper captured a broker phone per listing but it was
  silently dropped at the DB layer.
- **Pipedrive broker Person** (`backend/pipedrive.py`): `create_deal` now
  find-or-creates a Person for the broker and links it to the deal. New contacts
  are owned by the API token's own user (`/users/me`), tagged with the
  `on-market-scrapping-tool` label, carry the phone (cell → primary "mobile"),
  a clickable **Source Listing** custom field, and a **source Note** linking the
  listing. Existing contacts are reused and never overwritten.
- **Broker-bio cell fetch** (`backend/scrapers/broker_bio.py`, new): best-effort
  Playwright render of the RCM landing page to extract a labeled mobile number;
  runs on selected rows at import time. Degrades to the listed phone. Disable
  with `BROKER_BIO_FETCH=0`.
- **LiveSearch → Pipedrive** (`frontend/src/components/LiveSearch.jsx`): a
  Broker column (cell shown in green) + row selection + "Send to Pipedrive".

### Changed
- **On-market only** (`backend/scrapers/colliers.py`): Colliers SalesTracker
  also lists CLOSED deals (Sold) as comps — ~29 of 116 in-scope listings. Now
  skips `Sold`/`Closed` status (→ 87 active).
- **Real URLs only** (`backend/pipedrive.py` `_is_listing_link`): the scraper
  fabricates a `sales.colliers.com/#teaser/<hash>` surrogate for listings with
  no public page (Call broker / sold). These are dedup keys, not real links —
  notes/fields now only ever show real `my.rcm1.com` pages; fakes render as
  "no public listing page".
- **DB persistence on Railway** (`backend/database.py`, `backend/geocoder.py`,
  `railway.toml`): SQLite path now resolves from `DATA_DIR` so the DB can live
  on a mounted volume and survive redeploys (Railway containers are ephemeral;
  the DB is git-ignored, so it reset to empty on every deploy). Requires a
  Railway volume at `/data` + `DATA_DIR=/data`.

### Live operations performed (against production Pipedrive)
- Uploaded **54 unique brokers** from the live Colliers scrape (0 failures);
  4 already existed (Jan-2024 import) and were reused, not duplicated.
- **Verified all 54 phone numbers** against the live Colliers source (50 exact,
  4 pre-existing matched after stripping a leading country-code `1`). No phone
  was modified.
- **Stripped all fabricated `#teaser` URLs**: 34 contacts retain ≥1 real
  listing link; 20 (teaser/sold only) get an honest "no public page" note.

### Verified
- `npm run build` passes clean. Pipedrive Person/label/note/field payloads
  unit-tested with mocked HTTP; live create + read-back confirmed in Pipedrive.
- Frontend Broker column + Send-to-Pipedrive bar confirmed in browser preview.

## 2026-06-11 — Live Search table: score-based row tint + filter toolbar

**Frontend only. No backend, DB, or schema changes.**

File: `frontend/src/components/LiveSearch.jsx`

### Changed
- **Whole-row score tint replaces the Score badge column.** The per-row
  `Score` cell (Actionable/Tentative/Pass badge) was removed; each listing's
  entire row is now tinted by its score category instead:
  - Actionable → green (`bg-green-50`, hover `green-100`)
  - Tentative → yellow (`bg-yellow-50`, hover `yellow-100`)
  - Pass → red (`bg-red-50`, hover `red-100`)
  - Unscored → no tint (default `hover:bg-slate-50`)

  Trade-off: dropping the column also dropped sort-by-score. Score is still
  filterable via the existing Actionable/Tentative/Pass chips, and now legible
  at a glance from row color.

### Added
- **Table filter toolbar** (table view only), composes with the existing
  score chips:
  - Free-text **search** across address, source, zoning, and scoring notes
  - **State** dropdown (options derived from the current listings)
  - **Source** dropdown (brokerage)
  - Live **`N of 179` match count** + **Clear filters** reset

### Verified
- `npm run build` passes clean (vite, 1636 modules).
- Ran locally against the 179 cached listings: 162 rows tint yellow
  (Tentative), 17 tint red (Pass); search "Houston" narrows to 6 of 179
  across all four brokerages with tints intact.
