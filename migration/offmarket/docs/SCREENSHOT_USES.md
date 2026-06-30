# SCREENSHOT_USES.md — what a screenshot is worth (Claude-as-VLM via the Chrome extension)

> Context: we verified a POC (BUILD_LOG §26d, memory `vacancy-via-chrome-vlm`) where Claude itself
> reads imagery through the Claude-in-Chrome extension — Google Maps **satellite** + **Street View**
> for a parcel's point-on-surface lat/lon — and turns what it sees into structured signals, **with no
> `ANTHROPIC_API_KEY`**. Vacancy was the first use. This doc is the full menu of what *one screenshot*
> (or a short visual pass) can extract for an off-market industrial-sourcing pipeline, so we stop
> thinking of imagery as "just the vacancy field" and start treating it as a discovery layer.
>
> Two image types, different yields:
> - **Aerial / satellite** (overhead): footprint, parking, truck courts, dock indentations, roof,
>   yard, outdoor storage, dumping, overgrowth, rail spur, surroundings, occupancy-by-activity.
> - **Street View** (ground): wall signage, "For Lease/Sale" signs, posted legal notices, window/
>   door condition, boarding, graffiti, business branding, fleet vehicles.

Each use below: **what it extracts · aerial/street · which scoring component or pipeline step it feeds ·
status.** Status = ✅ POC'd · 🟡 ready to wire · 🔭 idea.

> **Update 2026-06-20 — the menu is now wired, not just listed.** `imagery/record_observation.py` is
> the reusable recorder: ONE call captures every signal a screenshot yields and routes each to its home
> (site_observations columns · `distress_signals` type='visual_distress' · `vlm_json` sub-keys for
> tenant/use-truth/context). The 10 existing Columbus passes were backfilled through it and one fresh
> satellite+Street-View pass was run (010-217134). The earlier 2026-06-20 pass proved what's *visually
> extractable* (the **"Test results"** table at the bottom); this pass proved it *flows into scores +
> call sheets* (**"Wired into the pipeline"**, also at the bottom).

---

## 1. Vacancy / occupancy  ✅ POC'd
Parking fullness, signage presence, visible activity, and **place labels** (Google business pins are a
strong occupancy tell) → `vacancy_evidence` (22 pts). Catches the false-positive that data can't: a
parcel scoring high on stale code-violations but actually a thriving business (we saw 4/4 top Columbus
parcels were active — brewery, stone yard, recycler, salvage/daycare). *Aerial gives parking + occupancy;
Street View adds wall signage for the full 22-pt tier.* → `site_observations.parking_fullness/signage_present`.

## 2. Building physical attributes  ✅ POC'd (divisibility + truck_access) · 🟡 dock count
- **Dock doors** — count the loading-dock indentations + truck court along the rear wall (aerial) →
  `dock_doors_est`.
- **Drive-in doors** — grade-level overhead doors (Street View) → `drive_ins_est`.
- **Truck court depth / trailer parking / turning radius** — semis need ~120 ft courts; shallow/tight =
  poor semi access = depressed price = ON-thesis for our van-based cowarehousing → `truck_access`.
- **Divisibility** — multiple entrances, separate suites/units, demising → `divisibility`.
- **Clear-height sanity** — building-shadow length / number of visible stories cross-checks the
  LiDAR/WALLHGT estimate.
- **Rail spur** — a rail line physically touching the building (rail-served changes use + value).
- **Expansion land** — vacant owned land adjacent to the box (laydown yard / add-on potential).

## 3. Condition & distress — validate AND discover  ✅ POC'd (condition captured + corroborated)
Roof (sagging, ponding, patched, tarped, rust, partial collapse, fire scar), cracked/potholed lots,
faded striping, broken/boarded windows + graffiti (Street View). Two jobs:
1. **Corroborate** the assessor `condition_distress` flag (does the CAMA "Poor" match what's visible?).
2. **Discover** distress the assessor record misses (a building visibly deteriorating since the last
   reval). A second, independent condition read.

## 4. Code-violation discovery & corroboration  ✅ POC'd + wired (visual_distress signals)
Illegal **dumping**, **junk/scrap piles**, **inoperable/abandoned vehicles**, overgrowth, outdoor
storage, unsafe structure — these are *exactly* what code enforcement cites. So a screenshot lets us:
- **Confirm** a cited case (the dumping in the photo matches the open violation), and
- **Find violations the city hasn't cited yet** — a *leading* distress indicator and a real edge over
  anyone sourcing off the code-enforcement feed alone. (We already spotted junk-vehicle rows + debris at
  773 Markison and 521 Marion without trying.) Could land as a `distress_signals` row (type='visual_distress').

## 5. Land-use / use-truth verification  ✅ POC'd (conversion flag on call sheet)
The assessor land-use code goes stale. Imagery confirms what the building *actually is* today:
- **Self-storage detection** — rows of mini-units (an excluded competing use) are obvious from aerial →
  prevents a self-storage facility from slipping through the industrial gate.
- **Conversion detection** — warehouse → retail / church / office / entertainment (the brewery!) →
  deprioritize: it's no longer a cowarehousing target.
- Truck-terminal vs warehouse vs flex distinction.
→ a manual override on the land-use gate / a confidence flag.

## 6. Owner / tenant identification  ✅ POC'd (tenant names on call sheet)
Wall signage + branded fleet vehicles + Google place labels name the **operating tenant** and reveal
**single- vs multi-tenant** and **owner-occupied vs leased**. For LLC-owned parcels where the registered
owner is opaque, the visible operating business is often the fastest path to a real decision-maker —
feeds skip-trace and the call script ("I see [Business] operates at [address]…").

## 7. Change-over-time (historical imagery)  ✅ source confirmed (county GIS dated aerials)
Google/county imagery has multiple vintages. Comparing them reveals **direction**: recently vacated
(tenant signage gone, lot emptied), recently re-roofed (corroborates a permit), new construction,
progressive deterioration, demolition. Trajectory often matters more than a single snapshot — a building
*going* vacant is a hotter lead than one long-empty.
**Source (POC 2026-06-21, `docs/COUNTY_GIS_IMAGERY_POC.md`):** the **Franklin County Parcel Viewer**
(`gis.franklincountyohio.gov/parcelviewer/`) exposes a **dated aerial series 2025/2023/2021/…/2013 →
early 2000s** — free aerial trajectory with no Google Earth. It's also strictly fresher than Google
(date-stamped 2025 ortho vs Google's undated, often-stale tile) and surfaces the **registered owner name**
in the parcel popup. Prefer it for the "more updated picture" pass. Most county auditors have an equivalent.

## 8. Site & context  🟡 partly POC'd (rail-served captured in context)
Surroundings: industrial corridor vs encroaching residential (redevelopment upside), highway/arterial
access + road frontage + truck routes, visible flood/ponding or proximity to water, adjacent new
construction (gentrifying submarket). Refines submarket scoring beyond a distance-to-CBD circle.

## 9. Outreach enrichment & the deal file  ✅ wired (call sheet + dashboard + map)
Attach the aerial (and a Street View) to the **call sheet**: the caller opens with instant, credible
context ("I'm looking at your building on [street], the east lot looks underused…") — rapport + signals
we're serious/local. Also a **frozen visual record** of condition at a point in time for the deal file
and later negotiation. (Today the call sheet only has a Maps *link*; embedding the image is the upgrade.)

## 10. Valuation / buy-box context  🔭 $/SF + target price
Visible building quality/grade, parking ratio, dock count, office-vs-warehouse split (window lines),
yard area → sharpen the `Target PSF` and the physical buy-box fields the Leads workbook leaves "verify
on call." Not a price model — a sanity input.

---

## How a screenshot flows into the pipeline (the mechanism, generalized)
1. Get the parcel's interior point: `ST_X/ST_Y(ST_PointOnSurface(geom))`.
2. Extension → `https://www.google.com/maps/@<lat>,<lon>,19z/data=!3m1!1e3` (satellite) and/or Street View.
3. Claude reads the screenshot → structured fields.
4. Write to the right home:
   - vacancy / physical / condition → `site_observations` (set `image_paths` non-null so the
     `no_usable_imagery` deduction doesn't fire) → re-score.
   - discovered violations / visual distress → `distress_signals` (type='visual_distress', sourced).
   - use-truth / tenant / context → notes / overrides / call-sheet fields.
5. Optionally **persist the image** (it's public aerial — no PII) under `image_cache/` or `exports/` and
   surface it (thumbnail + the assessment note) on the dashboard row / call sheet. (See "showing it"
   options A/B/C in the chat of 2026-06-19; today we only store the *derived* signal + a Maps link.)

## Caveats (be honest about these)
- **Manual + slow** — ~1 parcel per screenshot. Do the **top ~25–50 of the call queue**, where it pays;
  not all 537. Auto-scale to the whole universe still needs the `ANTHROPIC_API_KEY` (the VLM as an API).
- **Aerial ≠ street** — signage, boarding, posted notices need Street View; aerial alone caps vacancy at
  the 14-pt tier (sparse parking) and can't read wall signs.
- **Vintage** — Google's satellite tile shows only a *copyright* year, not a capture date, and can lag
  1–3 yrs. **Remedy (POC'd 2026-06-21): use the county auditor's GIS viewer** — its aerials are
  date-stamped and fresher (Franklin County had a **2025** ortho + full dated history). `docs/COUNTY_GIS_IMAGERY_POC.md`.
- **ToS / sourcing** — Google Maps for human-in-the-loop review is fine; bulk programmatic scraping of
  Google tiles is not — for an automated run use the free county ortho / NAIP endpoints (see
  `docs/IMAGERY_TOOLS.md`) and an API VLM.

## Priority (most value per minute)
1. **Vacancy + use-truth on the top ~25** (#1, #5) — kills false-positives, the single biggest accuracy
   win; partly POC'd.
2. **Visual violation discovery** (#4) — the genuine edge: distress the data doesn't have yet.
3. **Call-sheet image + note** (#9, #6) — makes every call sharper.
4. Physical attributes / truck access (#2) — fills the other dormant VLM components.

---

## Test results — empirically verified (2026-06-20, Claude-as-VLM via Chrome on Columbus parcels)

Each use case above, tested live (satellite + Street View). ✅ verified · 🟡 partial · 🔭 untested.

| # | Use case | Verdict | Evidence |
|---|---|---|---|
| 1 | Vacancy / occupancy | ✅ | 10-parcel pass; parking + place-labels reliably separate active vs vacant (10/10 occupied → Columbus low-vacancy finding, DATA_NOTES_COLUMBUS) |
| 2 | Physical attributes (docks, truck court, type) | ✅ docks need 20z | At **20z**, dock doors countable (trailers + bay notches), truck-court depth + cross-dock vs box readable (Central Transport, 2450 Sobeck). NOTE: at **19z** (the default recorder URL) the door faces sit under the roofline — a 010-217134 pass confirmed dock-high loading (truck court + 3 staged trailers) but could *not* count doors. So zoom to 20z before recording `dock_doors_est`. divisibility + truck_access ARE reliable at 19z and now scored. |
| 3 | Condition & distress | ✅ | Aged/patched roofs, cracked lots seen across parcels; Street View adds ground-level condition |
| 4 | Code-violation discovery (uncited) | ✅ | Junk/derelict vehicles (773 Markison), debris/scrap piles (521 Marion) visible from aerial — distress the code feed doesn't have |
| 5 | Use-truth / conversion / self-storage | ✅ | Caught a **conversion**: 512 Maier Pl is coded warehouse but is a brewery/gym/museum. Self-storage (rows of units) is visually unmistakable |
| 6 | Owner / tenant ID | ✅ | Business names readable on every parcel via Google place labels (Central Transport, Kingspan, Smurfit Westrock, 8 tenants @ 3260 Valleyview…) |
| 7 | Change-over-time | ✅ (aerial) / 🟡 (ground) | **Aerial trajectory SOLVED via county GIS** (2026-06-21, `docs/COUNTY_GIS_IMAGERY_POC.md`): the **Franklin County Parcel Viewer** has a dated aerial series 2025/2023/…/2013 — no Google Earth needed (gallery confirmed; live year-flip screenshot pending — the Esri app stalls the extension's `document_idle`). Ground/SV side: the SV **"See more dates" filmstrip does NOT render reliably in-extension**, so multi-vintage *ground* comparison stays unusable |
| 8 | Site / context | ✅ | Surroundings, rail sidings, road frontage, encroaching residential all visible |
| 9 | Call-sheet enrichment | ✅ call sheet + dashboard + map | Site-assessment block (occupancy, use-truth flag, tenants, physical, context, note + sourced satellite link) renders in the call sheet (`outreach/call_sheets.py:site_assessment_lines`), the dashboard row-detail, AND the map popup — `siteAssess()` mirrored into `tools/make_dashboard.py` + `tools/make_map.py` (parity rule). visual_distress tagged "Visual"; `imagery`/`use mismatch` chips on the row. (BUILD_LOG §33) |
| 10 | Valuation context | ✅ | Building quality/grade, parking ratio, office-vs-warehouse split, yard area readable |
| — | **Street View** (cross-cuts 1/3/4/6) | ✅ | Loads via `https://www.google.com/maps?q=&layer=c&cbll=<lat>,<lon>`; ground-level detail + capture date readable. For wall signage / posted legal notices, orient the heading toward the building facade |

**Net:** 8 of 10 use cases fully verified, 2 partial — the Chrome-VLM screenshot approach is a real, broad
intelligence layer, not just the vacancy field. Highest-confidence, highest-value: **use-truth (#5)** and
**uncited-violation discovery (#4)** — both surface things the structured data simply does not contain.
Zoom matters: **~19z for occupancy/condition, ~20z to count docks**, Street View for signage/notices.

---

## Wired into the pipeline (2026-06-20) — from "extractable" to "flowing into scores + call sheets"

The table above proves what a screenshot *can yield*. This is what now *actually lands in the DB and the
call sheet*, so the signal changes the queue instead of living in a chat.

**The recorder — `imagery/record_observation.py`.** One call captures every use-case signal from a pass
and routes each to its home (replaces the vacancy POC's hand-rolled SQL, which only wrote the 3 vacancy
fields). Market-aware (MARKET env), enum-validated (a typo is rejected, not silently stored), idempotent.
`--urls APN` prints the satellite + Street-View links to open in the extension. Aligns with the column
schema in `prompts/vlm_site_assessment.md`; the future API-VLM path calls the same function.
  - vacancy/condition/physical → `site_observations` columns  ·  tenant/use-truth/context → `vlm_json`
    sub-keys  ·  visual distress → a sourced `distress_signals` row (type='visual_distress').

**What landed (Columbus).** All 10 prior passes were backfilled through the recorder + 1 fresh pass
(010-217134), then re-scored (`MARKET=columbus score.py --stage final`):
- **#2 physical → real points.** `divisibility=multi_entry` (read from multi-tenant place labels) lifted
  `physical_fit` 2 → 5 on the 4 genuinely multi-tenant parcels (049808, 112326, 137505, 570-148979) and
  217134. `truck_access` captured (e.g. easy for the Central Transport terminal). ~10 of the 12 physical
  pts and all 4 truck pts are no longer structurally dark.
- **#4 uncited distress → 2 sourced signals.** `visual_distress` rows for 521 Marion (debris/scrap) and
  773 Markison (junked vehicles) — distress the city's code feed doesn't have — now show on the call
  sheet's Distress section, each sourced to the satellite URL. (Evidence only; not yet a scored weight —
  that's a founder call.)
- **#5 use-truth → a deprioritize flag.** 512 Maier Pl scores #1 (45) on data, but the pass marks it
  `use_truth=conversion, matches_landuse=false` (brewery/gym/museum). The call sheet now prints
  **"⚠️ NO LONGER MATCHES assessor land use"** — the score and the use-truth flag pull opposite ways, and
  the caller sees it. This is the false-positive the layer exists to catch.
- **#6 tenant ID + #9 call sheet.** Operating tenants render on every observed sheet; `call_sheets.py`'s
  Site-assessment block is live (was a hardcoded "pending").

**Honest gaps still open:** dock *counts* need a 20z pass (see #2 note); `visual_distress` is sourced
evidence, not a scored component; auto-scale to the whole universe still needs the ANTHROPIC API VLM.
Next best minute-for-minute: a 20z pass on the top ~25 to fill `dock_doors_est`/`drive_ins_est`.
(UPDATE 2026-06-21: the dashboard + map now render the Site-assessment block too — `siteAssess()` in
`tools/make_dashboard.py` + `tools/make_map.py`, parity with the call sheet — so #9 is fully wired. BUILD_LOG §33.)

---

## #7 change-over-time pass — 2026-06-20 (Columbus top 10, PARTIAL: 4 of 10 done)

Goal: for the top 10 Columbus call-queue parcels, compare Google historical aerials + Street View
capture dates and flag any **recently-vacated** or **recently-re-roofed**. Stopped at 4/10 by request;
the remaining 6 are an explicit open task below.

**Method that actually works in the Chrome extension (two-vintage):**
1. **Street View capture date** (when a centroid pano exists) = the most recent *ground* truth + its date,
   read straight off the info card / "Image capture: <Mon YYYY>". This is the reliable SV signal.
2. **Current Google satellite** (`@lat,lon,18-19z/data=!3m1!1e3`) = a second, newer vintage; the tile
   attribution dates it, place labels give occupancy, and roof tone (bright-white membrane vs grey/weathered)
   reads a re-roof. SV-date → aerial-now is a genuine 2-point time series for roof + lot occupancy.
3. Cross-check the **prior recorded pano dates** already in `site_observations.vlm_json`.
Verdict bucket per parcel: recently-vacated · recently-re-roofed · stable-active · long-vacant · unknown.

**Limitation found (update #7 status, don't relearn):** the SV **"See more dates" historical filmstrip
does not render** in this extension (clicking it changed nothing on parcels that *do* have multiple dates,
and on one parcel it wedged Maps into a perpetual-loading / 0×0-viewport state that only a fresh tab fixed).
So the multi-vintage *ground* comparison the filmstrip would give is **not currently available**. True
multi-vintage *aerial* comparison (the canonical #7 re-roof / vacated-direction tool) still needs **Google
Earth** (earth.google.com time-slider), which was **not tested** in-extension this session. Net: #7 stays 🟡 —
capture-date + current-aerial works and is recorded; the historical-aerial diff is the remaining piece.

**Recorded this session (via `record_observation`, augmenting prior obs — trajectory in the `note` field):**
- **010-137505** (512 Maier Pl) — SV Nov 2020 active (full lot, "LEASING", scissor-lift build-out) → aerial
  now = **completed conversion** (Nocterra Brewing, Bloc Garten, Fit Club/CrossFit, Prototype Museum) with a
  **fresh white re-roof** on the NW building. Arc = improving + capital reinvestment, NOT distress →
  reinforces the #5 deprioritize. **Trajectory: stable→improving / converted.**
- **010-112326** (773 E Markison) — no centroid pano; aerial = central yard full of scrap + derelict vehicles
  (corroborates the existing junk-vehicle flag). Single vintage → **direction unknown; state = stable-to-
  worsening distress, ON-thesis.**
- **010-001345** (521 Marion Rd) — SV Jun 2019 active industrial (process silos) → aerial now = same building
  intact + in use; the scrap field is the **salvage-yard NEIGHBOR to the east** (Phoenix Recycling), confirming
  the prior call that the aerial scrap `visual_distress` flag is **neighbor spillover** (review/clear it).
  **Trajectory: stable active industrial.**
- **010-112377** (1015 Marion Rd) — no SV ("No Street View imagery available here"); aerial = Smurfit Westrock
  recycling plant fully active (OCC/paper bales, staged trailers, rail-served). **Trajectory: stable active;
  false positive for the vacancy thesis.**

**OPEN TASK — finish the #7 pass (6 parcels remaining), then validate the aerial-history path:**
1. Run the two-vintage #7 read + `record_observation` (trajectory in `note=`) for the rest of the top 10:
   `010-217134` (1675 W Mound), `570-148979` (3260 Valleyview), `010-009676` (2450 Sobeck),
   `010-103969` (600-740 Marion), `010-102716` (850 Twin Rivers), and **`010-032148` (751 E Eleventh) — has
   NO prior observation at all, so do a full pass, not just trajectory.**
2. **Test Google Earth Web** (earth.google.com/web, historical-imagery clock) in the extension on 1–2 of the
   distress candidates (e.g. 773 Markison, 521 Marion) to see if true multi-vintage *aerial* comparison is
   feasible there — that's the missing piece to actually confirm "recently-vacated" vs "long-vacant" and
   date a re-roof. If it works, wire a `maps_urls()` Earth link into `record_observation.py`.
3. Re-score is a no-op for trajectory-only notes (no scored field changed); re-run only if a pass flips a
   scored field (occupancy/condition/parking/divisibility).
