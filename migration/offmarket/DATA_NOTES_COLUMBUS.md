# DATA_NOTES_COLUMBUS.md — what Columbus / Franklin County public data actually looks like

> Day-1 discovery for re-pointing the pipeline to **Columbus, OH (Franklin County)**.
> All endpoints below were hit live on **2026-06-16** (HTTP-verified, field lists copied
> from the live JSON — not assumed). Companion to the Nashville `DATA_NOTES.md`. The code
> is **not yet** multi-market; this is the data layer a Columbus build would target.

---

## TL;DR — how Columbus differs from Nashville (the corrections)

1. **Both the city and the county are ArcGIS** (no Socrata) — same REST pattern as
   Nashville's *corrected* state, so the ingest mechanics port cleanly. City data
   (`opendata.columbus.gov`) is ArcGIS Hub; county/assessor data
   (`gis.franklincountyohio.gov/hosting/rest`) is ArcGIS Server.
2. **✅ CORRECTED 2026-06-17 — commercial building SF IS published; the original "no SF"
   finding was wrong.** It checked only the *residential* field (`RESFLRAREA`, null on
   industrial). The Tax Parcel layer also carries the assessor's **`BLDGAREA` ("Gross Floor
   Area")**, populated on **2,363 of 3,796** industrial parcels (incl. ~all of the ≥75k
   universe), plus **`TOTVALUEBASE`** (appraised total value) on ~100%. So `building_sf` now =
   `COALESCE(BLDGAREA, footprint_proxy)` — authoritative assessor GBA, with the footprint proxy
   (below) demoted to a fallback for the minority lacking BLDGAREA.
   **UPDATE 2026-06-18 (BUILD_LOG §20): commercial `year_built` is ALSO available now.** It's not
   in the GIS (`RESYRBLT` is residential-only) but it IS in the Auditor's free bulk CAMA "Appraisal"
   download — `Build.xlsx` at `apps.franklincountyauditor.com/Outside_User_Files/<YYYY>/<date> Appraisal/`
   (HTTP 200 to any browser User-Agent; the old "403" was a missing UA + stale FTP path). It carries
   YRBLT + WALLHGT (clear height) + GRADE + PHYCOND, keyed by PARCEL ID. `ingest/pull_cama_columbus.py`
   loads it → year_built 522/537 universe, clear_height 522/537. So Columbus is now at FULL data parity.
3. **Permits carry a status field** (`PERMIT_STATUS`) — so the "permit pulled but never
   finaled / lapsed" signal that was *undrivable* in Nashville **is** derivable here. A
   market-specific upgrade to `permit_anomaly`.
4. **Land-use is the Ohio DTE class scheme** (`CLASSCD`, 3-digit) — a completely different,
   more granular code set than Nashville's `LUCode`. Industrial warehouses are cleanly
   identifiable (verified distinct values below).
5. **Join keys**: both city feeds carry `B1_PARCEL_NBR` (Accela parcel number) — a direct
   parcel-number join, like Nashville's APN. Parcel-ID format differs (dashed
   `040-005809`), so a normalization step vs the Auditor `PARCELID` is needed; spot-check
   the join (Nashville's lesson).

---

## Confirmed sources (verified live 2026-06-16)

| Source | Service (REST) | Platform | Join key | Carries |
|---|---|---|---|---|
| Parcels + owner/assessor | `gis.franklincountyohio.gov/hosting/rest/services/ParcelFeatures/Parcel_Features/MapServer/0` (Tax Parcel) | ArcGIS Server (county) | `PARCELID` | geometry, owner, mailing addr, sale, land use, acres — **residential SF/year only** |
| Building footprints | `…/BaseMap/Reference_Data/MapServer/1` | ArcGIS Server (county) | spatial | polygon geometry, `Shape.STArea()`, `Roof_Height`, `Base/Roof_Elev` (SF **proxy** only) |
| Building permits | `services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Building_Permits/FeatureServer/0` | ArcGIS Online (city, Accela) | `B1_PARCEL_NBR` | type, `ISSUED_DT`, `PERMIT_STATUS`, `SQFT`, `G3_VALUE_TTL`, address |
| Code enforcement | `maps2.columbus.gov/arcgis/rest/services/Schemas/BuildingZoning/MapServer/23` (Code Enforcement Cases; `/24` = Building Compliance) | ArcGIS Server (city, Accela) | `B1_PARCEL_NBR` | `B1_FILE_DD`, `INSP_*` dates/results, `B1_APPL_STATUS`, address |

Bulk CAMA (the likely commercial-SF source): **Franklin County Auditor bulk download**
(`auditor.franklincountyohio.gov/Auditor/FTP`) — **403 to automated fetch**; needs a
browser/manual pull. Contents unverified from here (see blocker section).

---

## Parcel / owner layer — field mapping → our normalized columns

Tax Parcel layer (`…/Parcel_Features/MapServer/0`), verified fields:

| Our column | Columbus/Franklin field | Notes |
|---|---|---|
| `apn` | `PARCELID` | dashed, e.g. `040-005809` (normalize for joins) |
| `owner` | `OWNERNME1` (+ `OWNERNME2/3`) | |
| `own_addr` | `PSTLADDRES` + `PSTLCITYSTZIP` | tax mailing; **`PSTLCITYSTZIP` is one combined "City ST Zip" string → must be parsed** for state (no separate `OwnState` like Nashville) |
| `sale_price` | `SALEPRICE` | 0 = non-arm's-length (treat as no price), as in Nashville |
| `sale_date` | `SALEDATE` | esri date (epoch ms) |
| `land_use_code` | `CLASSCD` | Ohio DTE class; `CLASSDSCRP` = text |
| `acres` | `STATEDAREA` (legal) | `ACRES` (GIS acres) was NULL on industrial samples → prefer `STATEDAREA`, fallback to polygon area |
| `building_sf` | **`BLDGAREA`** ("Gross Floor Area") | authoritative assessor GBA, 2,363/3,796 populated; footprint proxy is the fallback for the rest (corrected 2026-06-17) |
| `assessed_value` | `TOTVALUEBASE` ("Base Total Value") | appraised total value; ~100% populated |
| `year_built` | `RESYRBLT` | **residential only → still NULL for industrial** (no commercial year-built in any open feed; Auditor bulk CAMA only) |

Other useful fields present: `SITEADDRESS`, `ZIPCD`, `USECD`/`PCLASSDSCRP` (use code),
`NOCARDS` (number of cards), `FLOORCOUNT`.

---

## Land-use — industrial band (Ohio DTE `CLASSCD`, verified distinct values)

| CLASSCD | CLASSDSCRP | Keep? |
|---|---|---|
| 300 | INDUSTRIAL, VACANT LAND | maybe (vacant; SF gate decides — cf. Nashville 070) |
| 330 | MANUFACTURING & ASSEMBLY MEDIUM | yes (confirm on imagery — conversion) |
| 340 | MANUFACTURING & ASSEMBLY LIGHT | yes |
| 350 | INDUSTRIAL WAREHOUSES LIGHT | **yes (core target)** |
| 351–354 | WAREHOUSE: 6–50% OFFICE | **yes (core target)** |
| 356 | AUTOMATED WAREHOUSE | yes |
| 358 | MULTI-STORY WAREHOUSE | yes (multi-story → footprint proxy undercounts) |
| 360 | INDUSTRIAL TRUCK TERMINALS | yes |
| 391 | INDUSTRIAL CONDO | maybe (condo'd — divisibility already done) |
| 392 | INDUSTRIAL FLEX SPACE >50% OFC | yes |
| 399 | OTHER INDUSTRIAL STRUCTURES | yes |
| 480 | COMMERCIAL WAREHOUSES | yes |
| 488 | COMMERCIAL WAREHOUSE >50% OFC | yes |
| 481 | MINI WAREHOUSE | **exclude** (self-storage competing use) |

- **Match on `CLASSCD`**, not text (like Nashville's LUCode lesson; note the double-spaced
  `INDUSTRIAL WAREHOUSES    LIGHT` in the data).
- Count in the warehouse+mfg+flex band (codes above, excl. 481, excl. 300 vacant):
  **3,334 parcels** (pre-SF, pre-buy-box) — healthy, comparable to Nashville's 2,301.

---

## ⚠️ The building-SF blocker (resolve before a universe can be built)

Verified: industrial parcels have `RESFLRAREA = NULL` / `RESYRBLT = NULL`. No open ArcGIS
layer carries commercial/industrial gross building area. The 75k gate needs one of:

- **(A) Franklin County Auditor bulk CAMA export — authoritative, preferred.** Ohio auditor
  CAMA systems track commercial GBA + year built keyed by parcel. The Auditor publishes bulk
  data, but the download endpoint 403s automated fetches — a founder/manual browser pull (or
  a data request) gets the file, which then loads like Nashville's CAMA but as a CSV (the
  generic `import_csv.py` pattern already fits). **This is the recommended path.** Unverified
  contents until someone pulls it.
- **(B) Building-footprint area proxy — works today, approximate.** `Building Footprints`
  (`…/Reference_Data/MapServer/1`) has `Shape.STArea()` (footprint sqft) + `Roof_Height`.
  Footprint ≈ building SF for single-story warehouses; **undercounts multi-story (358) and
  ignores office mezzanines**. Usable as a first-pass gate/prototype, NOT authoritative.
  `Roof_Height` could estimate stories to refine. Spatially join footprints to industrial
  parcels, sum per parcel.
- (C) AREIS per-parcel web cards — no bulk API; impractical / ToS risk. Not recommended.

Recommendation: prototype with (B) to get a real ranked Columbus list quickly, swap to (A)
the moment the bulk CAMA file is in hand. Either way, this is the Columbus equivalent of
Nashville's "where does SF live" Day-1 finding — and it's harder here.

---

## Violations + permits — field mapping

**Permits** (`Building_Permits/FeatureServer/0`, Accela-backed):
`B1_PARCEL_NBR` (join), `ISSUED_DT`/`ISSUED_YEAR` (date), `PERMIT_STATUS` + `B1_APPL_STATUS`
(**status → enables lapsed/expired signal**), `B1_PER_TYPE`/`B1_PER_CATEGORY`/`GENERAL_TYPE`,
`SQFT` (permit sqft, not building total), `G3_VALUE_TTL` (value), `SITE_ADDRESS`. `B1_ALT_ID`
→ `source_ref`.

**Code enforcement** (`BuildingZoning/MapServer/23`):
`B1_PARCEL_NBR` (join), `B1_FILE_DD` (filed date → the "within 24 months" window),
`INSP_1ST_DATE`/`INSP_LAST_DATE`/`INSP_*_RESULT`, `B1_APPL_STATUS`, `SITE_ADDRESS`.
`B1_ALT_ID` → `source_ref`. (`/24` Building Compliance is a second, related feed.)

Both carry `COLS_KEY` (a normalized parcel key) alongside `B1_PARCEL_NBR` — likely the
cleanest join to the Auditor `PARCELID`; **spot-check 10 joins** before trusting (the
parcel-format normalization is the thing to watch, per Nashville).

---

## Buy-box — founder must define (suggestion only)

Nashville used a 10-mile circle around an industrial center. Columbus's main industrial
submarkets: **Rickenbacker / south** (the big logistics hub, ~39.81, -82.92),
**West / Hilliard**, and **Northeast / New Albany** (Intel, Amazon). For an infill
cowarehousing play, a defensible starting center is the **Columbus CBD ≈ (39.9612,
-82.9988)** with a radius that reaches Rickenbacker (~12–15 mi). **The founder should
confirm the center + radius, or supply drawn submarket polygons** (same `imports/*.geojson`
contract as Nashville). This is a FOUNDER_INPUTS-equivalent dependency.

---

## What's needed to actually build Columbus

1. **Decision: commercial-SF source** — path (A) bulk CAMA file vs (B) footprint proxy (above).
2. **The Columbus buy-box** — center+radius or submarket polygons.
3. **The multi-market refactor** — the code currently hardcodes Nashville (sources, field
   maps, land-use codes, gates, geometry). Adding Columbus cleanly means parameterizing those
   behind a per-market config + scoping the DB by market. See the build plan in the handoff.
4. **Field-mapping layer** — Columbus field names differ from Nashville's (`OWNERNME1` vs
   `Owner`, `CLASSCD` vs `LUCode`, combined `PSTLCITYSTZIP` needs state parsing, etc.).

---

## Visual vacancy assessment (2026-06-20) — Columbus has very LOW true industrial vacancy

Method: Claude-as-VLM via the Claude-in-Chrome extension (Google Maps satellite per parcel's
point-on-surface; POC in BUILD_LOG §26d / memory `vacancy-via-chrome-vlm`). Sampled **10 universe
parcels across the full score range** (40 down to 13) and across building types/ages.

**Result: 10/10 occupied / active. Zero vacant.** Examples:
- 512 Maier Pl — adaptive reuse (Nocterra Brewing, CrossFit, museum)
- 2450 Sobeck Rd — active LTL truck terminal (Central Transport), full trailer yard
- 600-740 Marion Rd — active manufacturing (Benchmark by Kingspan)
- 850 Twin Rivers Dr — large active facility (True North Builders / USPS), full parking
- 3260 Valleyview Dr — fully-occupied multi-tenant flex (8 small businesses)
- 1015 Marion Rd — Smurfit Westrock recycling · 521 Marion — S.W. Griffin stone yard
- **185 N Yale (1900) & 324 E Dering (1901)** — even the OLDEST, assessor-flagged-POOR buildings are
  occupied (small-tenant adaptive reuse; active chemical/materials processing plant).

### Implication for scoring + outreach (important — calibrates the whole Columbus strategy)
- **The "vacancy" thesis does not apply to Columbus.** The 75k+ stock is in use; there is no
  vacant-warehouse inventory to find. `vacancy_evidence` (22 pts) will sit ~0 market-wide.
- **The opportunity is "occupied but MOTIVATED"**, not empty: poor condition / functional obsolescence
  + long hold + aging/out-of-state owner. A *seller* signal, not a *vacancy* signal. This **validates
  the `condition_distress` component** (BUILD_LOG §26c) as the right lens for OH markets, and argues for
  weighting condition + hold + owner_profile + code_violations over vacancy here.
- **Why the data-ranked top is all active:** the code-violation signal that ranks parcels high
  correlates with messy-but-active operations (outdoor storage, junk, dumping by working businesses),
  NOT with vacancy. So top-down visual scraping keeps hitting active operations — the smarter visual
  pass targets assessor-poor + old + long-held parcels (and even those came back occupied here).
- **Process note:** marking a parcel `clearly_active` scores vacancy 0 — it does NOT demote it (everyone
  starts at 0). To make the queue self-correct you'd need either a confirmed-active *penalty* or to find
  genuinely-vacant parcels (which earn +14/+22 and rise). In a low-vacancy market like Columbus, the
  assessment's value is a SKIP flag for the caller + the market-calibration insight above.

Caveat: 10-parcel sample — diverse and consistent, but not exhaustive. Expect the conclusion to hold;
re-test if a specific submarket (e.g. a declining corridor) is targeted. Nashville/Charlotte may differ
(test before assuming the same low-vacancy result).
