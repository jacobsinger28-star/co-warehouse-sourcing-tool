# STREET_VIEW_POC.md — ground-level (Street View + place-label) pass on the top of the queue

> 2026-06-20. Founder: "you don't use street view — can't it help you figure out new stuff?" → "try to
> make a POC." This is that POC, run live through the Claude-in-Chrome extension on the **top 5 of the
> Columbus call queue**, landed into the pipeline via `imagery/record_observation.py`. It complements the
> overhead/aerial layer (`docs/SCREENSHOT_USES.md`) and the Maps Places API POC (`docs/MAPS_PLACES_POC.md`,
> BUILD_LOG §30). Net: Street View + the Google place label are a real, broad ground-truth layer — but the
> single biggest lesson is that **no one signal stands alone** (§ "Lesson" below).

## What a screenshot from the *street* adds that the *aerial* cannot
Aerial gives footprint, parking, truck courts, roof, yard, dumping. The street adds the things that only
exist at eye level: **"For Lease / For Sale" signs · posted legal notices · wall signage & branding ·
fleet vehicles · window/door condition (boarding, broken glass, graffiti) · grade-level drive-in doors ·
the pano capture-date + a historical time-slider.** Of these, the **leasing/for-sale sign** is the single
strongest off-market tell there is, and it is invisible from above.

## Method (reproducible, key-free)
1. Pull the top N of the ranked queue (`exports/ranked_columbus_*.csv`).
2. `MARKET=columbus python imagery/record_observation.py --urls <apn>` → satellite + street_view + **place** URLs.
3. Open in the Chrome extension; read Street View (orient toward the facade) **and** the Maps place card.
4. `record_observation.py <apn> --signage … --condition … --use-truth … --tenant … --note …` → DB.
   Idempotent per APN; writes `model_version='human-chrome-vlm'`.

## Results — top 5 Columbus parcels (all 5 landed in `columbus.site_observations`)

| # | APN | Parcel | Data score | Ground truth (street + place label) | Verdict |
|---|-----|--------|-----------|--------------------------------------|---------|
| 1 | 010-137505 | 512–584 Maier Pl | 45 (#1) | Modern multi-tenant flex park, **active "LEASING" sign in the lot**, many cars, good condition. Reconciles the §30/SCREENSHOT_USES "brewery/climbing-gym conversion" note: 512–584 is a **multi-building complex** | Managed park *with availability* → **lease lead, not a motivated single seller**; data-only #1 is misleading |
| 2 | 010-112326 | 773 E Markison Ave | 42 (#2) | Street View: **no wall signage**, dated brick warehouse, cracked walk, semi-trailer (storage). **BUT** Maps Places (§30) = an **active 5.0 pipe supplier**. | **Low-signage active business, NOT a confirmed vacancy** — the no-signage read repeated the aerial's false-vacancy; place label corrects it |
| 3 | 010-001345 | 521 Marion Rd | 40 (#3) | Manicured frontage, trimmed shrubs, intact glass entry = active operation. The aerial "scrap/debris" flag is **neighbor spillover** (Phoenix Recycling + pallet yards adjacent) | **Likely false-positive** on the aerial visual_distress flag → flagged for human review |
| 4 | 010-112377 | 1015 Marion Rd | 40 (#4) | **No Street View pano.** Place label = **active "Smurfit Westrock Columbus Recycling Plant"** (hours posted) | Active processing plant → off-thesis false-positive |
| 5 | 010-217134 | 1675 W Mound St | 38 (#5) | **No Street View pano.** Place label = **active "Vital Records Control" / "Fireproof Records Center"** (records storage, hours posted) | Occupied records-storage → off-thesis false-positive |

**Headline:** once the place label is folded in, **5 of the top 5 are active/occupied** — only #1 even has
*available space* (and it's a managed park, not a motivated owner). This strongly corroborates the existing
**"Columbus has very low true industrial vacancy"** finding (`DATA_NOTES_COLUMBUS`, the 10/10-occupied aerial
pass). **The data-only distress score systematically over-ranks active businesses in this dense urban-industrial
submarket** — code-violation + permit-anomaly signals say nothing about whether the box is *occupied*.

## Bug found & fixed (this session, tests green 89/89)
`maps_urls()` aimed Street View at the **parcel centroid** (point-on-surface). For interior-point industrial
parcels that returns *"No Street View imagery available here"* — empirically **2 of 5** of the top queue (#2, #4
had no centroid pano; #4/#5 none at all). Fix in `imagery/record_observation.py`:
- Switched `street_view` to the **`cbll` URL form** (verified to load a pano; the old `map_action=pano&viewpoint`
  form is unreliable for arbitrary points).
- Added a **`place` URL** = the situs-address-geocoded `/maps/place/` page. Its Street View thumbnail snaps to the
  **road frontage** (recovers the missing-pano case) **and** surfaces the **Google business label** — which is what
  decisively caught #4 and #5. **Prefer `place` for the manual pass.**

## The Lesson (the most important output)
**No single visual signal is a lead by itself.** "No wall signage" read as soft-vacancy on #2 — and was wrong;
it's an active supplier. That's the *same* false-vacancy the aerial pass made there, and the place label had
already corrected it (§30). The reliable unit is the **combination**: street condition + signage **AND** the
Google place label (occupancy/use-truth) **AND** the absent-data guardrail (§30: *absent Maps data is never a
negative* — a no-pin distressed box like 521 Marion should upgrade, not penalize). Calling a lead off one
modality reintroduces the exact false-positive every other layer was built to kill.

---

## New ideas surfaced by the POC (ranked by ROI)

### Build next
1. **Place-label occupancy as a *first-class scored* gate.** Today occupancy lives only in a free-text note
   (#4/#5 are clearly occupied but `signage_present` stayed `not_visible`, so a re-score won't drop them). An
   "operating-business present (place label)" signal → a real vacancy penalty would auto-demote the active
   businesses that dominate the top of the queue. This is the single highest-leverage change and it is exactly
   what `ingest/pull_places.py` (§30 scaffold) is built to feed — **blocked only on `GOOGLE_MAPS_API_KEY`.**
2. **"For Lease / For Sale" sign detection as a new *availability/motivation* signal.** Our thesis excludes
   *online-listed* (Crexi/LoopNet) properties, but a **physical** sign on an otherwise off-market box is a
   motivation tell the data layer has no way to see. Classify the sign: *lease vs sale*, *broker vs "by owner"*,
   and capture the phone. A **"For Sale by owner" sign on a tired single-owner box is gold**; a managed-park
   "Leasing" sign (#1) is a weak/with-caveat lead. New `distress_signals` type or a `visual_availability` field.
3. **Parcel-boundary-clipped imagery before the VLM reads it.** #3's aerial "scrap pile" was the *neighbor's*
   (Phoenix Recycling). Render the parcel polygon as an overlay, or crop the aerial to the parcel bbox, so the
   model attributes distress to the **subject**, not adjacent yards. Removes a whole class of aerial false-positives.

### Cheap wins / method upgrades
4. **Make `/maps/place/<address>` the one-stop manual-pass target.** It bundles frontage Street View + business
   label + hours + reviews + photos in one screenshot — more per call than separate satellite + pano. (Already
   emitted by the patched `maps_urls()`; just make it the documented default in the SOP.)
5. **Orient Street View heading toward the facade.** We have the centroid *and* the pano location → compute the
   bearing so the pano faces the building (signage/notices need the right heading). A `heading` param the moment we
   move to the Static Street View API.
6. **Phone-off-the-sign → skip-trace shortcut.** When a leasing/for-sale sign is readable, the number on it is a
   *direct line* that bypasses skip-trace entirely. Blocked today only by pano resolution (the #1 sign was legible
   as "LEASING" but the phone wasn't) — solved by the Static Street View API or a tighter pano zoom.

### Trajectory / refinement
7. **Historical-pano diff → a "recently vacated" detector.** Street View shows the capture date and keeps older
   panos. *Signage present 2019 → gone 2022* = recently emptied = the hottest lead class (a box *going* vacant beats
   one long-empty). Same idea on the aerial side needs Google Earth (more involved).
8. **Review-recency as an occupancy-trajectory signal.** Reviews dated last month = certainly occupied; reviews that
   stop 3 years ago = possibly closed/vacated. Free, and it sharpens the binary occupancy call into a *direction*.
9. **Use-truth → land-use-gate refinement.** The place label gives what the building *is today*: exclude active
   **processing/recycling** plants (#4 — off-thesis), flag **records-storage** (#5) as occupied-warehouse, and catch
   conversions (the Maier brewery/gym). A confidence flag / manual override on the gate, not a silent change.

### Strategic
10. **An occupancy gate *before* the distress ranking, market-wide.** The POC's structural finding — distress
    scoring over-ranks active businesses in dense submarkets — generalizes. An occupancy pre-filter (place label +
    imagery) applied before ranking would lift the genuine vacant/neglected boxes to the top everywhere, not just
    Columbus. This is the real prize behind getting the Maps key.

## Honest caveats
- **Pano vintage** — Columbus panos are ~Aug 2022; a recent change won't show. Cross-check permits / review recency.
- **Coverage** — ~40% of these industrial parcels had no centroid pano; the address-geocode recovery works but some
  truly have no usable street imagery (private drives, deep setbacks).
- **Resolution** — sign *presence* is readable; sign *text/phone* often isn't at consumer-pano zoom (needs the API).
- **Manual + slow** — ~1 parcel per pass. Worth it on the **top ~25–50**, not all 537; full automation needs the
  `GOOGLE_MAPS_API_KEY` (Places) and/or `ANTHROPIC_API_KEY` (the VLM as an API).

## State / what's blocked
Code + the 5 observations are landed and committed. The scored-occupancy gate (idea #1), sign detection (#2), and
boundary-clipping (#3) are **designed, not built**. All of the scalable versions are gated on `GOOGLE_MAPS_API_KEY`
(shared with `ingest/pull_places.py` and `imagery/fetch_images.py`). Open founder decisions: enable the Maps key;
which place-label signals become *scored* weights vs evidence-only; green-light an occupancy gate before ranking.
