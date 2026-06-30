# Session handoff — 2026-06-25 — adaptive-reuse-finder kickoff

Quick pickup. Read [`CLAUDE.md`](CLAUDE.md) first, then [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md)
and [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) §1 (full detail). This doc = what happened + what's next.

## Prompt that started it
Founder: "let's start the project of the adaptive reuse with claude chrome extension, create a new
subfolder. it's supposed to go over an area of a city in google maps with the claude chrome
extension and figure out if a property has been adaptive reused. like finding garage doors on
google street view."

## What this session produced
1. The whole `adaptive-reuse-finder/` subfolder, scaffolded to match the `offmarket-scraping`
   conventions: README, CLAUDE.md, .gitignore, .env.example, `docs/` (methodology, architecture,
   chrome runbook, build log), `prompts/`, stdlib `tools/` + tests, example area CSV, output schema.
2. A research-grounded **visual rubric** for detecting completed adaptive reuse from one street
   image (use-mismatch gate + Tier A/B/C tells + scoring + false-positive traps).
3. **Stdlib tools, tested green (9/9):** `sample_points.py` (area → Street View stops, verified
   live against Overpass) and `build_streetview_urls.py` (stops → stable pano URLs).
4. A **live POC** that proved the end-to-end loop through the Claude-in-Chrome extension.

## The POC (what it showed)
Drove the extension to **47 Belle St, Columbus** (Peninsula / East Franklinton, Sep-2025 imagery).
The `?api=1&map_action=pano&viewpoint=` URL resolved to a real pano; Street View rendered; the
rubric was applied; the row landed in `output/adaptive_reuse_candidates.csv`.

**The instructive result:** the building *looks* industrial (brick, big multi-pane windows) but is
crisp/uniform new construction in a warehouse aesthetic — the classic false positive. The rubric
correctly scored it **0.20 / low / needs-review** instead of over-flagging. The discipline works.

## The one decision that's open (for the founder)
**Push / remote.** This subfolder has its own local git + a clean first commit (zero PII/secrets in
it). It has **no remote**. The SimiCapital root repo is deliberately local-only. So before any push:
do you want a **private GitHub repo (korteraz, over SSH)** for this, or keep it **local-only** like
the root? Not pushed pending that call.

## Resume here / next steps
1. **Reconcile scope with Andrew** — this *detection/area-sweep* tool vs. INITIATIVE-TRACKER #5's
   *on-listing convertibility checker*. Same plumbing; decide the primary use.
2. **Wire the `year_built` disambiguator** — pull county parcel `year_built` (offmarket
   `lib/arcgis.py`) to separate genuine conversions from industrial-aesthetic new-builds. This is
   the highest-value rubric upgrade (the POC proved why).
3. **Run a fuller attended sweep** of a target submarket (keep it low-volume, image-ephemeral).
4. **V2 when keys land** — Street View Static API + free metadata endpoint (Andrew holds the keys).
5. Sync with **Jake Diamond** on the manual qualification workflow (Initiative #8) before automating.

## Don't relearn these
- Use the documented pano URL form (confirmed live); never the `/data=!` blob.
- Image-ephemeral + attended + low-volume (Google ToS). Store only label + coordinates.
- All property/owner output = Category-A PII → `output/` gitignored; run AUDIT-BEFORE-PUSH before any push.
- No single visual signal is a verdict — pair the tell with use-mismatch + (next) year_built.
