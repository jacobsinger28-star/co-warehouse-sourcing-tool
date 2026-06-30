# TOOLS_REGISTRY.md — every tool, key, service & dataset this project needs

> **The canonical, single-source list.** Anything the pipeline depends on — API keys,
> paid accounts, free data sources, runtime, Python deps, founder-supplied files — is
> indexed here with its status, cost, and what it blocks. Deep-dive on imagery options
> lives in [IMAGERY_TOOLS.md](IMAGERY_TOOLS.md); the running build narrative is in
> [BUILD_LOG.md](BUILD_LOG.md). Last verified **2026-06-16**.
>
> Jump to **[§8 End-of-day acquisition checklist](#8-end-of-day-acquisition-checklist)**
> for the copy-paste "what do we still need to buy/get" list.

## Status legend
| Mark | Meaning |
|---|---|
| ✅ | Have it / in use, no action |
| 🆓 | Free, working, no key required |
| 💲 | **Paid or key needed — not yet acquired** (the action items) |
| ⏳ | Optional / nice-to-have / future-scaling |
| ⛔ | Blocks a pipeline stage today |

## 1. Status dashboard
- **Working now (free / already have):** local Postgres+PostGIS, all 4 public ArcGIS
  feeds, free aerial imagery, Python toolchain. The pipeline runs end-to-end today.
- **Second market built (2026-06-16):** **Charlotte / Mecklenburg County, NC** — same
  pipeline (`make charlotte`), isolated DB schema, **566 scored parcels**. Runs on **3 free
  Mecklenburg/Charlotte ArcGIS feeds, no keys** (see §4b). The paid keys below are
  market-agnostic (they cover Charlotte too); Charlotte additionally needs its own founder
  data — submarket polygons, a Mecklenburg delinquent-tax file, top-100 grades (§7).
- **Blocking key gaps (💲⛔):** `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY` (→ imagery +
  vacancy), `AIRTABLE_API_KEY`/`BASE_ID` (→ grading board), BatchSkipTracing account
  (→ remaining owner phones), **DNC scrub service** (→ legal pre-dial).
- **Contact enrichment status:** 37/50 top owners now have a source-backed phone via **free
  public-records research** (no skip-trace account) — but mostly switchboard lines; the 13
  blanks + personal cells still need BatchSkipTracing. `contacts.dnc_checked` is FALSE → a
  DNC scrub is required before dialing. (See §3 and BUILD_LOG §12.)
- **Founder data still owed:** Trustee delinquent-tax CSV; top-100 A/B/C grades; (optional)
  real submarket polygons.
- **Cost reality (2026-06-16 night):** the P1 keys are cheap for a *first pass* but **recur
  monthly at scale** — Google Maps ~$50–200, Anthropic ~$75–300, Airtable ~$20/user (full list
  exceeds the 1k free-record cap), Supabase ~$25 once always-on. **Contacts split two ways:**
  **BatchData** for individual-owner cells, **Apollo** for entity-owner principals/emails (try
  both free tiers on the top-100 first). **AI calling layer is built vendor-agnostic** (pick a
  vendor → one adapter; BUILD_LOG §15) and **Pipedrive is LIVE** (token wired 2026-06-22; ranked
  leads push to the Leads Inbox — BUILD_LOG §35).
  **DNC scrub is the one piece left before live calling.** **No scraper needed** (official ArcGIS
  APIs + free CSVs). See `SESSION_HANDOFF_2026-06-16_night.md` + BUILD_LOG §15.

---

## 2. API keys & secrets (`.env`)
Copy `.env.example` → `.env`. `.env` is gitignored (PII/secrets) — never commit it.

| Var | Status | Purpose | Used by | Cost | Blocks if missing |
|---|---|---|---|---|---|
| `DATABASE_URL` | ✅ set (local) | Postgres/PostGIS connection | everything (`lib/db.py`) | free local / Supabase free tier | all |
| `PGPORT` | ✅ set | local PG port (5432) | local dev | free | local run |
| `GOOGLE_MAPS_API_KEY` | 💲⛔ empty | Street View Static + Maps Static (site imagery) | `imagery/fetch_images.py` | first pass <$5; **recurring ~$50–200/mo at scale** (markets × refresh) | imagery → vacancy/physical-fit |
| `ANTHROPIC_API_KEY` | 💲⛔ empty | Claude vision VLM (reads images → scores) | `imagery/vlm_score.py` | first pass single-digit $; **recurring ~$75–300/mo at scale** (model tier × refresh) | VLM → vacancy/dock/condition |
| `AIRTABLE_API_KEY` | 💲⛔ empty | grading/working board sync | `sync/airtable_sync.py` | free tier (≤1k records/base) covers top-100; **full list → ~$20/user/mo** | A/B/C grades, `--grade A` outreach |
| `AIRTABLE_BASE_ID` | 💲⛔ empty | which Airtable base | `sync/airtable_sync.py` | free | Airtable sync |
| `IMAGE_CACHE_DIR` | ✅ set | disk cache for fetched imagery | imagery | free | — |
| `IMPORTS_DIR` | ✅ set | where founder CSVs are read from | `ingest/import_csv.py` | free | CSV imports |

---

## 3. Paid tools / accounts to acquire — the shopping list for Jake
Priority order. Imagery cost/coverage detail in [IMAGERY_TOOLS.md §4](IMAGERY_TOOLS.md).

| # | Tool / account | Unlocks | Rough cost | Status |
|---|---|---|---|---|
| **P1** | **Google Maps Platform** key (Street View Static + Maps Static) | street-level imagery → full **22-pt vacancy**, signage, dock vs drive-in doors | first pass <$5; **~$50–200/mo recurring at scale** | 💲⛔ |
| **P1** | **Anthropic API** key (Claude vision) | the VLM reader — images → structured scores at scale | first pass single-digit $; **~$75–300/mo recurring at scale** | 💲⛔ |
| **P1** | **Airtable** account (key + base id) | grading board; closes the human-grade → outreach loop | free tier (≤1k records) covers top-100; **full list → ~$20/user/mo** | 💲⛔ |
| **P2** | **BatchData** account (a.k.a. BatchSkipTracing) | owner phone/email for the call list (export/import code built + tested). **Best for individual / small-LLC owners → personal cells.** Free public-records research got **37/50** owner phones — but mostly operating-company/switchboard lines; the **13 opaque LLC/GP/trust owners + personal cell numbers** need a real trace | ~$0.10–0.25/hit | 💲⛔ |
| **P2** | **Apollo** (apollo.io) | B2B contact DB — finds the **principal + work email** behind corporate / out-of-state **entity** owners (complements BatchData's individual-owner cells). Run **both free tiers against the top-100 first** and keep whichever wins for our entity-heavy mix before paying | free tier (limited credits) → ~$49–99/user/mo | ⏳💲 |
| **P2** | **DNC scrub service** (DNC.com / Contact Center Compliance / dialer built-in) | legal pre-dial Do-Not-Call scrub — `contacts.dnc_checked` is **FALSE** for every contact today; required before any calling | ~$50–150/mo per volume | 💲⛔ |
| **P2** | **AI calling service** *(vendor still being chosen)* | 3rd-party AI voice agent that dials the ranked queue. **The integration is already built vendor-agnostic** (`outreach/call_provider.py` — one `CallProvider` subclass + `CALL_PROVIDER=<name>` to wire a real vendor; ships with a no-network `stub`). Candidates: **Bland.ai / Vapi / Retell / Synthflow.** Plan for **caller-ID reputation** (branded/verified number; don't burn one number on hundreds of calls) and **state AI-disclosure** law (every script opens with an AI disclosure). | per-minute / per-call, vendor-dependent | ⏳ |
| **P2** | **Pipedrive** (CRM — already owned) | outreach system of record. **TOKEN LIVE (2026-06-22)** — account "Simi Capital Group"; `PIPEDRIVE_API_TOKEN`+`DOMAIN`+`USER_ID` in `.env`. **Two flows, separate link tables:** (1) `sync/pipedrive_leads.py` → **Leads Inbox** (ranked universe → Org/Person/Lead + context Note; idempotent via `crm_lead_links`; **Nashville top-10 pilot pushed**). (2) `sync/pipedrive_sync.py` → **Deals** from completed AI calls (idempotent via `crm_links`; nothing to push yet — `outreach_log` empty). `--dry-run` previews either without writes. **Open:** scale leads beyond the pilot (founder's call); reconcile workflow when a property is both a Lead and (later) a Deal. | already owned | ✅ token live |
| **P2** | **OpenCorporates API** *(or TN SOS bulk data)* | programmatic registered-agent / officer pulls — avoids the tnbear/Bizapedia CAPTCHA walls that blocked round-1 lookups (the free `opengovus.com` mirror works manually for now — see §4) | API sub | ⏳💲 |
| **P3** | **Deed / grantor lookup** (ATTOM / Regrid deed feed, or county Register of Deeds bulk) | names the human behind GPs/trusts **not registered with the SOS** (most of the 13 contact blanks) | subscription | ⏳ |
| **P3** | **Phone validation / line-type** (Twilio Lookup / NumVerify) | verify a number is live + flag mobile vs landline before dialing the list | per-lookup (cheap) | ⏳ |
| **P2** | **USPS vacancy flag** (Melissa / BatchData) | a **direct** vacancy signal (not pixel-inferred) — best non-imagery vacancy source | per-record / small license | ⏳💲 |
| **P3** | **Nearmap / EagleView (Pictometry)** | sub-3in **oblique** aerial (building sides, signage) where Street View hasn't driven | $thousands/yr | ⏳ |
| **P3** | **Regrid / ReportAll / ATTOM** | nationwide parcel+owner+building data for re-pointing to other markets | subscription | ⏳ |
| **P3** | **Reonomy** (clear-height attribute) — *recommended* | **authoritative interior clear height** at scale, where we today have only a free LiDAR *roof-height estimate* (see §4 / §9) | API sub, ~$ (mid) | ⏳ |
| **P3** | **CoStar** (clear-height attribute) — alternative | the most *complete* clear-height coverage of any vendor | $$$$ / yr | ⏳ |
| — | **Supabase** project (prod DB) | hosted Postgres/PostGIS for production (local works for now) | free tier → paid at scale | ⏳ |

---

## 4. Free data sources in use (no key, verified)
The pipeline's spine — all public, no key, no quota seen. URLs in `lib/sources.py`;
imagery detail + export verification in [IMAGERY_TOOLS.md](IMAGERY_TOOLS.md).

| Source | What | Used by | Status |
|---|---|---|---|
| Nashville ArcGIS — Cadastral/Parcels | geometry, owner, land use, sale | `ingest/pull_parcels.py` | 🆓✅ |
| Nashville ArcGIS — CAMA building view | building SF, year built, structure type | `ingest/pull_parcels.py` | 🆓✅ |
| Nashville ArcGIS — Property Standards Violations | code-violation distress signals | `ingest/pull_violations.py` | 🆓✅ |
| Nashville ArcGIS — Building Permits Issued | permit-anomaly signals (~3yr depth) | `ingest/pull_permits.py` | 🆓✅ |
| **Nashville ArcGIS — Imagery (6in ortho, 1996–2023)** | **free aerial → `parking_fullness`, yards, condition** | (wire into `fetch_images.py`) | 🆓 ready |
| **USGS 3DEP LiDAR — Davidson Co 2022 QL1 (EPT)** | **free `clear_height_est` (roof height) — the one industrial metric absent from every assessor feed** | `imagery/lidar_height.py` | 🆓✅ |
| TNMap statewide imagery / USGS NAIP | fallback + historical aerial; national coverage | future / re-point | 🆓 |
| Mapillary | free crowdsourced street-level (spotty industrial; CC-BY-SA, attribution req.) | optional signage | 🆓⏳ |
| TN SOS (tnbear.tn.gov) + Register of Deeds | entity→human, lis-pendens (manual SOP) | `docs/SOS_SOP.md`, `ingest/import_csv.py` | 🆓 manual |
| **opengovus.com (TN business mirror)** | **free TN SOS registered-agent/officer lookup that is NOT CAPTCHA-walled** — cracked the entity→human step where tnbear/Bizapedia/OpenCorporates blocked us (BUILD_LOG §12) | manual / `docs/SOS_SOP.md` | 🆓 ✅ |

---

## 4b. Charlotte / Mecklenburg County, NC — free sources (verified live 2026-06-16)
The Charlotte market's spine. All public, no key. URLs + fields in `lib/sources_charlotte.py`
and [DATA_NOTES_CHARLOTTE.md](../DATA_NOTES_CHARLOTTE.md). Note: **two governments** — Mecklenburg
County GIS hosts CAMA + permits; the City of Charlotte hosts code enforcement.

| Source | What | Used by | Status |
|---|---|---|---|
| Mecklenburg ArcGIS — `TaxParcel_camadata` | owner, mailing addr+state, land use, building SF, year, sale, geometry — **all in one layer** (key `pid`) | `ingest/pull_parcels_charlotte.py` | 🆓✅ |
| Mecklenburg ArcGIS — `BuildingPermits` | permit-anomaly signals — **~36yr deep, has status + completion date** (richer than Nashville's ~3yr feed) | `ingest/pull_distress_charlotte.py` | 🆓✅ |
| City of Charlotte ArcGIS — `HNS/CodeEnforcementCasesAll` | code-violation signals. **⚠️ rolling ~8-week window only** — weekly cron must accumulate history (top open risk) | `ingest/pull_distress_charlotte.py` | 🆓✅ |
| NC SOS business registry (`sosnc.gov`) + Register of Deeds | entity→human, lis-pendens — **NC analog of the TN SOS SOP**; SOP needs an NC version (find a non-CAPTCHA mirror like opengovus did for TN) | manual | 🆓 ⏳ build SOP |
| NC statewide QL2 LiDAR / USGS 3DEP (covers Mecklenburg) | free `clear_height_est` roof estimate — same idea as Davidson 3DEP | `imagery/lidar_height.py` (needs NC re-point) | 🆓 ⏳ pending wiring |

**Shared keys cover Charlotte too (no new accounts):** the imagery/VLM (`GOOGLE_MAPS_API_KEY`,
`ANTHROPIC_API_KEY`), grading (`AIRTABLE_*`), skip-trace (BatchSkipTracing) and DNC-scrub items in
§2/§3 are **market-agnostic** — once acquired they unlock those stages for Charlotte and Nashville
both. Charlotte-specific *founder data* (submarkets, delinquent-tax, grades) is in §7.

---

## 5. Runtime & infrastructure
| Component | Status | Notes |
|---|---|---|
| Python 3.13 + `.venv` | ✅ | recreate venv only on re-clone/machine change (see CLAUDE.md) |
| Postgres 11 + PostGIS 2.5 (Postgres.app, local) | ✅ | start manually (CLAUDE.md "How to run"); data lives outside repo |
| Supabase (PG15+/PostGIS3) | ⏳ | production target; needs full `make refresh` re-verify on cutover |
| GitHub Actions (weekly cron) | ⏳ | scheduled refresh; not yet wired |

## 6. Python dependencies (`requirements.txt`)
`requests` · `PyYAML` · `pandas` · `shapely` · `psycopg2-binary` · `python-dotenv` ·
`anthropic` · `pyairtable` · `tenacity` · `laspy[lazrs]` (LiDAR clear-height) · `pytest` (dev).
*(`sodapy` intentionally absent — no Socrata; see DATA_NOTES.md.)*

## 7. Founder-supplied data inputs (`imports/`)
| File | Status | Feeds |
|---|---|---|
| `trustee_delinquent.csv` | 💲⛔ owed | tax-delinquency score (15 pts) |
| `submarkets.geojson` | ⏳ (single circle now) | buy-box gate; real 8 polygons pending |
| top-100 A/B/C grades | 💲 owed | score calibration (Day-5) |
| `sos_contacts.csv` / `lis_pendens.csv` | 🆓 loaders ready | SOS people / pre-foreclosure flags |
| BatchSkipTracing return CSV | ⏳ | owner phones (import code built) |
| **`charlotte_submarkets.geojson`** | ⏳ (placeholder ~20mi circle now) | **Charlotte** buy-box gate; real submarket polygons pending |
| **Mecklenburg delinquent-tax file** | 💲 owed | **Charlotte** tax-delinquency score (from the County Tax Collector; NC analog of `trustee_delinquent.csv`) |
| **Charlotte top-100 A/B/C grades** | 💲 owed | **Charlotte** score calibration |

---

## 8. End-of-day acquisition checklist
Copy-paste. "Get/Buy" = action needed; rest is reference.

```
KEYS TO ADD TO .env  (all empty today)
  [ ] GOOGLE_MAPS_API_KEY     — Street View + Static Maps   (~$, <$5 full run)   P1
  [ ] ANTHROPIC_API_KEY       — Claude vision VLM            (~$, single digits)  P1
  [ ] AIRTABLE_API_KEY        — grading board                (free tier)          P1
  [ ] AIRTABLE_BASE_ID        — "                            (free)               P1

ACCOUNTS TO OPEN
  [ ] BatchData (BatchSkipTracing) — individual-owner cells   (~$.10-.25/hit)      P2
  [ ] Apollo (apollo.io)      — entity-owner principal+email  (free→$49-99/mo)     P2
                                (try BatchData+Apollo free tiers on top-100 first)
  [ ] DNC scrub (DNC.com/CCC) — legal pre-dial scrub (REQ'D)  (~$50-150/mo)        P2
  [ ] Dialer — deferred; Pipedrive-native / JustCall / Aircall when we call        P2 later
  [ ] OpenCorporates API      — registered-agents at scale    (sub)                P2 opt
  [ ] Phone validation (Twilio Lookup) — verify/line-type     (cheap)              P3 opt
  [ ] USPS vacancy (Melissa/BatchData) — direct vacancy flag  (per-record)         P2 opt
  [ ] Supabase project        — prod DB                      (free tier)          later
  [ ] Nearmap / EagleView     — oblique hi-res aerial        ($$$$)               P3 opt
  [ ] Regrid / ReportAll / ATTOM — multi-market parcel data  ($$)                 P3 opt
  [ ] Reonomy (CoStar alt)    — VERIFIED interior clear ht   ($mid)  only if      P3 opt
                                (free LiDAR roof est ships today)     exact spec needed

FOUNDER DATA TO PROVIDE  (drop in imports/)
  NASHVILLE
  [ ] trustee_delinquent.csv  — delinquent-tax list                               P1
  [ ] top-100 A/B/C grades    — score calibration                                 P1
  [ ] real submarket polygons — replace the single buy-box circle                 opt
  CHARLOTTE
  [ ] Mecklenburg delinquent-tax file — Charlotte tax-distress score              P1
  [ ] Charlotte top-100 A/B/C grades  — Charlotte score calibration               P1
  [ ] charlotte_submarkets.geojson (real polygons) — replace the ~20mi circle     opt

FREE & ALREADY WORKING (no action — reference)
  [x] Nashville ArcGIS: parcels, CAMA, violations, permits, 6in aerial imagery
  [x] Charlotte/Mecklenburg ArcGIS: CAMA parcels, permits, code enforcement (§4b)
  [x] USGS 3DEP LiDAR clear-height estimate (imagery/lidar_height.py) — see §9 (Nashville; NC re-point pending)
  [x] TNMap / USGS NAIP imagery, Mapillary (free token), TN SOS / Register of Deeds
  [x] Local Postgres+PostGIS, Python venv + deps
```

---

## 9. Clear / ceiling height — free now, paid only if we need the exact spec
The one industrial metric **not in any public assessor or parcel feed**. Verified against
the live CAMA schema: it carries `FinishedArea` / `YearBuilt` / `StructureType` but **no
height field** (and the parcel layer has none either). So it has to be either *measured*
from remote sensing or *bought* from a CRE vendor.

**What we do today (free, shipped):** `imagery/lidar_height.py` measures each parcel's
**roof/eave height** from the free **USGS 3DEP LiDAR** point cloud (Davidson County 2022
QL1, 8 pts/m²) and writes it to `properties.clear_height_est` with
`clear_height_source='lidar'`. It's surfaced in the dashboard (`Clr (ft)` column) and on
the call sheets. No key, no quota, on-thesis (off-market, never a listing site).
*Caveat:* LiDAR sees the **exterior roof**, so it's an estimate of clear height — interior
clear runs ~2–4 ft less (deck + joist depth). It's a triage signal; confirm true clear on
the call. Good enough to separate "16′+ keepers" from "12′ obsolete."

**If we ever want the authoritative interior spec at scale (paid — see §3):**

| Option | Why | Caveat | Cost |
|---|---|---|---|
| **Reonomy** *(recommended)* | off-market / ownership-first, real API — best fit for this play | clear-height coverage is **partial** | API sub, ~$ mid |
| **CoStar** | the most **complete** clear-height data of any vendor | it's LoopNet's parent — pulls us toward the listing world we exclude; enterprise price | $$$$ / yr |
| CompStak | clear height where it came off a lease comp | crowd-sourced, **spotty** | per-comp / sub |

**Recommendation:** stay on the free LiDAR estimate for sourcing/triage; only buy
**Reonomy** if a downstream step needs the verified interior number on many properties at
once. Don't buy CoStar just for this attribute.

---

## 9b. Reonomy competitors — property-data APIs (the API *alternative to scraping*)
Reonomy is fundamentally a **property/owner data API**: its role for us would be feeding the
pipeline parcel + owner + building data **programmatically, instead of scraping a county site**.
These are the API-first alternatives, ranked by fit for that parcel+owner+building need. Compiled
**2026-06-16 (night)** from the vendor landscape — confirm/augment with anything Jake named on the
call. **None needed today** — free ArcGIS covers all three current markets; this is the menu for a
future market with **no clean public GIS API**.

| API | What it delivers | Reonomy-peer? | Coverage / note | Cost tier |
|---|---|---|---|---|
| **Reonomy** *(baseline)* | CRE owner + building, **LLC→principal unmasking**, API | — | commercial-focused; best off-market thesis fit | mid $$ (custom) |
| **ATTOM Data** | nationwide property / deed / owner / AVM, clean REST API | **strong** | broadest API-first property data (residential+commercial) | $$ |
| **CoreLogic** | property / owner / valuation, enterprise API | **strong** (commercial) | deep incumbent; heavier contracts | $$$ |
| **Regrid** (ex-Loveland) | parcel boundary + owner, API + bulk | partial | **cheapest** parcel+owner fill-in; light on building detail | $ |
| **ReportAll** | parcel + owner API (Regrid-like) | partial | same role as Regrid — price-compare the two | $ |
| **BatchData** | property + owner + skip-trace, API | partial | **already evaluating them for contacts — one vendor could do both** | $ per-record |
| **HouseCanary** | property data + valuation API | partial | valuation-strong; residential lean | $$ |
| **Estated / RentCast** | developer-friendly property/owner API | budget peer | cheap, API-first; lighter commercial coverage | $ |
| **Datafiniti / PropMix** | property + business data feed API | niche | bulk / data-feed style | $$ |
| **Cherre** | aggregates many property feeds behind one API | integration, not a source | only if we centralize multiple feeds later | $$$ |

**Recommendation (scraping-replacement use):** if a future market lacks clean ArcGIS, reach for
**Regrid / ReportAll** (cheapest parcel+owner API) or **ATTOM** (richest API-first coverage) before
Reonomy/CoStar. **Look hard at BatchData** — if we're already paying them for skip-trace contacts,
one account may cover both the property-data API *and* the owner phones. (Clear-height-at-scale is a
separate question — see §9; Reonomy/CoStar there, not here.)

---

### Cross-references
- Imagery free-vs-paid deep dive + cost/coverage → [IMAGERY_TOOLS.md](IMAGERY_TOOLS.md)
- Public source URLs + fields → `lib/sources.py`, [DATA_NOTES.md](../DATA_NOTES.md)
- Charlotte source URLs + fields → `lib/sources_charlotte.py`, [DATA_NOTES_CHARLOTTE.md](../DATA_NOTES_CHARLOTTE.md); build notes → [BUILD_LOG.md](BUILD_LOG.md) §11
- Why each stage is stubbed/blocked → [BUILD_LOG.md](BUILD_LOG.md) §3–§6
- How to run + env setup → [../CLAUDE.md](../CLAUDE.md)
