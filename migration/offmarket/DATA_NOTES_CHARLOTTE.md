# DATA_NOTES_CHARLOTTE.md — Charlotte / Mecklenburg County, NC public data

> Sister market to Nashville. Discovery pass: **2026-06-16**. Every endpoint below
> was hit live (ArcGIS REST) and verified responding. URLs live in
> `lib/sources_charlotte.py`. Read `DATA_NOTES.md` (Nashville) first for the pattern;
> this file only documents what's *different* and what was confirmed.

---

## TL;DR — Charlotte vs. Nashville (what changes)

The same four feeds exist (parcels/CAMA, code enforcement, permits, geometry), all
plain ArcGIS REST, same `lib/arcgis.py` client (POST + paging). Five differences:

1. **Two governments, not one.** Mecklenburg County GIS hosts the assessor/CAMA +
   permits (`meckgis.mecklenburgcountync.gov/server`); the City of Charlotte hosts
   code enforcement + a county parcel-geometry mirror (`gis.charlottenc.gov/arcgis`).

2. **CAMA is one layer, not two.** Owner, mailing address, land use, building SF,
   year-built, sale, value, and a vacant/improved flag all live in
   `TaxParcel_camadata`, keyed on `pid`. No APN join between geometry and CAMA needed.

3. **Industrial filter is inverted.** Nashville: trust numeric `LUCode`, distrust the
   text. Charlotte: `lusecode` is many-to-many with use (one code spans INDUSTRIAL +
   MINI WAREHOUSE + TRUCK TERMINAL), so trust the building-level `bldgtype` / parcel
   `landuse_description` **text** instead. Watch the `MANUFACTURED HOME` trap.

4. **Permits are better here.** 36 years deep (1990→2026), with `permitstat` and
   `compldate`. The "permit pulled but never finaled" anomaly — undefined in
   Nashville's Issued-only feed — IS derivable in Charlotte.

5. **Code enforcement is worse here.** The HNS feature services expose only a rolling
   **~8-week window** (verified 2026-04-22 → 2026-06-15), not multi-year history. The
   "code case in last 24 months" signal must be accumulated forward by the weekly
   cron, or sourced from the City's 311 archive. **Top open risk.**

---

## Confirmed sources

| Source | Host | Service (see `lib/sources_charlotte.py`) | Join key | Carries |
|---|---|---|---|---|
| Parcels + CAMA | Mecklenburg Co GIS | `TaxParcel_camadata/FeatureServer/0` | `pid` | owner, mail addr+state, land use, `bldgtype`, `vacorimprov`, `heatedarea`/`finarea`/`totalarea`, `yearbuilt`, sale, value, acreage, geometry |
| Ownership/values | Mecklenburg Co GIS | `TaxParcel_Camaownershipvalues/FeatureServer/0` | `pid` | `full_owner_name`, `txt_propertyuse_desc`, values, sale (≈1 row/parcel) |
| Parcel geometry | City of Charlotte | `CountyData/Parcels/MapServer/0` | `PID` | geometry + PID only |
| Code enforcement | City of Charlotte HNS | `HNS/CodeEnforcementCasesAll/MapServer/0` | `ParcelId` | `CaseType`, `CaseStatus`, `DateCreated/DateClosed`, `DetailedDescription` |
| Building permits | Mecklenburg Co GIS | `BuildingPermits/FeatureServer/0` | `parcelnum` | `permittype`, `permitstat`, `issuedate`, `compldate`, `bldgcost`, `worktype`, `ownstate` |
| Zoning lookup | City of Charlotte ODP | `ODP/Parcel_Zoning_Lookup/MapServer/0` | `PID` | `Zoning`, `RezoneDate` (bonus) |

**Join keys all share one 8-char parcel-id space** — verified `pid` (`01120121`) ==
geometry `PID` (`00101101`) == code-enf `ParcelId` (`08117651`) == permits `parcelnum`
(`03717437`). Direct equality join, no address normalization needed for the primary path.

ArcGIS query params relied on: `where`, `outFields`, `returnGeometry`,
`returnDistinctValues`, `returnCountOnly`, `outStatistics`, `orderByFields`,
`resultOffset`/`resultRecordCount`. `maxRecordCount`: CAMA 2000, geometry 3000,
permits 2000. Date fields take a literal (`saledate < DATE '2014-01-01'`); raw epoch-ms
comparisons in `where` 400'd on the Mecklenburg server.

---

## Parcels / CAMA — `TaxParcel_camadata`

Key fields: `pid` (PK), `ownrlstnme`/`ownrfrstnme` (+ `ownr2*`), `ownertype`/`ownertyped`
(entity-type classifier — owner regex still useful), `mailaddr1/2`, `city`, `state`,
`zipcode`, `lusecode`, `landuse_description`, `bldgtype`, `vacorimprov` ('VAC'/'IMP'),
`heatedarea`, `finarea`, `totalarea`, `yearbuilt`/`effyearblt`, `saleprice`, `saledate`
(epoch **ms**), `validsale`, `typeofdeed`, `totalvalue`/`totalbldgval`/`totlandval`,
`totalac`, `comunits`/`resunits`.

- **`state <> 'NC'` → out-of-state owner.** Verified real OOS owners on industrial
  parcels (NY, FL, CA, IL, CO, NJ, OH, MI, GA, TN).
- **`vacorimprov = 'VAC'` is a direct vacancy signal** from the assessor — a head start
  on what Nashville had to infer from imagery. (Still confirm neglect on imagery at the
  VLM step; assessor "VAC" means vacant *land/unimproved*, not necessarily a vacant
  *building* — a building can be 'IMP' but empty.)
- **Multiple rows per `pid`, THREE shapes (RESOLVED — use `SUM(DISTINCT heatedarea)`):**
  the feed mixes (a) `heatedarea` repeated as a parcel total, (b) genuine multi-building
  parcels with *differing* per-building `heatedarea`, and (c) literal *duplicate* rows (one
  parcel returns 464,692 SF eight times). So neither `MAX` (undercounts b) nor a raw `SUM`
  (multiplies c) is right. `building_sf = SUM(DISTINCT heatedarea) per pid` excluding
  self-storage `bldgtype` is robust to all three and matches the founder's "SUM of
  structures" rule. `building_sf_largest` = MAX, `building_count` = COUNT(DISTINCT). See
  `ingest/pull_parcels_charlotte.py promote()` + BUILD_LOG §11c.
- `saleprice = 0` = non-arm's-length transfer (same caveat as Nashville's `SalePrice 0`).

### Industrial band — filter on `bldgtype` text, NOT `lusecode`

`lusecode` is many-to-many with use: code `I600` returned `{INDUSTRIAL, MINI WAREHOUSE,
TRUCK TERMINAL, LIGHT MANUFACTURING, INDUSTRIAL PARK, INDUSTRIAL COMMON AREA}`; `C700`
and `O400` similarly mix uses. So the numeric code is **not** a clean key (the opposite
of Nashville). Use the building-level `bldgtype` (most precise) or `landuse_description`.

Real industrial `bldgtype` values present:

| Keep | Exclude |
|---|---|
| HEAVY MANUFACTURING | MINI WAREHOUSE |
| LIGHT MANUFACTURING | MINI WAREHOUSE CLIMATE CONTROL |
| LIGHT MANUFACTURING > 75,000 SF | PREFAB/MINIMAL WAREHOUSE |
| INDUSTRIAL FLEX | WAREHOUSE CONDOMINIUM *(fractured ownership)* |
| INDUSTRIAL RESEARCH & DEVELOPMENT | RETAIL WAREHOUSE DISCOUNT STORE *(retail)* |
| INDUSTRIAL-GENERAL-AVERAGE | **MANUFACTURED HOME-SINGLEWIDE / -DOUBLEWIDE** *(mobile homes — matches "MANUF"!)* |
| MEGA WAREHOUSE | |
| WAREHOUSE-LOGISTICS-LARGE DISTRIBUTION | |
| WAREHOUSE LIGHT DISTRIBUTION | |
| TRANSIT/TRUCK WAREHOUSE | |

### Universe counts (verified 2026-06-16, county-wide incl. Pineville/Huntersville/Matthews)

- Industrial building rows (text filter, excl. self-storage/condo): **6,712**
- …with `heatedarea ≥ 75,000`: **1,029 rows → 556 distinct parcels** (the raw universe,
  pre-vacancy/distress/submarket gates). Compare Nashville's 212.
- Industrial rows flagged `vacorimprov = 'VAC'`: **1,126**

---

## Code enforcement — `HNS/CodeEnforcementCasesAll` (City of Charlotte)

Fields: `ParcelId` (join), `CaseNumber`, `CaseType`, `CaseStatus`, `FullAddress`,
`DateCreated`, `DateClosed`, `Conclusion`, `DetailedDescription`, `Inspector`.

- Distinct `CaseType`: Parking, Graffiti, Housing, Nuisance, Zoning, **Commercial**.
  For industrial distress, Nuisance / Zoning / Commercial matter most.
- **⚠️ Shallow window.** `CasesAll` = 9,677 rows, `ClosedCases` = 7,502 rows, both
  spanning only **2026-04-22 → 2026-06-15** (~8 weeks). `OrderstoDemolish` = 0 rows.
  This feed is a rolling current-cases snapshot, not a 24-month archive. Implications:
  - The "code violation in last 24 months" rule can't be satisfied retroactively.
    Mitigation: have the weekly cron **snapshot + accumulate** cases into our own table
    so the 24-month window fills in over time; and/or pull the City's **311 Service
    Requests** archive (`ODP/ServiceRequests311`) which likely goes deeper.
  - Until then, treat a code case as a strong *current* signal, and down-weight the
    "history" interpretation in `weights.yaml`. (Mirror of Nashville's permit-depth note.)

---

## Building permits — `BuildingPermits` (Mecklenburg County GIS)

Fields: `parcelnum` (join), `permitnum`, `permittype`, `permitstat`, `issuedate`,
`compldate`, `bldgcost`, `worktype`, `workdesc`, `typeofbldg`, `occupancy`,
`heatsqft`/`totalsqft`, `ownname`/`owncity`/`ownstate`.

- **482,211 permits; issue dates 1990-01-04 → 2026-06-15 (~36 yr).** Deep enough to
  compute the real "no permits in 10 yr on a pre-1985 building" signal (Nashville's
  feed only went back ~3 yr).
- Carries `permitstat` (e.g. "Complete") **and** `compldate`, so **"permit pulled but
  never finaled"** is derivable here — the sub-signal that never fired in Nashville.
- `parcelnum` is the same 8-char id as CAMA `pid` (e.g. `03717437`).

---

## Sample candidate deals (live pull, 2026-06-16) — proof the pipeline has targets

Conservative motivated buy-box: industrial `bldgtype`, 75–200k SF, built pre-1995,
long-held (`saledate < 2014`) **or** vacant. **50 distinct parcels** in one pass.
Top by size (assessed value shown; these are leads to skip-trace + image, not vetted):

| PID | Address | SF / Built | Owner (mail) | Signal |
|---|---|---|---|---|
| 08507345 | 625 Johnson Rd, Charlotte | 129,790 / 1951 | CROWN ENTERPRISES INC (Warren, MI) | **VACANT + out-of-state + held since 1994** |
| 14529110 | 807 Pressley Rd, Charlotte | 127,480 / 1972 | 811 PRESSLEY ROAD ASSOC (Charlotte) | **VACANT + held since 1994** |
| 06127110 | 5236 Wilkinson Bv, Charlotte | 167,738 / 1954 | JER CO LLC (Charlotte) | old box, held since 2003 |
| 05701102 | 5435 Hovis Rd, Charlotte | 163,175 / 1957 | JOSEPH T RYERSON & SON (Chicago, IL) | out-of-state, held since 2003 |
| 11303103 | 8309 Wilkinson Bv | 151,580 / 1971 | EMERALD CAROLINA CHEMICAL LLC (Cuyahoga Falls, OH) | out-of-state, held since 2006 |
| 07714104 | 1600 Cottonwood St, Charlotte | 149,188 / 1966 | UPS THRIFT PLAN CORP (Atlanta, GA) | out-of-state, held since 1975 |

NB the **raw** "biggest + out-of-state" sort is dominated by Class-A institutional
distribution (Prologis, Siemens, RREEF, mega-warehouses 600k–1.4M SF) — *not* the
cowarehousing target. The motivated buy-box (mid-size, older, long-held, smaller
LLC/individual owner, vacant/neglected) is what the scoring engine must surface; the
above slice already does that. Out-of-state owner alone is a weak signal here (lots of
institutional capital); combine with age + vacancy + small entity + code case.

---

## Open items before a full Charlotte run

1. ~~Confirm `heatedarea` is parcel-summed vs per-building.~~ **RESOLVED** — it's mixed
   (parcel-total / per-building / duplicate rows); building_sf = `SUM(DISTINCT heatedarea)`
   excluding self-storage. 566 parcels clear the 75k gate. (See CAMA section + BUILD_LOG §11c.)
2. Decide Charlotte-proper vs full Mecklenburg County (data includes Pineville,
   Huntersville, Matthews, Cornelius). Filter on `taxmundist` / `loccity` if scoping.
3. Stand up code-enforcement **history accumulation** (weekly snapshot) + evaluate
   `ODP/ServiceRequests311` for deeper complaint history.
4. Re-tune `weights.yaml` for Charlotte (vacancy is now a hard assessor field; permit
   anomaly is fully supported; out-of-state is weaker). Recalibrate against founder grades.
5. NC has no statewide delinquent-tax open feed equivalent to Nashville's Trustee CSV —
   Mecklenburg delinquent tax is published separately (County Tax Collector); source as
   a periodic file like the Nashville Trustee import.
