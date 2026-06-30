# Session handoff — 2026-06-25 — buy-box derivation + deal sourcing

Continues the kickoff ([`SESSION_HANDOFF_2026-06-25_kickoff.md`](SESSION_HANDOFF_2026-06-25_kickoff.md)).
Read `CLAUDE.md` first. Live status of record: [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md).

## What this call produced

1. **Stood up `adaptive-reuse-finder/`** (kickoff): visual rubric (`docs/METHODOLOGY.md`), vision
   prompt, stdlib sampling tools + tests (9/9 green), and a live Chrome-extension POC. (BUILD_LOG §1.)

2. **Assessed the Orlando property the founder sent** — 1900 W New Hampshire St (LoopNet 38057063).
   Verdict: **not adaptively reused** (original-use 1962 factory, still a building-materials
   warehouse) but a strong small-bay/flex *specimen*; off-thesis as an acquisition (for-lease,
   on-market, low-basis owner). (BUILD_LOG §2; full read in gitignored `output/assessments/`.)

3. **Derived + multi-source-verified the target buy-box** from the founder's **six** example
   properties (Orlando 1900 W New Hampshire; Nashville 801 Space Park S; Charlotte 5710 Old Concord;
   Greensboro 1103 S Elm; Rock Hill 150 Mt Gallant; Tucson 5580 S Nogales). (BUILD_LOG §3.)
   **Buy-box:** ~85,000–165,000 SF, 1950s–70s single-story industrial/manufacturing, heavy/general
   industrial zoning permitting outdoor storage (I-G/IWD/ML-2/HI), **fenced outdoor yard / IOS**,
   ~40–50% lot coverage, infill, Sunbelt (FL/TN/NC/SC + Tucson). **Nuance:** low-coverage value-add
   "industrial-with-yard," NOT *pure* IOS. **Outlier:** Greensboro (70% coverage, no yard).

4. **Found new deals matching the buy-box** and pulled real LoopNet URLs via the Chrome extension:
   - **10 Orlando + 10 Nashville (batch 2)** — `output/assessments/orlando-nashville-buybox-batch2.md`.
     **Excludes all 6 founder/broker-sent examples** (demo framing: "deals the tool found, not sent").
     In-band standouts: Nashville **515 Foster St (1923, 133,730 SF)**, 1530 Antioch Pike (131k),
     550 Expressway Park (96k); Orlando 2700-2716 Hazelhurst (105k/1972), 10407 Rocket Blvd (104.6k/81).
   - Earlier exploratory lists also saved (`orlando-comps-like-1900-new-hampshire.md`,
     `nashville-adaptive-reuse-candidates.md`).

## Key strategic finding
On-market large (85k+) industrial *with IOS* is thin and gets buried by LoopNet's default sort — but
it exists (found in-band matches on deeper pages). The true sweet spot is still **off-market**: the
highest-yield channel is a **parcel screen** — zoning permits outdoor storage AND building-to-land
coverage ≤~50% AND building 80–165k SF AND lot 5–20+ AC AND infill — then confirm the fenced yard via
aerial/Street View. Nashville has the off-market engine (`../offmarket-scraping`, Davidson County);
Orlando would need its parcel data wired.

## Deliverables (all gitignored — Category-A: CoStar/owner/addresses)
`output/assessments/`: `target-buybox.md` (the 6-example buy-box), `orlando-nashville-buybox-batch2.md`
(the 20 found deals), `1900-w-new-hampshire-orlando.md`, `orlando-comps-like-1900-new-hampshire.md`,
`nashville-adaptive-reuse-candidates.md`, `adaptive_reuse_candidates.csv`.

## Open items / next steps
1. **Confirm IOS = hard requirement vs. nice-to-have** (decides whether the Greensboro-type tight
   sites stay in).
2. **Satellite/Street-View pass** on the in-band standouts to confirm which actually have a fenced
   yard (true IOS), then rank by reuse/EasyBay fit.
3. **Extend the found-deals search** to the other example markets (Charlotte, Greensboro, Rock Hill,
   Tucson) for a six-market demo.
4. **Off-market parcel screen** — run it against the Nashville engine; scope Orlando parcel data.
5. Reconcile detection-vs-convertibility scope with Andrew (Initiative #5); wire the `year_built`
   disambiguator (kickoff finding).

## Data / git
- All property/owner/CoStar output is gitignored (PII policy). Tracked = scaffold + docs + tools only.
- Committed locally to the subfolder's own git. **No remote configured** (root repo + this subfolder
  are both local-only) — nothing pushed. To push, decide on a private GitHub repo (korteraz, SSH).
