# DATA_NOTES.md — what the public data actually looks like

> Living document. Re-generate the source schemas with `python tools/discover_sources.py`.
> First pass: **2026-06-11** (Day 1 discovery). All endpoints below verified responding.

---

## TL;DR — three corrections to ENGINEER_BRIEF.md assumptions

The brief was written against a data layer that has since changed. Three things are
different from what the brief / `.env.example` assume. None are blockers; all change
*how* we ingest, not *whether* we can.

1. **`data.nashville.gov` is no longer Socrata — it's ArcGIS Hub.**
   The brief says violations + permits come from "the Nashville.gov Socrata API"
   via `sodapy`. That API now 404s. The portal migrated to ArcGIS Hub, and the
   datasets are **ArcGIS Feature Services** queried with the same REST pattern as
   the parcel layer. `sodapy` is dropped from `requirements.txt`. → affects
   `pull_violations.py`, `pull_permits.py` (Day 4).

2. **Building SF + year-built are not in the ownership/parcel layer.**
   In the base parcel layer, `StatedArea == Acres` (land area, not building SF),
   and there is no year-built column. Building square footage (`FinishedArea`) and
   `YearBuilt` live in a **separate CAMA layer** (`Parcels_with_Building_Characteristics_view`),
   joined on `APN`. → affects `build_universe.py` (the 75k gate) and `year_built_band`.

3. **Violations and permits carry a parcel/APN join key — no fragile address match.**
   Violations have `Property_APN`; permits have `Parcel`. The brief budgeted for a
   shaky "normalize address → join, geometry fallback" with a ≥70% target. We can
   join directly on APN, which should push the join rate well above that. Address
   matching becomes a *fallback*, not the primary path.

One more, smaller: the permit anomaly "pulled but never finaled" signal is **not
directly derivable** from the Issued feed (it has no finaled/expired status column).
See the permits section. The other half ("no permits in 10yr on a pre-1985 building")
is fully derivable.

---

## Confirmed sources (see `lib/sources.py` for the URLs)

| Source | Service | Join key | Carries |
|---|---|---|---|
| Ownership parcels | `maps.nashville.gov` Cadastral/Parcels/0 | `APN` | geometry, owner, mailing addr+state, `OwnDate`, `SalePrice`, `LUCode`/`LUDesc`, `Acres`, appraisal |
| Building characteristics (CAMA) | AGOL `Parcels_with_Building_Characteristics_view/0` | `APN` | `FinishedArea`, `YearBuilt`, `StructureType`, `Exterior`, `AssessorCardNumber` |
| Code violations | AGOL `Property_Standards_Violations_2/0` | `Property_APN` | `Date_Received`, `Reported_Problem`, `Status`, `Last_Activity_Date`, `Violations_Noted`, `Property_Owner` |
| Permits issued | AGOL `Building_Permits_Issued_2/0` | `Parcel` | `Permit__`, `Permit_Type_Description`, `Date_Issued`, `Const_Cost`, `Address`, `Purpose` |

All AGOL services live in Metro Nashville's org `services2.arcgis.com/HdTo6HJqh92wn4D8`.
ArcGIS REST query params we rely on: `where`, `outFields`, `returnGeometry`,
`returnDistinctValues`, `returnCountOnly`, `outStatistics`/`groupByFieldsForStatistics`,
`resultOffset`/`resultRecordCount` (paging — `maxRecordCount` is 1000–2000 per layer).

---

## Parcels / assessor — ownership layer

`maps.nashville.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0`

Key fields: `APN` (PK), `Owner`, `OwnAddr1/2/3`, `OwnCity`, `OwnState`, `OwnZip`,
`OwnDate` (epoch **ms** — divide by 1000 for unix), `SalePrice`, `PropAddr` (situs),
`LUCode`, `LUDesc`, `Acres`, `DeededAcreage`, `TotlAppr`, `TotlAssd`.

- **APN format here is dashless** (`01800011400`, `012150A20100CO`) — different from the
  brief's "Map & Parcel" dashed example `093-06-0-123.00`. Store verbatim; normalize a
  copy if we ever cross-reference a dashed source. There's also a `STANPAR` field.
- `OwnState <> 'TN'` → `is_out_of_state`. Verified real out-of-state owners in the data
  (NY, CA on large warehouse parcels).
- `SalePrice == 0` on some rows = non-arm's-length transfer; treat 0 as "no usable price."
- Owner name examples for the entity_type regex (Day 3): `100 NORTHFORK, LLC` (llc),
  `DES-CASE CORPORATION` (corp), `HADLEY, EDMUND DABNEY III` (individual),
  `DOGWOOD HOLDINGS II PROPCO TN, LLC` (llc).

### Land-use values actually present (industrial band)

Davidson County uses **numeric `LUCode`** with text `LUDesc`. Real industrial codes:

| LUCode | LUDesc | Keep? |
|---|---|---|
| 064 | SMALL WAREHOUSE | yes |
| 077 | TERMINAL/DISTRIBUTION WAREHOUSE | yes |
| 071 | LIGHT MANUFACTURING | yes |
| 072 | HEAVY MANUFACTURING | yes (confirm on imagery — conversion difficulty) |
| 070 | VACANT INDUSTRIAL LAND | maybe (may have structures; SF gate handles it) |
| 063 | MINI WAREHOUSE | **exclude** (self-storage competing use) |

- **Data-quality flag:** the description is misspelled in the data as
  `TERMINAL/DISTRIBUTION WARHOUSE` (no second "E") *and* the correct spelling both exist.
  → match on **`LUCode`**, not `LUDesc` text. (Confirms the brief's "use ILIKE not equality"
  instinct — but code-equality is even safer here.)
- Count of parcels in LUCode `('064','077','071','072','070')`: **2,301** (pre-SF, pre-submarket).
- `imports/land_use_codes.yaml` is written around text descriptions / zoning codes; the
  real filter should be **LUCode-based**. Flagged for founder 10-min review (Day 2).

---

## Building characteristics (CAMA) — where SF + year live

`.../Parcels_with_Building_Characteristics_view/FeatureServer/0` — "Parcels with CAMA Attributes"

Fields: `APN`, `AssessorCardNumber`, `StructureType`, `FinishedArea` (SF),
`YearBuilt`, `Exterior`, `floornumber`, `DateEffective`, `Shape__Area` (footprint geom).

- **No clear/ceiling height anywhere** (re-verified live 2026-06-16): not in this CAMA
  layer, not in the ownership-parcel layer. `floornumber` is floor *count*, `FloorOrder`
  a parcel-stacking index — neither is a height. It's the one industrial metric absent
  from every public feed (assessors don't record it; it lives in broker/CoStar data we
  exclude). We instead **measure roof/eave height from free USGS 3DEP LiDAR** (Davidson
  2022 QL1) in `imagery/lidar_height.py` → `properties.clear_height_est`
  (`clear_height_source='lidar'`). It's an exterior-roof estimate (interior clear ~2–4 ft
  less); a triage signal, confirmed on the call. Free-vs-paid options: TOOLS_REGISTRY §9.

- **One row per building/card per APN.** Example APN `01800011400`:
  card 1 WAREHOUSE 100,288 SF (1986) · card 2 WAREHOUSE 100,625 SF (1986) ·
  card 3 OFFICE 3,520 SF (1989). Summed = 204,433 SF.
  Example APN `01900001900`: two WAREHOUSE buildings 21,600 + 23,400 = 45,000 summed,
  but **neither single building ≥ 75k**.
- `StructureType` is a **building-level** classifier (WAREHOUSE, MANUFACTURING PLANT,
  TRUCK TERMINAL, MINI WAREHOUSE, CLIMATE CONTROL MINI WAREHOUSE, OFFICE, …). This is
  *more precise* than parcel-level `LUDesc` and is the better industrial filter.
  Exclude `MINI WAREHOUSE` / `CLIMATE CONTROL MINI WAREHOUSE` (self-storage).
- Building rows with `FinishedArea >= 75000` (all types, county-wide): **1,149**.
  After restricting to industrial `StructureType` + the buy-box gate this should land
  in the brief's expected 150–1,200 universe range. (QA item #1.)
- `footprint_sf` cross-check (schema field): use `Shape__Area` (or the parcel polygon
  area). A >40% mismatch vs `FinishedArea` → `sf_confidence='mismatch'` (QA item #4).

### ✅ RESOLVED — founder decision (2026-06-11): `building_sf` = SUM of structures

**`building_sf` is the SUM of all non-self-storage structures on the parcel**, and the
75k hard gate runs on that sum (`pull_parcels.promote` → `SUM(finished_area) FILTER
(WHERE structure_type NOT IN <self-storage>)`; `db/migrations/002`). `building_sf_largest`
and `building_count` are stored alongside so a "75k across four small boxes" parcel stays
distinguishable from one 100k box when working the list — the subdivision read cares about
that even though the gate doesn't.

I'd originally recommended gating on the *largest* single structure (favoring one
contiguous divisible box); the founder chose **SUM** so multi-building industrial campuses
that are still subdividable aren't missed. The `largest` value is retained, so we can
re-segment on it later without re-ingesting. Example `01900001900`: two warehouses
21,600 + 23,400 = 45,000 summed — still below 75k, so excluded either way.

---

## Parcel-layer hygiene (verified Day 2)

- All 2,301 industrial-band parcels are `IsActive='Y'`, `ParType='PAR'` — no
  retired/historical parcel contamination, no condo-unit weirdness in this band.

## Code violations (Property Standards)

`.../Property_Standards_Violations_2/FeatureServer/0`

- **Verified live (Day 2):** `Property_APN` format matches our parcel APNs exactly
  (dense, e.g. `10804015100`) — direct equality join, no normalization needed.
  Ingested: 303 violations on 210 of our parcels, 202 within the 24-mo window.
- The feed can return literal duplicate rows — ingest dedupes on `Request_Nbr`.
- Join on `Property_APN` (direct — no address normalization needed for the primary path).
- `Date_Received` drives the "within 24 months" scoring window. `Reported_Problem` +
  `Violations_Noted` + `Status` describe the citation; `source_ref` for `distress_signals`
  = the dataset URL + `Request_Nbr`.
- Still spot-check 10 joins by hand (QA item #5) — APN formatting drift between the CAMA
  APN and the violations `Property_APN` is the thing to watch.

## Building permits

`.../Building_Permits_Issued_2/FeatureServer/0` — join on `Parcel`.

- `Date_Issued`, `Permit_Type_Description`, `Const_Cost`, `Purpose`.
- **⚠️ Feed depth measured (Day 2): history starts 2023-06-09 — only ~3 years, not
  the 10 the anomaly spec assumed.** `no_permits_10yr_pre1985` is effectively
  "no permits in 3 years" until a deeper source is found; every signal's detail
  string states this. Founder decision pending: keep/down-weight (weights.yaml
  gives it 3 pts) or source deeper permit history.
- Ingested: 795 permits on 362 of our parcels; 98 anomaly signals derived (gated
  parcels only). Stale absence-flags are deleted on each run (a parcel that pulls
  a permit loses the flag). Feed contains duplicate rows — deduped on (permit, parcel).
- **`permit_lapsed_or_expired`** signal: **NOT directly derivable** from this feed —
  there is no finaled/expired/CO status column. Dropped for MVP per (a) below; the
  weights rule exists but never fires.
  Options: (a) drop this sub-signal for MVP
  and rely on the 10yr-gap signal (weights still valid, just one rule never fires), or
  (b) source a permits-with-status feed later. Recommend (a) for the sprint.

---

## Environment notes

- No PostGIS/Supabase provisioned yet in this workspace. Postgres.app is installed
  locally (`psql` on PATH). Decision pending: Supabase project vs. local Postgres+PostGIS
  for dev. Schema (`db/migrations/001_schema.sql`) is ready to apply to either.
- Python 3.13. Present: `requests`, `pyyaml`, `pandas`. Missing (need install):
  `psycopg2-binary`, `shapely`, `anthropic`, `pyairtable`. `sodapy` intentionally NOT
  needed (no Socrata). `geopandas` optional.
- Network egress to `maps.nashville.gov`, `services2.arcgis.com`, `arcgis.com` works.

## The three places silent garbage enters (brief §9) — and our mitigations

1. **Address joins** → mitigated: APN/Parcel join keys exist on both feeds; address is fallback only.
2. **Assessor SF field** → multi-card aggregation + `footprint_sf` mismatch check + the
   largest-vs-sum decision above.
3. **VLM dock counts** → schema forces `not_visible` + per-field confidence; Day-7 25-row audit.

---

## Visual vacancy + use-truth assessment (2026-06-20) — Nashville DOES have real vacancy

Method: Claude-as-VLM via the Claude-in-Chrome extension (Google Maps **satellite** per parcel's
point-on-surface + **Street View** where occupancy was ambiguous; POC in BUILD_LOG §26d / memory
`vacancy-via-chrome-vlm`). Use cases **#1 vacancy/occupancy + #5 use-truth** (`docs/SCREENSHOT_USES.md`).
Scope: the **top 9 of the top-25 call queue** (score 41 → 31, the highest-ranked industrial parcels).
Every read landed via `imagery/record_observation.py` (no hand SQL); re-scored `--stage final` after.

**Result: 1 probable true vacant, 1 conversion, 3 use-mismatches, 4 confirmed-active.** Unlike Columbus
(10/10 occupied — `DATA_NOTES_COLUMBUS.md`), Nashville's top queue contains a genuinely idle industrial box.

| # | APN | Address | Occupancy | Use-truth (vs assessor) | Flag |
|---|---|---|---|---|---|
| 1 | 10602000900 | 1025 Elm Hill Pike | occupied | Norandex / ABC Supply distribution | ✓ matches |
| 2 | 09308008200 | 1106 Davidson St | **vacant (probable)** | metal-fab plant (Parthenon) | 🚩 **TRUE VACANT** |
| 3 | 09307001200 | 710 S 2nd St | occupied | O'Neal Steel service center | ✓ matches |
| 4 | 09308003500 | 615 Davidson St | occupied (full) | Beaman auto body/storage | ⚠️ use ≠ warehouse |
| 5 | 10606004800 | 1012 Foster Ave | occupied | multi-tenant flex (Madina restaurant + towing) | ⚠️ use ≠ warehouse |
| 6 | 10512006700 | 970 Fiber Glass Rd | occupied | GAF manufacturing (rail-served) | ✓ matches |
| 7 | 08211008300 | 515 Foster St | occupied, **low activity** | Excess Equip / equipment yard | aerial-only (no SV) |
| 8 | 09102023900 | 5901 California Ave | occupied | warehouse (fresh white roof) | ✓ matches |
| 9 | 07202005300 | 1015 W Kirkland Ave | occupied (full) | creative/maker district | 🚩 **CONVERSION** |

### The two flags that matter
- **🚩 1106 Davidson St — probable true vacant.** Google place label reads *"Temporarily closed"*
  (Parthenon Metal Works Fab Plant); aerial **and** Mar-2025 Street View both show an empty parking lot,
  empty yard, perimeter weeds, idle equipment left in the lot, **no wall signage**, and a rust-stained/
  patched east roof. A **125,900 SF idle riverfront industrial box** = strong motivated-owner lead. Two
  sourced `visual_distress` rows landed (weeds, idle equipment).
- **🚩 1015 W Kirkland Ave — conversion.** Now The Color House Nashville / The Bright Works inside a dense
  converted-industrial creative-maker district (Crazy Gnome Brewery, Contrast Cine + The Backlot Studio
  film, Ed Nash Fine Art, The Aero Bar, F.A.B. Pizza, The Song Mill, Digital Love Studio, tattoo).
  Recorded `matches_landuse=false` → the call sheet prints the "no longer matches assessor land use"
  warning. Not a cowarehousing target.

### Effect on the queue (re-score, version v0.1-final)
- **1106 Davidson St moved #2 → #1 (score 37 → 61):** imagery filled `vacancy_evidence` to the **full
  22-pt tier** (empty parking + signage=no). This is the layer doing its job — the single biggest
  accuracy win in the brief.
- **515 Foster St → #2 at `vacancy_evidence=14`** (sparse-parking tier; **capped at 14 because the interior
  point has no Street View** to confirm signage). NOT called vacant — a live "Excess Equip" place label +
  staged machinery argue against it. Worth a drive-by to settle activity.
- Multi-tenant reads (1012 Foster Ave, 1015 W Kirkland) added `physical_fit=5` via `divisibility=multi_entry`.
- **Use-truth is evidence, not a scored weight** (per `record_observation.py` / SCREENSHOT_USES): the
  conversion + auto-use mismatches show on the call sheet but do NOT deduct score. The 3 occupied
  use-mismatches (Beaman auto, Foster flex, Kirkland conversion) self-deprioritize on occupancy anyway.

### Implication for Nashville strategy
- **The vacancy thesis DOES apply here** (the Columbus contrast): the very top of the data-ranked queue
  hides a real idle box once you look. Imagery is worth running on the rest of the top 25+.
- **The 4 "✓ matches" are the false-positive killer working:** Norandex/ABC, O'Neal Steel, GAF, 5901
  California all score high on data but imagery proves they're thriving operations — a SKIP flag for the
  caller, not a lead.

**Status / gaps:** only **parcels 1–9 of 25 done** (stopped at founder request). Parcels 10–25 unread.
Dock counts (#2) would need a 20z pass. Street View was unavailable at 515 Foster's interior point
(known caveat — try a nearby road point if activity must be confirmed). Sample is small but already
disproves "Nashville = Columbus-style low-vacancy."
