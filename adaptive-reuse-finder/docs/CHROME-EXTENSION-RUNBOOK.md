# Chrome-extension runbook — how to actually run an area sweep

The MVP loop, step by step, driven by the **Claude-in-Chrome extension**. Keep it **attended,
low-volume, and image-ephemeral** (store only the label + coordinates — see ToS in
[`ARCHITECTURE.md`](ARCHITECTURE.md) §4). This is the same human-VLM pattern `offmarket-scraping`
uses for vacancy. Proven working on 2026-06-25 (see [`BUILD_LOG.md`](BUILD_LOG.md) §1).

## Before you start
- A Chrome browser connected to the Claude-in-Chrome extension.
- `python3` (stdlib only — no install needed).
- Decide the area: a small bounding box (a few blocks) is ideal for a first run. Big boxes →
  hundreds of stops → over the "low-volume, attended" line.

## 1. Derive the stops (offline)
```bash
python3 tools/sample_points.py \
  --bbox MIN_LAT,MIN_LNG,MAX_LAT,MAX_LNG \
  --spacing 30 --area AREA_NAME --out data/areas/AREA_NAME.csv
```
- `--spacing 30` ≈ one stop per ~30 m of road, each emitted for both sides → expect ~2× points.
- **Overpass flakiness:** the public server 504s when busy. If so, pass a mirror:
  `--overpass-url https://maps.mail.ru/osm/tools/overpass/api/interpreter`
  (also tried: `overpass.kumi.systems`, `overpass.private.coffee`). The tool prints a clear error and
  exits non-zero on failure — just retry with a mirror.
- One-off check: `--point LAT,LNG` or `--address "123 Main St, City, ST"` (no Overpass call).

## 2. Generate the URLs
```bash
python3 tools/build_streetview_urls.py data/areas/AREA_NAME.csv          # all stops
python3 tools/build_streetview_urls.py data/areas/AREA_NAME.csv --limit 20   # first 20
```
Each stop prints a `pano:` URL of the documented, stable form
`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG&heading=H&pitch=0&fov=80`.
Google snaps it to the nearest panorama and resolves the address for you.

## 3. The classify loop (per stop, in the Claude-in-Chrome extension)
For each stop — go slowly, ~one building per view:
1. **Navigate** the extension to the stop's `pano:` URL. The tab title resolves to the snapped
   address (e.g. `"47 Belle St - Google Maps"`); the panel shows the imagery **capture date**
   (note stale imagery — a known trap).
2. **Wait** ~2–3 s for the panorama to render, then **screenshot** the viewport.
   - If the facade is occluded (tree, truck, sign) or out of frame, nudge the **heading** ±20–40°
     (re-navigate with a tweaked `&heading=`) or zoom the screenshot region. Don't classify a
     sliver — set `needs_human_review` instead.
3. **Classify** the screenshot with [`../prompts/adaptive_reuse_assessment.md`](../prompts/adaptive_reuse_assessment.md).
   The model returns strict JSON (likelihood, signals, use-mismatch, review flag).
4. **Log** flagged/ambiguous candidates (typically `likelihood ≥ 0.45` *or* `needs_human_review`)
   to `output/adaptive_reuse_candidates.csv` — columns in [`../output/SCHEMA.md`](../output/SCHEMA.md).
   **Do not save the screenshot** — record only the JSON fields + coordinates + `pano_id`.
5. **Checkpoint every ~5 stops** with the operator (the offmarket cadence) — sanity-check the reads
   before continuing.

## 4. Disambiguate the common false positive (do this before trusting a "high")
The #1 trap (seen in the kickoff POC): **new-build construction in an industrial/warehouse
aesthetic** in redevelopment districts looks like a conversion but isn't. Before you trust a
Tier-A/B read, confirm the **age of the shell**:
- Look for *aged* materials, repair/infill seams, genuine ghost signs, irregular openings → real
  conversion. Crisp uniform brick, uniform modern windows, decorative-relief motifs → likely new build.
- **Cross-check `year_built`** from the county GIS (Franklin County parcel viewer for Columbus;
  `offmarket-scraping/lib/arcgis.py` can pull it). A Tier-A visual tell on a building built after
  ~2010 is almost certainly imitation, not reuse → drop to `very_low`.

## 5. Stop conditions
- You've covered the area's stops, **or**
- You hit the "attended/low-volume" limit for one sitting (take a break, resume later), **or**
- You want scale → switch to the V2 Static API path ([`ARCHITECTURE.md`](ARCHITECTURE.md) §3).

## Notes
- **No bulk/unattended screenshot loops.** That crosses Google's ToS line. A person runs this.
- **Everything you log is Category-A PII.** `output/` is gitignored; audit before any push.
