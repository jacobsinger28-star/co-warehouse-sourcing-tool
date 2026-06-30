# Nashville Industrial Sourcing MVP — Engineer Brief

**Timeline:** 10 working days, one engineer, Claude as coding copilot.
**Goal:** a ranked, evidence-backed list of acquisition targets in Davidson County, TN, with phone numbers for the top owners and a call sheet the founder can dial from. No mail, no email automation — the output of this system is a **call queue**.

You do not need real estate knowledge. Every domain concept you'll touch is defined in the Glossary below. When in doubt, the rule is: **store the evidence, not the conclusion, and make every score explainable.**

---

## 1. What we're building (one paragraph)

Pull every industrial/flex parcel in Davidson County with a building ≥ 60,000 SF from free public data (~200–800 rows). Enrich each with: owner info, how long they've owned it, tax delinquency, code violations, manual listing-status checks, and an AI-vision assessment of Street View + aerial imagery (is the parking lot empty? how many loading doors? could it be split into small units?). Score each property 0–100 with transparent weighted rules. Sync the top 150 to Airtable where the founder grades and works them. Export the best owners to a skip-tracing service (CSV up/down) to get phone numbers, and generate a per-property call sheet. Everything reruns with `make refresh`.

## 2. Hard scope boundaries

**In scope:** universe table · owner/portfolio resolution · 2 automated distress feeds (code violations, building permits via Socrata) · 1 founder-supplied CSV (delinquent-tax Trustee file) · Street View/aerial fetch + Claude-vision scoring (top 200 only) · rules scoring with `weights.yaml` · Airtable sync · skip-trace CSV export/import · call sheet generator · `make refresh`.

**Off-market only:** no listing data is ingested. Any property actively marketed on Crexi or LoopNet is already broker-controlled and outside the strategy. Vacancy is inferred entirely from VLM imagery (parking fullness, signage) and assessor/Socrata signals.

**Out of scope (do not build, even if tempting):** mailed letters / any mail integration · web scrapers for Crexi/LoopNet (manual CSV instead) · Secretary of State automation (manual SOP instead) · court/bankruptcy data · any ML model · orchestration frameworks (Makefile + one GitHub Actions cron only) · vector databases · second county.

## 3. Glossary — real estate → implementation

| Term | Plain English | In the system |
|---|---|---|
| Parcel / APN | A legally defined piece of land with a county-issued ID ("Map & Parcel" in Davidson, e.g. `093-06-0-123.00`). The primary key of all property data. | `parcels.apn` + polygon geometry. Everything joins on it. |
| Assessor data | The county tax office's public database: owner name, owner mailing address, building square footage, year built, land-use code, last sale date/price, assessed value. ~90% accurate, never 100%. | Source for `parcels`, `properties`, `entities`. |
| Land-use code | County's classification of what the property is (warehouse, office, retail...). | Filter: keep codes containing WAREHOUSE / INDUSTRIAL / MANUF / FLEX-type values. Founder confirms the final list (see FOUNDER_INPUTS.md). |
| Vacancy | The building is empty. **No public dataset has a "vacant" flag** — we infer it: empty parking lot, no business signage, active for-lease listing, neglect-type code violations. | Derived `vacancy_evidence` from VLM output + listing CSV. Store the inputs, not just a boolean. |
| Dark / zombie lease | A tenant still pays rent but has physically left. Looks vacant on imagery, "occupied" on paper. Motivated-seller signal. | Not directly detectable. Flag: strong vacancy evidence + no active listing → "possible dark lease" note for the call. |
| Clear height | Floor-to-lowest-obstruction height in feet. 16'+ is good; 12' is bad (tenants stack goods on racks). **Not in public data.** | `clear_height_est` + `clear_height_source`. Proxy: pre-1975 buildings often <16'. Never auto-reject; mark "verify on call." |
| Dock-high door | Loading door raised ~4 ft so a semi-trailer floor meets the building floor. Visible in Street View as elevated doors with bumpers. | VLM field `dock_doors_est`. |
| Drive-in door | Ground-level garage door a van drives through. Small tenants love these. | VLM field `drive_ins_est`. |
| Truck access | Whether a 53' semi can maneuver to the docks (needs ~120 ft of apron). Bad access scares big tenants away (lowers price) but our small tenants use vans — so "bad" is partly a *positive* signal. | VLM field `truck_access` ∈ easy/tight/bad, scored inversely. |
| Infill submarket | Built-out urban area where new industrial can't easily be built (scarcity) and small businesses are dense (demand). | Founder-drawn polygons (GeoJSON). Gate: `ST_Contains(submarket, parcel centroid)`. |
| Owner entity | Properties are usually owned by an LLC or trust, not a person. You must find the human behind it. | `entities` table; entity→person resolution is **manual** via tnbear.tn.gov (founder/VA does it; you write the SOP doc). |
| Hold period | Years since the owner bought it (from last sale date). Long hold = low cost basis = flexibility to sell at our price. | `hold_years = today − last_sale_date`. |
| Code enforcement | City citations for neglect: overgrown lots, unsafe structure, dumping. Published on data.nashville.gov. | `distress_signals` rows, `type='code_violation'`. |
| Tax delinquency | Owner hasn't paid property taxes. High-precision motivation flag. | Founder supplies Davidson County Trustee CSV; engineer builds generic CSV importer. Does NOT go into `distress_signals` — loaded to a staging table and joined to `properties` at score time. If file is late, `tax_delinquency` component scores 0 — do not block pipeline. |
| Permit anomaly | Permit pulled but never finaled (abandoned work), or zero permit activity on a pre-1985 building. | `distress_signals`, `type='permit_anomaly'`, from Socrata building-permits feed (`pull_permits.py`). Automated. |
| Lis pendens | Pre-foreclosure notice filed in Davidson County Register of Deeds. | Manual only — A-tier owners, recdsonline.com, 2 min per owner. Add to TN SOS SOP checklist (Day 9). |
| Zoning | What the city legally allows on the parcel (Nashville industrial codes look like IWD/IR/IG). | Store `zoning_code` verbatim; no logic on it at MVP. |
| Skip tracing | Looking up a person's phone numbers from name + address via a data broker (BatchSkipTracing, ~$0.15/record, CSV upload → CSV download). | `skiptrace_export.py` / `skiptrace_import.py` → `contacts`. |

## 4. Data sources

| Source | What | How |
|---|---|---|
| Metro Nashville / Davidson County GIS open-data portal | Parcel polygons + assessor attributes (owner, SF, year built, sale history, land use, zoning) | Download shapefile/GeoJSON/CSV extract; load raw to staging first; document columns in `DATA_NOTES.md` as you discover them |
| data.nashville.gov (Socrata API) | **Code enforcement violations** (neglect, unsafe structure, dumping) and **building permits** (lapsed/expired = abandoned work; no-permit-in-10yr on pre-1985 buildings) | `sodapy` or plain REST; join to parcels by normalized address, geometry fallback; `pull_violations.py` + `pull_permits.py` |
| Davidson County Trustee | Delinquent property-tax list | Founder supplies CSV (see FOUNDER_INPUTS.md). Engineer builds generic importer (`import_csv.py`). Pipeline does not block if file is absent — `tax_delinquency` component scores 0. |
| Google Street View Static + static aerial basemap | Site imagery | Top 200 by score only; cache to disk keyed by apn; never re-fetch |
| Claude API (vision) | Structured site assessment | One call per property; JSON schema in `prompts/vlm_site_assessment.md` |
| tnbear.tn.gov (TN Secretary of State) | LLC → human resolution | Manual; you deliver a 1-page SOP, not code |

## 5. Architecture & repo

```
nashville-sourcing/
├── Makefile                  # refresh, score, sync, exports — this IS the orchestrator
├── README.md / RUNBOOK.md / DATA_NOTES.md
├── weights.yaml              # scoring weights, founder-editable
├── .env.example
├── db/migrations/001_schema.sql
├── ingest/
│   ├── pull_parcels.py       # GIS extract → staging → parcels/properties/entities
│   ├── pull_violations.py    # Socrata
│   ├── pull_permits.py
│   └── import_csv.py         # taxes, submarkets (one generic importer)
├── transform/
│   ├── normalize.py          # owner names, addresses, portfolio grouping
│   └── build_universe.py     # land-use + SF filters, submarket gate
├── imagery/
│   ├── fetch_images.py       # 2 Street View headings + 1 aerial, disk cache
│   └── vlm_score.py          # Claude vision → site_observations
├── scoring/score.py
├── sync/airtable_sync.py     # push top 150; pull grades/statuses back
├── outreach/
│   ├── skiptrace_export.py / skiptrace_import.py
│   └── call_sheets.py        # per-property fact summary for the founder's calls
└── tests/                    # gates, normalization, score decomposition
```

**Pipeline (`make refresh`):** pull_* → import_csv (new files) → normalize → build_universe → score (provisional) → fetch_images (new top-200 entrants) → vlm_score (uncached only) → score (final) → airtable_sync.

**Rules:** every script idempotent (upsert on apn) · raw responses land in staging before any transform · per-row failures logged and skipped, stage aborts if >20% of rows fail · all image/VLM results cached on disk so reruns cost $0 · one GitHub Actions cron runs `make refresh` weekly; everything else on demand.

## 6. Ten-day plan

| Day | Deliverable | Done when |
|---|---|---|
| 1 | Supabase + PostGIS up, schema applied, raw parcel data in staging | Row count matches source; columns documented |
| 2 | Universe filter (industrial codes + SF ≥ 60k) → `parcels`/`properties` | Founder spot-checks 20 rows on Google Maps, ≥90% real industrial |
| 3 | `normalize.py`; `entities` with portfolio grouping, hold_years, out-of-state flag | Founder reviews 10 portfolio clusters, no false merges |
| 4 | Violations (`pull_violations.py`) + permits (`pull_permits.py`) ingested from Socrata and joined to parcels; tax-delinquency CSV importer built and ready for founder's Trustee file | Socrata join rate ≥70%; permit anomaly logic (lapsed + no-activity rules) producing rows; every `distress_signals` row has a source_ref; importer accepts Trustee CSV without code changes |
| 5 | `score.py` + `weights.yaml`; **first ranked list exported** | Founder grades top 100 A/B/C same day |
| 6 | Image fetcher run on top 200 | ≥90% have ≥1 usable street image; misses logged |
| 7 | VLM scorer + 25-row human audit with founder | Audit error rate recorded; prompt iterated once |
| 8 | Rescore v0.1 with all signals populated; Airtable board live | Founder works the board with zero engineer help |
| 9 | TN SOS SOP written; skip-trace export/import; first batch run | ≥15 A-tier owners with phone numbers in `contacts` |
| 10 | `call_sheets.py`; full `make refresh` end-to-end; QA checklist; RUNBOOK | Pipeline reruns clean twice from scratch; founder dials first 5 calls from generated sheets |

Day 10 is protected. Cut scope earlier in the week, never from day 10.

## 7. Scoring (summary — weights live in weights.yaml)

Hard gates before scoring: `building_sf ≥ 75,000` (60–75k → manual-review bucket, not killed — assessor SF is noisy) · inside a founder submarket polygon · industrial land use.

Components (100 pts): vacancy evidence 22 (VLM only — empty parking + no signage; no listing data) · tax delinquency 15 (founder CSV — scores 0 if not supplied, do not block) · proximity score 15 · physical fit (VLM composite) 12 · code violations 12 · hold period 8 · owner profile 7 (trust/individual +3, out-of-state +2, estate/heir keyword +2) · permit anomaly 5 · year-built band 5 (1955–1985 scores highest: obsolete for modern users, structurally sound) · truck-access inverse 4 · data-confidence deduction up to −6. Store the full component breakdown as JSON on every score row — "why is this #3?" must always be answerable.

**Strategy note:** there is no `listing_staleness` component and no `listings` table. A property appearing on Crexi or LoopNet is disqualifying context, not a positive signal — it means brokers are already working it. If a founder spot-check reveals a top-ranked property is actively listed, note it in Airtable and deprioritize. Do not build logic around it.

**Tier 1 distress signals — all automated, no manual CSV:**

| Signal | Source | Scored via |
|---|---|---|
| Code violations | Socrata `pull_violations.py` | `code_violations` component |
| Permit anomaly | Socrata `pull_permits.py` | `permit_anomaly` component |
| Out-of-state owner | Assessor → `entities.is_out_of_state` | `owner_profile` component |
| Trust/estate ownership | Assessor name parse → `entity_type` | `owner_profile` component |
| Long hold (15+ yrs) | Assessor → `properties.hold_years` | `hold_period` component |
| Year-built pre-1980 | Assessor → `properties.year_built` | `year_built_band` component |
| Estate/heir keyword | Assessor name parse → `name_raw` | `owner_profile` component |

**Manually checked for A-tier only (add to SOS SOP, Day 9):** Davidson County Register of Deeds lis pendens at recdsonline.com — ~2 min per owner name, surfaces pre-foreclosure situations otherwise invisible.

## 8. Call sheet generator (replaces letters)

`call_sheets.py` renders, per A-tier property, a one-page markdown/PDF the founder dials from:
property address, SF, year built · owner entity + resolved person + phone(s) + confidence · hold years and last sale price · every distress signal with date and source link · VLM observations (dock count, parking fullness, condition, divisibility) with image thumbnails/paths · open questions to verify on the call (clear height always; vacancy if evidence is ambiguous). **Hard rule:** nothing appears as fact on the sheet unless it has a source reference; machine guesses are labeled as guesses.

## 9. QA checklist (run before trusting anything)

1. Universe row count between ~150 and ~1,200 — outside that, the land-use filter is wrong.
2. 20-row founder spot check ≥ 90% pass.
3. Zero duplicate apn; zero null geometries.
4. `building_sf` vs. GIS footprint area mismatch >40% → `sf_confidence='mismatch'`, never silently included.
5. Violation join rate ≥70%; hand-check 10 joins.
6. Every `distress_signals` row has a source reference (enforced, not policy).
7. Score components sum to total; gates unit-tested (74k SF never scores; outside-polygon never scores).
8. VLM: schema-invalid responses rejected and logged, never written; model must be allowed to answer "not_visible" instead of guessing; 25-row audit complete.
9. Skip-trace hit rate measured (expect ≥50–60% after manual SOS resolution).
10. `make refresh` runs clean twice consecutively with identical row counts.

The three places silent garbage enters: address joins, the assessor SF field, and VLM dock counts. Test those hardest.

## 10. Definition of done (day 14)

- Verified universe table of every ≥60k SF industrial/flex property in Davidson County.
- Explainable 0–100 score on each, calibrated once against founder grades.
- Imagery + VLM assessments on the top 200 with a measured audit error rate.
- Airtable board the founder operates independently.
- ≥15 A-tier owners resolved to a human with a phone number; call sheets generated; first dials logged in `outreach_log`.
- `make refresh` rebuilds everything in one command.
