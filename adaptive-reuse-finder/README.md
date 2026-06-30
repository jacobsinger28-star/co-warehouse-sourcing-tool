# Adaptive-Reuse Finder

Sweep an area of a city in **Google Maps Street View** — driven by the **Claude-in-Chrome
extension** — and flag buildings that have been **adaptively reused**: former garages,
auto shops, warehouses, gas stations, churches, firehouses, etc. now used as homes, cafés,
offices, or retail. Detection is by visual tells in the street-level image — the headline
one being **commercial roll-up / overhead "garage" doors on a building that now reads
residential** (the founder's example).

> **Status:** v0 scaffold (2026-06-25). The visual rubric, the Chrome-extension runbook,
> the sampling tools, and the vision prompt are built and the loop is proven on one live
> property. No bulk run yet, no API path wired. Live status of record →
> [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md).

This is the **detection** sibling of INITIATIVE-TRACKER #5. #5 as written is a *single-listing
convertibility checker* ("is this LoopNet box a good EasyBay candidate?"). This tool answers
the related-but-different question **"has this building already been converted?"** by sweeping
an area — useful as market intelligence (how much convertible/converted stock exists in a
submarket) and as a comp/precedent finder. The two share all the same imagery + vision plumbing.

## Why this matters for SimiCapital

Reuse *is* the firm's thesis: buy a distressed/vacant industrial box off-market, **convert** it
to EasyBay small-bay flex, exit on the conversion premium (the money-cycle deal math: ~$8M buy →
~$40–50M EasyBay exit vs. ~$13M traditional). A tool that reads completed conversions off the
street gives three things:

1. **Comps / precedent** — real, photographed examples of "this kind of box became that kind of
   use" in a target submarket.
2. **Convertible-supply intel** — how much of a submarket's stock is the kind that gets converted
   (feeds the Columbus supply model, Initiative #9).
3. **A proving ground for the vision loop** that Initiative #5 (the listing checker) will reuse.

## How it works

```
1. DEFINE an area            → a bounding box or a single street/address
2. SAMPLE Street View stops  → tools/sample_points.py  (Overpass road network →
                                evenly-spaced points, each facing the frontage left & right)
3. VIEW + CLASSIFY each stop  → Claude-in-Chrome navigates the Street View URL, screenshots,
                                and runs prompts/adaptive_reuse_assessment.md (the rubric)
4. LOG candidates            → output/adaptive_reuse_candidates.csv  (label + coordinates only —
                                no stored imagery; see ToS note)
```

**MVP (today, no API key):** the Claude-in-Chrome extension reads the live Street View viewport
— this is the same human-VLM pattern `offmarket-scraping` already uses for vacancy. Keep it
**attended, low-volume, and image-ephemeral** (store only the label + coordinates).

**V2 (scale, needs `GOOGLE_MAPS_API_KEY`):** swap the image source for the licensed **Street
View Static API** + the **free metadata endpoint** (true pano coords + capture date + dedup).
Same sampling layer. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repo map

```
adaptive-reuse-finder/
├── README.md                         ← you are here
├── CLAUDE.md                         ← "start here" for a cold agent
├── docs/
│   ├── METHODOLOGY.md                ← the visual rubric: taxonomy, Tier A/B/C tells, scoring
│   ├── ARCHITECTURE.md               ← MVP vs V2, sampling, Street View URLs, cost, ToS
│   ├── CHROME-EXTENSION-RUNBOOK.md   ← exact operator steps to run an area sweep
│   └── BUILD_LOG.md                  ← live status of record (what's built + decisions)
├── prompts/
│   └── adaptive_reuse_assessment.md  ← ready-to-paste vision prompt + strict JSON schema
├── tools/
│   ├── sample_points.py              ← bbox/address → Street View sample stops (stdlib only)
│   ├── build_streetview_urls.py      ← stops → Maps-URLs pano links (+ Static API if key set)
│   └── test_geo.py                   ← unit tests for the pure geo math
├── data/areas/                       ← area definitions (gitignored if they name real targets)
├── output/                           ← candidate CSVs (gitignored — property addresses = PII)
├── .env.example                      ← GOOGLE_MAPS_API_KEY / ANTHROPIC_API_KEY (V2 only)
└── SESSION_HANDOFF_2026-06-25_kickoff.md
```

## Quickstart (MVP — no API key)

```bash
# 1. Derive Street View stops for a small area (bbox = min_lat,min_lng,max_lat,max_lng)
python3 tools/sample_points.py --bbox 39.9580,-83.0120,39.9620,-83.0060 \
        --spacing 30 --area downtown_west_columbus --out data/areas/downtown_west_columbus.csv

#    …or just one address / point for a smoke test:
python3 tools/sample_points.py --point 39.9601,-83.0089 --area smoke --out data/areas/smoke.csv

# 2. Turn stops into Street View URLs to open in the browser
python3 tools/build_streetview_urls.py data/areas/downtown_west_columbus.csv

# 3. Open Claude-in-Chrome and follow docs/CHROME-EXTENSION-RUNBOOK.md:
#    navigate each URL → screenshot → classify with prompts/adaptive_reuse_assessment.md →
#    append flagged buildings to output/adaptive_reuse_candidates.csv
```

## Conventions & guardrails (read before running)

- **No single visual signal is a verdict.** Pair the tell (e.g. a roll-up door) with the
  *current-use mismatch* and a false-positive check (suburban garage ≠ commercial roll-up).
  See [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).
- **Image-ephemeral by default.** The MVP screenshots the interactive Google Maps UI — Google's
  ToS prohibit *storing/scraping* those images. Persist only the derived label + coordinates;
  use the Static API for anything you keep. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §ToS.
- **All property/owner output is Category-A PII.** `output/` is gitignored. Run the
  `../general-scraping/AUDIT-BEFORE-PUSH.md` ritual before any push.
- **Own git, root ignores it.** This subfolder has its own repo; the SimiCapital root repo is
  local-only and ignores subfolders via `/*`. Push only after an explicit go-ahead + audit.
