# Architecture — covering an area & sourcing the imagery

Two ways to run the same loop (*define area → sample stops → view + classify → log*). The MVP
proves it with zero spend and no stored imagery; V2 scales it on the licensed API. The
**sampling layer is identical** in both — only the image source changes.

```
            ┌──────────────────────────────────────────────────────────────┐
   DEFINE → │ bbox / street / address                                       │
            └──────────────────────────────────────────────────────────────┘
                                  │
   SAMPLE → tools/sample_points.py: Overpass road network in the bbox →
            interpolate points every ~25–30 m along each road centerline →
            for each point compute the road bearing b and emit TWO facing
            views (heading b+90° and b−90°) to cover both sides of the street
                                  │
            ┌─────────────────────┴─────────────────────┐
   VIEW →   │ MVP: Claude-in-Chrome navigates the        │   V2: Street View Static API
            │ Street View URL & screenshots the viewport │   GET → clean 640×640 JPEG
            └─────────────────────┬─────────────────────┘   (after a FREE metadata check)
                                  │
   CLASSIFY → prompts/adaptive_reuse_assessment.md (the rubric) → strict JSON
                                  │
   LOG →    output/adaptive_reuse_candidates.csv  (label + coordinates only — no imagery)
```

## 1. Choosing where to look (the sampling layer — same for MVP & V2)

You don't need Street View to decide *where* to look. `tools/sample_points.py`:

1. Queries **Overpass** for the road network in the bounding box:
   ```
   [out:json][timeout:60];
   way["highway"](MIN_LAT,MIN_LNG,MAX_LAT,MAX_LNG);
   out geom;
   ```
   `out geom;` returns each road's full lat/lng polyline.
2. Walks each polyline and drops a point every `--spacing` metres (default 30 m), using haversine
   distance — pure Python, no GIS deps.
3. At each point, computes the **road bearing** from the local segment, then emits two stops:
   `heading = bearing + 90°` (right frontage) and `bearing − 90°` (left frontage). That's what
   turns "a point on a road" into "a view of the building face."

Output: a CSV of `{area, street_name, lat, lng, bearing, heading, side}` stops.
`--point LAT,LNG` (or `--address`) skips Overpass for a one-stop smoke test.

*Alternative source for "every address":* a county/municipal **GIS parcel layer** (ArcGIS
FeatureServer) gives authoritative addresses + parcel polygons — more precise than road
interpolation but per-county wrangling. `offmarket-scraping/lib/arcgis.py` already has a POST-paging
ArcGIS client to borrow when we want parcel-anchored sampling.

## 2. Street View URL form (use the documented one)

Build this — officially documented and stable:
```
https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG&heading=H&pitch=P&fov=F
```
- `heading` −180…360 (clockwise from North) · `pitch` −90…90 · `fov` 10…100 (default 90; lower = zoomed in).
- Google snaps `viewpoint` to the nearest panorama for you.

**Do NOT** construct the interactive-map form `…/@lat,lng,3a,75y,Hh,90t/data=!3m…!1e…`. The `data=`
segment is an opaque chain of `!`-delimited "bangs" encoding a specific pano id + session state;
it is not safely constructable and can change at any time. (`offmarket-scraping` learned the
related lesson that the centroid `viewpoint`/`pano` form fails on ~40% of interior parcels — its
fix was the geocoded `/maps/place/<address>` URL, which snaps to the road frontage and surfaces
the Google business label. For *address*-anchored stops, prefer that `/place/` form; for
*coordinate*-anchored stops, use the `?api=1&map_action=pano` form above.)

`tools/build_streetview_urls.py` emits these from a stops CSV (and, if `GOOGLE_MAPS_API_KEY` is
set, the matching Static API + metadata URLs for V2).

## 3. V2 — the licensed, scalable image source

When you want volume, stored imagery, and reproducibility, swap the image source (sampling stays
the same):

1. **Free availability + true location** — the **metadata endpoint** costs nothing and consumes no
   quota:
   ```
   https://maps.googleapis.com/maps/api/streetview/metadata?location=LAT,LNG&key=KEY
   ```
   Returns `status`, `pano_id`, the *snapped* `location{lat,lng}`, and capture `date`. Use it to
   (a) skip points with no pano (`status != OK`), (b) **dedup** stops that snap to the same
   `pano_id`, and (c) record the imagery date. Always metadata-filter before spending on images.
2. **Fetch the frontage image** for points that passed:
   ```
   https://maps.googleapis.com/maps/api/streetview?size=640x640&location=LAT,LNG&heading=H&pitch=0&fov=80&source=outdoor&key=KEY
   ```
   `size` ≤ 640×640 on the free path (larger needs URL signing); `fov` ≤ 120; `source=outdoor`
   restricts to outdoor panos.
3. **Classify** (Claude vision against the same rubric/prompt) and **persist** keyed by `pano_id`
   for idempotent re-runs.

**Cost (Essentials tier, current):** Street View Static = **$7 / 1,000** images (→ $5.60 at
100k–500k, less at scale), **10,000/month free**; **metadata unlimited/free**. A ~3,000-frontage
neighborhood ≈ **$21**, with metadata pre-filtering free. (The legacy "$200/mo credit" was
replaced in March 2025 by per-SKU monthly free allotments.) Anthropic vision adds single-digit
dollars for a few thousand images. Both keys are Andrew-held blockers
(`../offmarket-scraping/docs/TOOLS_REGISTRY.md`).

## 4. Terms of Service — the sharp line (read this)

**Google Maps Platform Terms prohibit** scraping / bulk-downloading / rehosting Maps content —
*expressly including bulk-downloading or caching Street View images* — and prohibit automated
("bots/spiders/scrapers") access to the consumer Maps service. Enforcement is a contract matter
(notice + a 24-hour cure window, then possible API/account suspension), not a criminal one.

**Practical rules for this project:**
1. **The Chrome-extension MVP must stay human-in-the-loop, low-volume, and image-ephemeral.** A
   person runs it, it classifies on the fly, and it persists **only the derived label +
   coordinates** — never an image archive. An unattended loop that screenshots the interactive
   Maps UI and *saves* the images is exactly the prohibited pattern. Treat the MVP as a
   prototyping/recon tool, not the production data pipeline.
2. **Anything you store, share, or build a dataset from → use the Street View Static API** and obey
   its storage terms. That licensed path exists so you don't have to scrape the UI.
3. **Mapillary** (CC BY-SA 4.0 — attribution + share-alike) is the cleanest source if you ever need
   to *redistribute* imagery; coverage is crowdsourced/uneven, so it's a fill-in, not a primary.
4. **OSM data is ODbL** (attribution + share-alike on derived databases) — fine for internal use;
   note obligations if you publish a derived dataset. County GIS terms vary per portal — check each.
5. This is general guidance, not legal advice. For a commercial product that stores/displays
   imagery, have counsel confirm the Static API storage terms for the specific display context.

## 5. What we reuse from `../offmarket-scraping`
- `imagery/record_observation.py` — recorder + `maps_urls()` + **merge-on-write** discipline
  (its upsert is a full-row replace; never partial-write).
- `prompts/vlm_site_assessment.md` — the `value`+`confidence`+`not_visible`, return-only-JSON,
  reject-schema-invalid prompt discipline that our prompt copies.
- `lib/arcgis.py` — POST-paging ArcGIS client for parcel-anchored sampling (V2).
- `docs/IMAGERY_TOOLS.md` — catalog of free, no-key aerial endpoints (NAIP, county ortho) for the
  ToS-safe automation path.
