# Session log — 2026-07-20 (pt4) · LoopNet lease overlay on the Properties tab

**Ask (Raz):** show LoopNet for-lease availability ON the Properties tab — an indication on rows,
a left-rail filter, a button to open the record on LoopNet — and go over ALL records in the system.

## What shipped

- **Sweep:** LoopNet *industrial for-lease* inventory for all 7 system metros
  (Orlando 221 · Charlotte 137 · Nashville 100 · Columbus 88 · Cleveland 68 · Raleigh 65 ·
  Charleston 49 = **728 listings**), pulled via in-page `fetch()` from a browser tab that had
  passed the bot check (search pages tolerate ~1 req/700ms; listing *detail* pages 403 after ~14
  rapid hits — session-wide, took the rest of the day's detail-page budget with it).
- **Match:** all **2,457** in-view records (data.real.json) matched by market + street number
  (range-aware, parity-checked) + canonical street name (suffix/directional normalization).
  Result: **74 properties with an active lease listing** (79 listing pairs; several addresses carry
  two listings). All matches are off-market channel records — i.e. owner is quietly marketing space.
- **Verification:** every pair geo-verified — 14 via coordinates scraped from LoopNet's own listing
  pages, 62 via the US Census batch geocoder (<2.5 km from record lat/lng), 1 Census Non_Exact
  mis-geocode adjudicated by zip-centroid (400 Davidson St, kept), 2 unverifiable-but-distinctive
  street names kept (1133 Polk Ave, 1815 Beggrow St).
- **Data path:** `frontend/lease-overlay.json` (committed; county-APN ids + public LoopNet facts
  only, no PII) → merged onto `DATA.props` as `p.lease` at server boot (`server.mjs`), so it rides
  the authed `POST /api/data` only. Volume write-back happens BEFORE the merge, so the persisted
  dataset stays pristine. Dockerfile ships the overlay with an absent-file guard.
- **UI (App.jsx / Properties module):**
  - table + mobile card: green **For Lease** badge next to the address — clicking it opens the
    LoopNet listing (stopPropagation, doesn't open the drawer);
  - left rail → Signals: **"LoopNet lease listing"** checkbox (works with chips/clear-all);
  - detail drawer: **"Listed for lease · LoopNet"** section with quoted SF/rate note and an
    **Open on LoopNet** button per listing (multi-listing addresses labeled by each listing's note).

## Process notes

- Verified visually via a throwaway no-gate harness (deleted after; briefly rode along in commit
  427b2b8, removed in 33d527f). Filter check: 12 sample rows → 3 lease rows + active chip.
- Adversarial 12-agent review before push; 4 confirmed low-severity findings, 2 fixed
  (Dockerfile guard, drawer labels), 2 accepted+documented (static/local-dev data paths carry no
  `p.lease` by design — badges only appear on the Railway path).
- Two Claude sessions shared this working tree; commit 427b2b8 (chips work) scooped the lease
  feature files mid-flight — accounted for, follow-ups in 33d527f. Backend WIP (database.py,
  live_api.py, scrapers/*) left uncommitted for the owning session.

## Refresh playbook (repeat when listings go stale)

1. Sweep: `/search/industrial-space/{metro}/for-lease/{page}/` per metro (in-page fetch, parse
   `article[data-id]`, address from the `More details for…` title attr).
2. Re-run `match.py` → `build_overlay.py` (session scratchpad copies existed under
   `loopnet-lease/`; scripts are small — regenerate if gone) → replace `frontend/lease-overlay.json`.
3. Commit + push; Railway auto-deploys. `generatedAt` in the overlay records freshness.

## Left open

- Map view: lease-flagged pins get no special marker yet.
- FilterChat / term-chips language doesn't know the `sig.lease` key yet.
- Overlay is point-in-time (2026-07-20); no auto-refresh job.
