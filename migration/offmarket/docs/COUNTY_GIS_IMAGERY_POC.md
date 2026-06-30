# County GIS imagery POC — a "more updated picture" than Google/Bing

> Founder prompt (2026-06-21): *"you can try also going to other gps sites if you want to get a more
> updated picture of the properties."* → *"it's just a POC, so you can run on Columbus until you find
> if it works or not."* This is the write-up. It is a **source-comparison POC + docs only** — no
> migration, no re-score, no DB writes. Memory: `county-gis-fresher-imagery`. BUILD_LOG §34.

## TL;DR — it works, and the winner is the county auditor's viewer
Google Maps satellite (the source the [[vacancy-via-chrome-vlm]] pass has used) does **not** expose a
capture date and tends to lag. Of the four sources tested on Columbus parcels, the **Franklin County
Auditor Parcel Viewer** is decisively the freshest and most useful for our purpose.

| Source | URL | Capture date shown? | Vintage seen | Notes |
|---|---|---|---|---|
| Google Maps satellite | `google.com/maps/@lat,lon,19z/data=!3m1!1e3` | ❌ only a **©copyright** year ("©2026"), not capture date | leaf-on | place labels = operating tenants; can't tell how stale |
| Bing Maps aerial | `bing.com/maps?cp=lat~lon&lvl=19&style=a` | ❌ none | similar/older than Google | **Bird's-Eye `style=o` deprecated** → falls back to road |
| Google Earth Web | `earth.google.com/web/@…` | ✅ (date + history slider) | — | **WebGL-heavy; never finished loading through the Chrome extension** — unreliable here |
| **Franklin County Parcel Viewer** | `gis.franklincountyohio.gov/parcelviewer/` | ✅ **dated** basemaps | **2025** (leaf-off, hi-res) | **winner** — see below |

## Why the county viewer wins
1. **Fresher + date-certain.** Basemap gallery ("Aerial Photos and Basemaps") offers a full **dated
   series: 2025 / 2023 / 2021 / 2019 / 2017 / 2015 / 2013 / …** back to the early 2000s. We loaded the
   **2025** ortho — leaf-off bare trees vs. Google's green canopy *prove* it's a different, later capture.
2. **Higher-res, leaf-off** → better roof / footprint / condition reads than Google's leaf-on tiles.
3. **Registered owner name** in the parcel popup — `010-137505` → **"CITY PROPERTIES INC"**. Google's
   place labels only give the *operating tenant* (Nocterra/Fit Club/etc.). Direct skip-trace/outreach
   assist for LLC-opaque parcels. Popup also has a **"View Street-Level Photo"** link.
4. **Unlocks change-over-time (SCREENSHOT_USES #7).** The dated year series makes aerial trajectory
   analysis free — previously the one 🟡 gap that we thought needed Google Earth.

## What we read (2 parcels, both ACTIVE in 2025 — reconfirms Columbus low vacancy)
- **010-137505 / 512 Maier Pl** (score 45, already assessed) — brewery/gym/museum conversion; 2025 lot
  ~25 cars. Active adaptive reuse, date-confirmed to 2025.
- **010-112465 / 1550 Universal Rd** (score 32, *fresh* — not previously assessed) — large distribution
  warehouse, **intact light-gray roof (good condition)**, lot **full ~50+ cars**, organized outdoor
  storage. Clearly occupied/active in 2025. Off-thesis (occupied), but a clean second confirmation that
  the source works county-wide (it loaded the same 2025 leaf-off imagery for a totally different submarket).

## How to drive it (manual pass)
1. Open `https://gis.franklincountyohio.gov/parcelviewer/` → dismiss the auditor **disclaimer** ("OK";
   informational, no agreement/data submitted).
2. Search **By Value → Parcel ID** (`010-137505`) *or* the top "Search by Address, or Place" box.
3. Bottom toolbar → **basemap gallery icon** → pick **"2025 Aerial Photo"** (or any year for trajectory).
4. The yellow parcel-select tint washes out the roof — **zoom in or clear the selection** for a clean read.

## Honest gaps / what is NOT proven yet
- **Live year-to-year flip not captured.** After heavy interaction the Esri viewer stops reaching
  `document_idle`, so the Chrome-extension screenshot tool times out (45s). The **dated gallery's
  existence is confirmed** (screenshotted) and 2025 was read, but an actual side-by-side 2025-vs-2013
  delta image was not grabbed this session. (Extension itself was healthy — Google Maps screenshotted
  fine; it's specific to the perpetually-streaming Esri app.)
- **Programmatic access not confirmed.** Goal was to show the dated orthos are *fetchable* (exportImage
  by bbox) → wireable into the *automated* pipeline, not just manual. But: Franklin's public
  `gis.franklincountyohio.gov/hosting/rest/services` has **no imagery folder** (the orthos are
  portal-hosted tiles / a separate image host), and Ohio's statewide **OGRIP/OCM image server**
  (`gis.ohiodnr.gov/image/rest/services`) was returning **500 `SITE_NOT_INITIALIZED`** at test time
  (transient outage). Endpoint discovery (the viewer's web-map config) + OCM/NAIP are the path; retry
  when the state server is back. See `docs/IMAGERY_TOOLS.md`.

## Not wired (follow-ups, founder's call)
1. **`imagery/record_observation.py` `maps_urls()`** still emits **Google-only** URLs — add the
   county-viewer URL so every manual pass opens the freshest dated source first.
2. **Flip SCREENSHOT_USES #7 to ✅** (done in this doc-set) and add the county-GIS source to the menu.
3. **Record the 2 reads** above into `columbus.site_observations` (not done — no DB writes this session).
4. **Other markets:** same recipe — find that county auditor's dated-ortho viewer (most OH/county
   auditors have one). Cuyahoga/Hamilton/etc. each have an equivalent.
