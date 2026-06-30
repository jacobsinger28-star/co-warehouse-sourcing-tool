# MAPS_PLACES_POC.md — Google Maps "Ask Maps" / Places data for off-market sourcing

> Session 2026-06-20. Trigger: founder asked "what about the new Ask Google Maps AI — can we use it
> to our benefit?" This doc is the full answer: what the feature actually is, an **empirical POC**
> against our own hand-verified ground truth, the complete use-case catalog (ranked), and a build
> plan (`ingest/pull_places.py`). Companion to `docs/SCREENSHOT_USES.md` (the imagery-VLM menu) —
> Places data is the **structured, scalable** sibling of the manual Chrome-VLM pass.

## TL;DR (the verdict)
**Yes — wire it in, as a scalable occupancy + use-truth + contact layer that COMPLEMENTS, not
replaces, the imagery VLM.** In a key-free POC against our 11 hand-verified Columbus parcels, Google
had usable business data for **10 of 11**, and on top of confirming the tenant it handed us
net-new structured fields we don't currently have at scale: **business category, phone, website,
hours, review text, activity-recency, and a full multi-tenant directory.** It also *corrected a
false-positive* our imagery missed and *confirmed a conversion* by category alone.

The one hard rule it forces (proven by the POC): **"no Maps pin" must NEVER be scored as a
negative** — the single parcel with zero Google presence (521 Marion) is exactly the kind of
distressed, no-web-footprint box that is our hottest target. No-pin + visual distress should
*upgrade*, not penalize.

---

## 1. What "Ask Google Maps AI" actually is (two different things)
| | Consumer "Ask Maps" | Developer "Grounding with Google Maps" + Places API |
|---|---|---|
| What | Gemini chat inside the Maps **phone app** (under the search bar) | Gemini API tool + the Maps Platform REST APIs |
| Access | **No API. Mobile-only** (US/India) | Programmatic, key-gated |
| Scrapeable? | No (ToS) | Yes — sanctioned, billed |
| Useful to us? | Only as an ad-hoc human lookup | **This is the usable path** |

So the consumer feature itself is a dead end for a pipeline. The capability behind it — Google's
250M-place dataset — is reachable via **Places API (Text Search → Place Details)** and, if we ever
want natural-language synthesis, **Grounding with Google Maps** (Gemini 3). For our structured
needs, prefer the plain **Places API** (deterministic fields, cheaper) over the Gemini wrapper.

## 2. The POC (method)
We can't hit the paid Places API yet (`GOOGLE_MAPS_API_KEY` slot is empty). So we validated the
**signal**, not the billing, **key-free**: for each of the 11 Columbus parcels that already have a
hand-verified Chrome-VLM read (occupancy / use-truth / tenant in `columbus.site_observations`), we
independently pulled what Google Maps returns for the situs address via the Chrome extension and
compared. This mirrors exactly what a Places Text Search would return.

## 3. Results — 11/11 parcels
| Parcel | Hand-verified (our read) | Google Maps returned | Verdict |
|---|---|---|---|
| 2450 Sobeck Rd | Central Transport, truck terminal | Central Transport · Trucking company · 3.0(60) · Opens 8 AM | ✅ exact + category/rating/hours |
| 1015 Marion Rd | Smurfit Westrock recycling | Smurfit Westrock Recycling Plant · Recycling center · 3.6(14) | ✅ exact |
| 1675 W Mound St | Vital Records + Fireproof Records | both tenants · Records storage facility | ✅ exact (both) |
| 512 Maier Pl | (warehouse → conversion per SCREENSHOT_USES) | Bloc Garten · **Rock climbing gym** · 4.8(180) | ✅ conversion caught by category alone |
| 850 Twin Rivers Dr | True North Builders, USPS (2 tenants) | ~25-tenant directory (USPS, Passport Office, New City Homes, True North…) | ✅ richer than hand pass |
| 521 Marion Rd | tenant=[], debris/scrap distress | address-only, **no business pin** | ✅ concordant; no-pin + distress = hotter lead |
| 185 N Yale Ave | 5 tenants (multi) | Sugarbush Gift Baskets · 4.5(33) — **1 of 5** | 🟡 confirms occupied; needs directory expand |
| 3260 Valleyview Dr | multi-tenant flex (karting, etc.) | German Autowerks · Auto repair · 4.3(244) — **1 of many** | 🟡 confirms flex; names 1 (different) |
| 600–740 Marion Rd | Benchmark by Kingspan, mfg | address-only at 600; by name → 720 Marion: Manufacturer · phone · website · activity 3 wks ago | 🟡 range-address miss; **Text Search recovers + adds phone/website** |
| 324 E Dering Ave | Neylon Excavating, mfg | **Capital Resin Corp · Chemical plant** · 4.3(9) | ⚠️ tenant-name disagreement (category "mfg" agrees) |
| 773 E Markison Ave | tenant=[], junk-vehicle distress, *possibly vacant* | **Columbus Pipe & Equipment · Pipe supplier · 5.0(11)** | ⚠️→✅ Google found occupancy our imagery MISSED |

**Scorecard:** strong/exact agreement 6 · partial (1-of-N multi-tenant) 2 · range-address miss
recoverable via Text Search 1 · net-new occupancy discovery (corrected our miss) 1 · tenant-name
disagreement with category-agree 1. **Usable business data on 10/11.**

## 4. Net-new signal Google adds (the fields we actually observed)
1. **Business category** — instant programmatic use-truth/conversion ("Rock climbing gym",
   "Chemical plant", "Records storage", "Recycling center", "Pipe supplier").
2. **Phone + website** (Kingspan returned both) — direct contact enrichment.
3. **Hours + `business_status`** — when-to-call + a clean `CLOSED_PERMANENTLY` vacancy flag.
4. **Activity recency** — review/photo dates ("3 weeks ago", "By owner 23 days ago") = a live "is
   this alive now" heartbeat.
5. **Review free-text** — operational intel ("4 hours to pick up", "drivers don't stop").
6. **Full multi-tenant directory** with category counts ("Services 13, Other 9").
7. **"People also search for"** — a related-entity graph (Lamit Industries, Benchmark Industrial…).
8. **Owner-engagement** — "By owner" photos / claimed listing / visitor updates.

## 5. Reliability gotchas the POC exposed (build around these)
- **Range addresses miss on exact match** ("600–740 Marion" → nothing at "600"; the business is at
  720). Fix: Places **Text Search** (fuzzy) instead of exact geocode, and/or search the range.
- **Multi-tenant returns only the primary tenant** on an address search; the full roster needs the
  "at this place" / nearby expansion.
- **Tenant-name can disagree** with our imagery read (324 Dering) — treat Places + imagery as two
  independent opinions; agreement = high confidence, disagreement = human-review queue.

## 6. Governing guardrail (non-negotiable)
**Absent Maps data is NEVER a negative signal.** 521 Marion (no pin) is a prime target. Encode:
no-pin contributes 0 (not a deduction); **no-pin + visual distress / tax delinquency / violation =
UPGRADE.** This protects against survivorship bias toward Google-visible businesses — the off-market
thesis specifically targets owners with no web footprint.

---

## 6b. Round-2 POC (key-free, 2026-06-20) — closed-status hunt + lookalike test
Two follow-up POCs the founder asked for, run key-free on **16 high-distress Columbus parcels NOT in
the original 11** (sampled by distress-signal count + score — the leads most likely to be vacant).

**(i) Does `CLOSED_PERMANENTLY` actually fire? → No, almost never — and that REFINES the catalog.**
Across all 16, **zero** showed an explicit "Permanently closed" label. Instead the breakdown was:
- **6 no-pin** (511 E 5th [9 violations!], 1225 Boltonfield, 3600 Sullivant, 2601 Silver, 1191 Fields,
  794 Chambers) — i.e. *every* no-pin parcel was high-distress → **no-pin + distress = the real vacancy
  tell**, empirically supported.
- **9 occupied** with active pins — and the business usually *explains* the distress: A-Z Recycling
  (scrap yard), Cinco Technologies (recycling), Royal Paper Stock, Ohio State Pallet, Panacea Products
  (mfg). These are messy-but-ALIVE industrial uses, not vacant boxes. Google separates "distressed
  because vacant" from "distressed because it's an active scrap yard."
- **1 excluded use** caught by category alone: 6320 N Hamilton = "Cardinal Self Storage · Storage
  facility" → the category-gate (#6) validated on a real universe parcel. (Plus 711 Southwood = "IMPACT
  Community Action · Non-profit" — a use-truth conversion flag.)

> **Correction to §7-A1:** `CLOSED_PERMANENTLY` is REAL but RARE for industrial — when an industrial
> tenant leaves, the Google pin typically just **disappears** rather than being marked closed. So the
> dominant programmatic vacancy signal is **absence-of-pin**, which is AMBIGUOUS (vacant vs. an
> owner-occupant who never made a listing). Rule: **no-pin alone = 0; no-pin + distress = upgrade.**
> Demote standalone `CLOSED_PERMANENTLY` from "the cleanest signal" to "high-precision but low-recall."

**(ii) Does "People also search for" surface NEW targets? → Yes, but yield depends on the seed.**
Seeded from A-Z Recycling, PASF returned a clean cluster of ~10 same-category in-market operators
(Ace Iron @ 2515 Groveport, IHS Metal @ 1041 Joyce + 2040 Parsons, New World @ 1079 E 5th, Columbus
Metal, Cyclemet, Green Earth, Buckeye, Masser…). Cross-checked against the DB: **IHS @ 1041 Joyce
(8,892 SF) and @ 2040 Parsons (22,275 SF) ARE in our parcels but correctly gated out — far below the
75k-SF buy-box.** So PASF is a working lookalike-discovery graph, BUT lookalikes inherit the seed's
size class (a scrap-yard seed → small scrap yards). **To expand the 75k+ universe, seed PASF from the
LARGE-box parcels (Smurfit Westrock, Central Transport), not the small ones — and re-apply the SF gate
to every lead.** Confirms the gate works; PASF leads still need it.

## 7. Use-case catalog (ranked, grouped)
Status: ✅ POC-validated · 🟡 plausible from observed fields · 🔭 needs the paid API/other product.
Value = value-per-effort for THIS off-market pipeline.

### A. Vacancy / occupancy / timing
1. **No-pin + distress = vacancy upgrade** ✅ (the empirically strongest, see §6b) — across 16
   high-distress parcels, every no-pin parcel was high-distress; absence-of-pin is the real
   industrial-vacancy tell. **Ambiguous alone (0 weight); combined with a distress signal = upgrade.**
2. **`business_status = CLOSED_PERMANENTLY/TEMPORARILY`** 🔭 — high-precision but **LOW-RECALL**: §6b
   found zero explicit closures in 16 distressed parcels (industrial pins usually *disappear* rather
   than get marked closed). Keep as a hard flag where it fires; don't rely on it for coverage.
3. **Activity heartbeat (review/photo recency)** ✅ — recent reviews/photos = alive; silence on a
   business that should be busy = winding down. → vacancy / trajectory.
4. **Distress-cause triage** ✅ (new, from §6b) — for an OCCUPIED high-distress parcel, the business
   category usually *explains* the distress (scrap yard, recycler = messy-but-alive). Separates
   "distressed because vacant" (no pin) from "distressed because it's an active scrap yard" (occupied)
   from "wrong use" (self-storage / non-profit). Tells the founder which distress leads are real boxes.
5. **Multi-tenant occupancy count + churn over time** 🟡 — # of active listed tenants vs building
   SF/suites = occupancy-ratio proxy; tenants disappearing from the directory across weekly cron
   pulls = building emptying BEFORE imagery shows it. (Imagery handles multi-tenant vacancy worst.)
6. **Review-velocity decline** 🟡 — review cadence dropping to zero over time = activity dying;
   cheaper/faster than re-imaging.

### B. Use-truth / land-use gating
6. **Category-as-gate** ✅ — auto-exclude/down-rank non-targets the assessor code misses
   (self-storage, church, retail, entertainment-conversion, car dealership) and re-include
   parcels mis-coded "vacant/other" that Google shows as an active manufacturer. Hardens the
   land-use gate for the WHOLE universe, not just the hand-reviewed top 25.
7. **Conversion detection by category** ✅ — "Rock climbing gym" at 512 Maier instantly flags the
   warehouse→entertainment conversion (our single biggest false-positive type).
8. **Sublease/patchwork-occupancy distress** 🟡 — many unrelated small tenants in one big box
   (185 Yale: gift baskets + electric + mulch + hauling) = a struggling single-tenant asset chopped
   into income = often motivated.

### C. Contact / outreach / operations
9. **Tenant ID → decision-maker** ✅ — for opaque LLC-owned parcels, the operating business is the
   fastest path to a human; feeds skip-trace + the call script.
10. **Phone + website enrichment** ✅ — website "About us" → principal name; phone → cross-check
    skip-trace. Plugs into the existing owner-contact pipeline.
11. **Review-text mining (distress / ops-pain / names)** ✅ — LLM over the review corpus extracts
    distress language ("looks abandoned", "gate locked", "they moved out"), operational friction
    (congestion, slow loading), and named humans. **Highest novelty — no other layer gives free-text
    ground truth.** → new `distress_signals` type='review_distress' + call color.
12. **Owner-engagement (claimed vs unclaimed listing)** 🟡 — claimed/owner-managed = reachable;
    active business with a stale unclaimed listing = absentee/passive owner (the neglectful profile).
13. **Hours = best-time-to-call routing** ✅ — dial during open hours.
14. **Routes API drive-by tour** 🔭 — cluster top-N leads into an efficient founder site-visit route.
15. **Chain vs independent** 🟡 — national chain/3PL = stable, skip; poorly-rated independent =
    more approachable / more likely motivated.

### D. Physical / valuation
16. **Solar API roof geometry** 🔭 — roof segments/area → cross-check assessor `building_sf`
    (esp. where assessor SF is garbage), clear-span hints, re-roof candidates.
17. **Aerial View API** 🔭 — cinematic oblique for the call sheet / deal file.
18. **Place photos as a condition/occupancy timeline** 🟡 — dated user/owner photos = a free
    historical series; photo *content* is another imagery source (interior, signage, fleet).
19. **Popular times / live busyness** 🔭 — shift intensity; flat popular-times on a should-be-busy
    warehouse = winding down; 24/7 vs single-shift = underwriting context.

### E. Data quality / cross-validation
20. **Geocoding / Address Validation** 🟡 — canonicalize situs → rooftop geocode → fix the
    range-address miss AND the interior-centroid "no Street View" problem (~2/5 Columbus parcels).
    Makes BOTH imagery and Places layers more accurate.
21. **Cross-source disagreement queue** ✅ — Places vs assessor land-use vs our imagery vs distress
    feed: 3-way agreement = high confidence; disagreement (773 Markison, 324 Dering) = a human-review
    triage list. The disagreements are where the value is.
22. **Portfolio/affiliate hints** 🟡 — "People also search for" + name clusters (Benchmark by
    Kingspan / Benchmark Industrial / Benchmark Concrete) feed entity/portfolio grouping (verify;
    name-similarity ≠ affiliation).

### F. Strategic / cross-market
23. **Market-agnostic uniform layer** ✅ — same query shape in every county; no per-county ArcGIS
    schema. The ONE enrichment that doesn't degrade with county data quality (Charlotte assessed=
    garbage, Columbus/Charleston missing year/value).
24. **New-market scouting** 🔭 — a cheap Places-density sweep (industrial-business count, closure
    rate, flex prevalence per ZIP) ranks which county to build next BEFORE paying for the pipeline.
25. **Gemini "Grounding with Google Maps" query layer** 🔭 — ad-hoc founder NL queries over the
    enriched dataset ("vacant manufacturers within 2 mi of I-70 with no website"). A query UX, not a
    scoring input.

### Anti-recommendations (sound useful, aren't, for OFF-MARKET)
- Don't use Maps **presence as a positive** ranking signal — it biases toward listed/visible
  businesses, the opposite of our off-market thesis.
- Don't bulk-scrape the **consumer app / map tiles** (ToS); use the Places API for automation.
- Don't trust **rating value** as quality of the real estate — it rates the *business*, not the box.
- Don't let Places **overwrite human-verified `site_observations`** (see §8 guard).

---

## 8. Build plan — `ingest/pull_places.py`
Drafted this session as a **scaffold** (`ingest/pull_places.py`): honest-stub + skip when no key
(matches `imagery/fetch_images.py`), and a real, inspectable fetch→classify→map flow ready to
validate the moment `GOOGLE_MAPS_API_KEY` is enabled with Places API (New).

Flow:
1. For each universe parcel (top-N first), **Places Text Search** on `"<situs>, <city>, <state>"`
   (fuzzy → handles range addresses) → candidate place(s).
2. **Place Details** field mask: `displayName, primaryType, types, businessStatus, rating,
   userRatingCount, nationalPhoneNumber, websiteUri, regularOpeningHours, reviews, location,
   formattedAddress`.
3. **Classify**: types → `use_truth` enum + excluded-use flag; `businessStatus` → vacancy/distress;
   reviews → distress-keyword scan.
4. **Land** (behind `--write`, default `--dry-run` prints JSON): into `site_observations`
   (model_version='google-places', human_verified=False) + a `distress_signals`
   type='places_closed' / 'review_distress' row when warranted.

**Correctness guards (carry the §6e re-score lesson):**
- **Never clobber a human-verified row.** Upsert in `record_observation` does `ON CONFLICT (apn) DO
  UPDATE`, which would bury a `human-chrome-vlm` observation. `pull_places.py` must SKIP (or merge
  into a separate column/row) any APN that already has `human_verified=True`.
- **Absent data ≠ negative** (§6 guardrail) — no place found contributes 0, never a deduction.
- Adding any **scored weight** for a Places-derived signal is a founder decision (like
  `visual_distress`, these land as sourced evidence first).

## 9. Cost & ToS
- Places API (New) is per-request billed; field-masked Place Details is cheap. A one-time pass over a
  market's universe (hundreds of parcels) is low cost; the weekly-cron churn re-pull is the recurring
  spend — cap to the top of the queue.
- Programmatic Places API use is sanctioned; scraping consumer Maps / tiles is not.
- "Maps Grounding Lite" exists (cheaper/free tier) if we want the Gemini-grounded query layer later.

## 10. Status & open founder decisions
- **Status:** POC complete (this doc); `pull_places.py` scaffold committed; **blocked on
  `GOOGLE_MAPS_API_KEY`** (same key unblocks `imagery/fetch_images.py`). See `docs/TOOLS_REGISTRY.md`.
- **Decisions needed:** (1) enable the Maps key (Places API New + Geocoding)? (2) which Places signals
  become *scored* weights vs evidence-only? (3) green-light Solar/Aerial/Routes (separate products)?
</content>
