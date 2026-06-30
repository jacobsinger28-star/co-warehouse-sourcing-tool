# CLAUDE.md — start here

Orientation for an agent picking this project up cold. Read this, then
[`README.md`](README.md), then [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) (the rubric is the
heart of the tool) and [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) (live status of record).
Last updated 2026-06-25.

## What this is
A tool that **sweeps an area of a city in Google Maps Street View** (via the Claude-in-Chrome
extension) and flags buildings that have **already been adaptively reused** — former
garages/auto-shops/warehouses/gas-stations/churches/etc. now used as homes, cafés, offices,
retail. The signature tell: a **commercial roll-up/overhead door on a building that now reads
residential**. Output is a list of candidate addresses + the visual evidence, for SimiCapital
market intelligence and comps.

Distinct from INITIATIVE-TRACKER #5 (a single-listing *convertibility* checker). This is the
*detection* angle (area sweep, "already converted?"). Same imagery+vision plumbing; different
question. Don't conflate them in the output schema.

## The most important relationship: `../offmarket-scraping`
**Do not reinvent the imagery loop — it already exists next door.** `offmarket-scraping` runs a
production **human-VLM-via-Chrome** path: an agent reads Google Maps/Street View through the
extension and types structured fields into a recorder. Reuse its patterns:
- `../offmarket-scraping/imagery/record_observation.py` — the recorder + `maps_urls()` URL
  builder + enum-validated, **merge-on-write** upsert. **Carry its hard lesson: the upsert is a
  full-row replace — any incremental writer must read-reconstruct-overlay, not partial-write.**
- `../offmarket-scraping/prompts/vlm_site_assessment.md` — the prompt discipline this project's
  prompt copies: every field is `value` + `confidence ∈ {high,medium,low}`, `not_visible` is
  always allowed ("a guess labeled as fact is worse than no answer"), return ONLY JSON, reject
  schema-invalid responses rather than partially storing them.
- Its lessons (no `LESSONS.md` there; distilled in our [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md)):
  *no single signal is a lead*; *absent Maps data is never a negative*; *centroid Street View
  fails on ~40% of interior parcels → use the `/place/` or `cbll` form*; *top-down aerial cannot
  see grade-level/garage doors at all → needs a Street View facade pass* (that last one is
  exactly why this project is Street-View-first).

## Stack
- **MVP (now):** Python 3 stdlib only (no venv needed) for `tools/` + the Claude-in-Chrome
  extension for imagery/classification. **No API key required.**
- **V2 (scale):** Google **Street View Static API** + free **metadata endpoint** (needs
  `GOOGLE_MAPS_API_KEY`); optionally the Claude vision API for automated classification
  (`ANTHROPIC_API_KEY`). Both keys are blockers held by Andrew (see offmarket `TOOLS_REGISTRY`).

## How to run it (MVP)
```bash
python3 tools/sample_points.py --bbox MIN_LAT,MIN_LNG,MAX_LAT,MAX_LNG --spacing 30 \
        --area NAME --out data/areas/NAME.csv      # Overpass road net → facing sample stops
python3 tools/build_streetview_urls.py data/areas/NAME.csv   # → pano URLs to open
python3 -m unittest tools/test_geo.py -v                     # verify the geo math
```
Then drive the extension per [`docs/CHROME-EXTENSION-RUNBOOK.md`](docs/CHROME-EXTENSION-RUNBOOK.md).
`sample_points.py --point LAT,LNG` (or `--address "..."`) does a single-stop smoke test offline.

## Conventions / gotchas (don't relearn these the hard way)
- **ToS line is sharp.** The MVP screenshots the *interactive* Google Maps UI; Google's Maps
  Platform Terms forbid scraping/**storing** those images. So the MVP stays **attended,
  low-volume, and image-ephemeral** — persist only `{label, coordinates}`, never an image
  archive. Anything you store or scale → the licensed **Static API**. Full text:
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §4.
- **Use-mismatch is the gate.** Reuse ⇔ current use ≠ what the envelope was built for. If the
  original use is still operating (pumps at a gas station, cars on lifts at a shop, a cross on a
  church), cap likelihood ≤0.15 — that's original use, not reuse. See `docs/METHODOLOGY.md`.
- **Street View URL form:** use `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG&heading=H&pitch=P&fov=F`
  (documented, stable). Do **not** build the `/@lat,lng,3a,..y,..h,..t/data=!..` form — its
  `data=` blob is opaque/pano-specific and not safely constructable.
- **All property/owner output = Category-A PII.** `output/` and `data/areas/*` (if they name real
  targets) are gitignored. Treat addresses as sensitive. Run `../general-scraping/AUDIT-BEFORE-PUSH.md`
  before any push.
- **Git:** this subfolder has its **own** repo. The SimiCapital **root repo is local-only**
  (no remote) and ignores subfolders via `/*`. Commit freely; **push only after an explicit
  go-ahead + a sensitivity audit**, and over SSH as `korteraz` (not HTTPS) per the push-auth memory.
- **Tools are stdlib-only** (no third-party deps) so the MVP runs anywhere with `python3`. Keep it
  that way unless V2 forces a dependency, and document any new dep in `.env.example`/README.
