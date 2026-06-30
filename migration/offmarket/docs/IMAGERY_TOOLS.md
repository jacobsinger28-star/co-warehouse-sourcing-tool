# IMAGERY_TOOLS.md — free imagery options + the paid tools we still need

> Purpose: "vacancy" in this pipeline is **not** a public-data field — it's the
> `vacancy_evidence` score (max 22 pts), inferred from imagery (`parking_fullness` +
> `signage_present`). Both the imagery fetch (`imagery/fetch_images.py`) and the VLM
> reader (`imagery/vlm_score.py`) are honest stubs blocked on empty `GOOGLE_MAPS_API_KEY`
> / `ANTHROPIC_API_KEY`. This doc is the answer to "what can we do for **free** today, and
> what should we **pay for** to do it right." Findings verified live **2026-06-16**.
>
> **TL;DR for Jake:** free **aerial** is excellent and already on the infra we use (no
> key, no cost) — it gets us most of the way on vacancy. The two things worth paying for,
> in order: **(1) Google Street View Static + Maps Static API** and **(2) an Anthropic API
> key** — they're a pair, ~single-digit dollars to run the whole 200-property list, and
> together they unlock the full 22-pt vacancy signal plus dock-door / condition reads.
> One non-imagery upgrade is arguably the best vacancy signal of all: a **USPS vacancy
> flag** (Melissa / BatchData). See §4.

---

## 1. What vacancy actually needs

The `_vacancy` rule (`scoring/rules.py`) fires on two fields:

| Tier | Condition | Points |
|---|---|---|
| `empty_lot_no_signage` | `parking_fullness='empty'` **AND** `signage_present='no'` | **22** |
| `sparse_or_no_signage` | `parking_fullness in (empty,sparse)` **OR** `signage_present='no'` | **14** |
| `ambiguous` | both fields `not_visible` (VLM ran, couldn't tell) | 5 |
| `clearly_active` | otherwise | 0 |

- **`parking_fullness`** is an *aerial* signal — readable from top-down ortho.
- **`signage_present`** is a *street-level* signal — you cannot reliably read building
  signage / "For Lease" banners from straight-down imagery.

So the **ceiling on a free, aerial-only path is the 14-pt tier** (empty/sparse parking).
Reaching the full **22** requires a street-level look (signage). Hold that thought — it's
the whole argument for the paid Street View ask in §4.

---

## 2. Free tools found (verified working, no API key)

### 2a. ⭐ Nashville Metro ArcGIS orthoimagery — the win
Same `maps.nashville.gov` ArcGIS server the parcel layer already comes from. **18 imagery
years, 1996 → 2023**, the latest two (**2022, 2023**) at **6-inch GSD color** (flown by
Pictometry). No key, no token, no quota seen.

```
https://maps.nashville.gov/arcgis/rest/services/Imagery/2023Imagery_WGS84/MapServer
                                                       2022Imagery_WGS84
                                                       2020Imagery_WGS84  ... back to 1996
```

**Verified export (no key):** an arbitrary parcel bbox renders to PNG via the standard
`export` op —
```
.../2023Imagery_WGS84/MapServer/export?bbox=<xmin,ymin,xmax,ymax>&bboxSR=4326
    &imageSR=3857&size=1024,1024&format=png&f=image
```
→ `HTTP 200, image/png, 1024×1024, ~950 KB`. Confirmed visually: streets, roofs, parking
lots, yards all crisp. To wire into `fetch_images.py`: take each parcel's
`ST_PointOnSurface(geom)`, build a ~150 m bbox around it, hit `export`, disk-cache by APN.

**What aerial gives us (real vacancy signal):** `parking_fullness` (empty/sparse/full),
long-term trailer storage, overgrown/derelict yards, roof condition & patching, building
count & rough divisibility (separate roof masses), truck-yard depth (`truck_access`).
**18-year archive** also enables change detection (lot that emptied out, structures
demolished) — a free bonus the paid tools charge for.

**What aerial can't give:** `signage_present`, wall/facade condition, dock-vs-drive-in
door type, street frontage. (→ that's the §4 Street View ask.)

### 2b. Tennessee statewide imagery (TNMap) — fallback / historical
`https://tnmap.tn.gov/arcgis/rest/services/BASEMAPS/IMAGERY_WEB_MERCATOR/MapServer`
(also `.../BASEMAPS/IMAGERY/MapServer`). TDOT ortho — 1 ft pre-2022, 6 in 2022+; the
`IMAGERY` service stacks NAIP + historical B/W back to the late 1990s. No key. Use as a
fallback if a Metro tile is missing, or for cross-checking. Slightly coarser than Metro's
own 6-in for recent years; main value is **statewide coverage** when we re-point the
pipeline outside Davidson County.

### 2c. USGS NAIP (national) — fallback / change detection
`https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage`
Public-domain national aerial, **verified no-key export** (`HTTP 200, image/png`).
~0.6–1 m resolution (coarser than Metro's 6 in), but it's the universal fallback that
exists **everywhere in the US** — important for the "re-pointable to other markets" goal.

### 2d. Mapillary — free street-level (crowdsourced)
The only **free** source that can see signage/facades. Global, **free API token**, imagery
under **CC-BY-SA**. Real caveats: (1) coverage is crowdsourced → **spotty on industrial
side streets** (many target parcels will have no recent pass, or none at all); (2) recency
varies wildly; (3) **commercial use requires visible attribution** (Mapillary logo + link
back). Worth wiring as a *best-effort* signage source — when a parcel has coverage it can
push that row from the 14-pt tier to the full 22 — but we can't rely on it for the list as
a whole.

### 2e. Esri "World Imagery" basemap — mention only
High-res and easy, but commercial use technically wants an ArcGIS account/credits and the
ToS is murkier than the public-government sources above. **Skip it** — the Metro 6-in is
better, cleaner, and unambiguously free.

---

## 3. What "free-only" actually buys us (be honest about it)

A free, **aerial + Claude-by-hand** run today gets us:
- `parking_fullness`, yard/trailer activity, condition (roof), divisibility, truck access
  on **every** parcel in the universe — real, defensible signals.
- Vacancy score **capped at the 14-pt tier** for most rows (no street-level signage), so
  the top of the list won't separate as cleanly as it will with Street View.
- It **does not scale automatically**: with no Anthropic key, "the VLM" is a human (or me)
  eyeballing tiles one at a time. Fine for a curated top ~25–30; not for 200/week.

That's genuinely useful for a first calibration pass — but it's a floor, not the product.

---

## 4. Better tools we're missing — for Jake, in priority order

| # | Tool | Unlocks | Rough cost | Verdict |
|---|---|---|---|---|
| **P1** | **Google Maps Platform** — Street View Static API + Maps Static API | `signage_present` → full **22-pt** vacancy; facade condition; dock vs drive-in doors; multi-heading frontage. Best industrial-corridor coverage (Google's car drives where Mapillary doesn't). | ~**$7 / 1,000** Street View loads (volume → ~$5.60); ~5,000 free/mo on the new Pro tier. **Whole 200-property × 2-heading run ≈ <$5.** | **Get this.** It's the designed path (`fetch_images.py`) and the single biggest quality jump. |
| **P1** | **Anthropic API key** (Claude vision = the VLM) | Turns images → structured `parking/signage/dock/condition/divisibility` **at scale**, with confidence + `not_visible`, per `prompts/vlm_site_assessment.md`. Without it nothing past hand-review scales. | Token-priced; use **Claude Sonnet/Haiku** for vision. ~200 props × ~3 imgs ≈ **single-digit dollars** for the full run. | **Get this.** Pairs with P1 — imagery with no reader (or a reader with no imagery) is half a tool. |
| **P2** | **USPS vacancy flag** (Melissa, BatchData, or Valassis/DSF) | A **direct, authoritative vacancy indicator** (USPS "mail undeliverable / vacant") — not inferred from pixels. Arguably the highest-signal vacancy source available, and it de-risks the imagery inference. | Per-record (cents) or small license; often bundled with skip-trace vendors. | **Strong add.** Best non-imagery vacancy signal; complements, doesn't replace, P1. |
| **P3** | **Nearmap / EagleView (Pictometry)** | Sub-3-inch **+ oblique (angled)** aerial + frequent recapture + deep history. Oblique shows building **sides** — signage, dock doors, wall condition — partially covering parcels Google hasn't driven. | Enterprise subscription, **$thousands/yr**. | Nice-to-have, **not MVP.** Revisit only if Street View coverage gaps hurt. |
| **P3** | **Regrid / ReportAll / ATTOM** | Nationwide parcel + owner + building attributes — for when we **re-point to other markets** (the stated goal); not vacancy-specific. | Tiered subscription. | Future-scaling, not this sprint. |
| — | **BatchSkipTracing** (already on the list) | Owner phone/email (outreach), not imagery. | Per-hit. | Already documented; noted here for completeness. |

**The ask in one line:** a **Google Maps Platform key** + an **Anthropic API key** (both
already named in `.env`, just empty) cost a few dollars total to run the whole list and
move vacancy from a half-signal to the full 22-pt designed signal. Everything else is
optional upside; the USPS vacancy flag (P2) is the one worth considering beyond those two.

---

## 5. Recommended path

1. **Now, free:** wire `fetch_images.py` to the Metro 6-in `export` endpoint (§2a),
   disk-cache by APN; aerial-assess the top ~25–30 by hand to get `parking_fullness` /
   condition onto those rows for the founder's first calibration. Honest 14-pt ceiling.
2. **The moment P1 keys land (recommended):** drop in Street View + the Claude VLM,
   run all 200, get the full 22-pt vacancy + dock/condition reads automatically. This is
   the real product and it's cheap.
3. **Consider P2** (USPS vacancy) as a direct cross-check on the imagery inference.

> Endpoints + the no-key export verification in this doc were live on **2026-06-16**;
> re-confirm with `tools/discover_sources.py` (extend it to ping the Imagery folder) before
> trusting them in a later sprint.
