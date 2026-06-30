# BUILD_LOG — adaptive-reuse-finder

Live status of record (most-recent section first). What's built, every decision, and the open risks.

---

## §4 — 2026-06-25 — Deal sourcing against the buy-box (Orlando + Nashville)

Used the buy-box (§3) to source matching deals and pulled real LoopNet URLs via the Chrome
extension. Delivered **10 Orlando + 10 Nashville found deals** that **exclude all 6 founder-sent
example properties** (demo framing: "deals the tool found, not sent") — `output/assessments/
orlando-nashville-buybox-batch2.md` (gitignored). In-band standouts: Nashville 515 Foster St
(1923, 133,730 SF), 1530 Antioch Pike (131k), 550 Expressway Park (96k); Orlando 2700 Hazelhurst
(105k/1972), 10407 Rocket Blvd (104.6k/1981).

- **Finding:** on-market 85k+ industrial-with-IOS is thin and buried by LoopNet's default sort, but
  exists on deeper pages. True sweet spot remains off-market → parcel screen (zoning permits outdoor
  storage + coverage ≤~50% + 80–165k SF + infill), then confirm yard via aerial.
- **Not done:** yard/IOS not confirmed per-property (needs satellite pass); other example markets
  (Charlotte/Greensboro/Rock Hill/Tucson) not yet swept; off-market screen not yet run.
- Session write-up: `SESSION_HANDOFF_2026-06-25_buybox-sourcing.md`.

---

## §3 — 2026-06-25 — Derived the target buy-box from the founder's example properties

The founder supplied two example properties (Orlando 1900 W New Hampshire St; Nashville 801 Space
Park S Dr) and asked to confirm they share the same requirements/size. A multi-source verification
workflow confirmed a tight common profile: **~120k–150k SF, 1960s–70s single-story warehouse/
distribution industrial, heavy/general industrial zoning permitting outdoor storage (I-G / IWD), a
fenced outdoor yard (IOS), ~40–50% building-to-land coverage, infill** (Orlando + Nashville, plus
Columbus/Charlotte).

- **Nuance flagged:** these are *low-coverage value-add industrial-with-yard*, NOT *pure* IOS (pure
  IOS = <25–30% coverage, 10k–100k SF). Underwrite building $/SF + yard as an IOS kicker.
- **Posture nuance:** Orlando = single owner-LLC at a low 2012 basis (off-market approach possible);
  Nashville 801 = one building in an Ivanhoé Cambridge institutional park (a lease/type comp, not an
  acquirable single asset) — same building profile, very different deal.
- **Parcel screen for finding more:** zoning-permits-outdoor-storage AND coverage ≤~50% AND building
  80–160k SF AND lot 5–20+ AC AND infill, then confirm the yard via aerial/Street View.
- Full detail (gitignored — CoStar/owner data): `output/assessments/target-buybox.md`. This buy-box
  now drives the comp/sourcing searches (Orlando + Nashville lists already in `output/assessments/`).

---

## §2 — 2026-06-25 — First single-property on-listing assessment (Initiative #5 angle)

Exercised the tool on a specific property the founder pointed at — 1900 W New Hampshire St,
Orlando (a LoopNet I-G industrial *lease* listing). Read the listing facts + Street View (Mar-2026
imagery) + a background diligence pass (ownership, zoning, submarket).

- **Detection verdict: not adaptively reused** — original-use industrial (1962 factory, still a
  building-materials distribution warehouse). Rubric 0.05 / very_low. The use-mismatch gate worked
  again (it didn't flag a building just for *looking* industrial).
- **Convertibility verdict:** a strong small-bay/flex (EasyBay) *specimen* (30′ clear, strong
  loading, by-right I-G flex, abutting the ~$700M Packing District redevelopment) — but **off-thesis
  as an acquisition** (for-lease, on-market/broker, low-basis owner, not distressed). Best use to us
  = a comp / market reference, or an off-market approach to the owner.
- **Process note:** this confirms the loop also serves the **on-listing single-property mode**
  (Initiative #5), not just area sweeps. The verdict row is in `output/adaptive_reuse_candidates.csv`;
  the full write-up + owner/CoStar specifics are in **gitignored** `output/assessments/` (Category-A).
- **Reusable lessons for listing-sourced properties:** (1) treat the *marketed* SF as suspect and
  reconcile against county gross/heated SF before any $/SF underwriting; (2) confirm current tenancy
  independently — the listing copy here was stale on the operator. (3) For I-G flex conversions in
  Orlando: avoid the "self-storage / mini-warehouse" label (prohibited in I-G); residential reuse
  needs a rezoning.

---

## §1 — 2026-06-25 — Kickoff: scaffold + rubric + tools + live POC

**What landed:**
- **The project** — a new subfolder that sweeps an area in Google Maps Street View (via the
  Claude-in-Chrome extension) to flag buildings already adaptively reused (garage doors on a home,
  gas-canopy over a café, etc.). Framed as the *detection* sibling of INITIATIVE-TRACKER #5 (the
  single-listing convertibility checker) — same imagery+vision plumbing, different question.
- **The rubric** ([`METHODOLOGY.md`](METHODOLOGY.md)) — taxonomy of conversions, Tier A/B/C visual
  tells (Tier-A1 = commercial roll-up door on a residence — the founder's tell), a use-mismatch
  *gate*, additive confidence scoring with knock-downs, and false-positive traps. Web-grounded
  (NPS Rehabilitation Standards + conversion case studies).
- **The vision prompt** ([`../prompts/adaptive_reuse_assessment.md`](../prompts/adaptive_reuse_assessment.md))
  — ready-to-paste, strict-JSON, mirrors offmarket's `value`+`confidence`+`not_visible` discipline.
- **The tools** (stdlib only, all tested green — `python3 -m unittest tools/test_geo.py`, 9/9):
  `tools/sample_points.py` (bbox → Overpass road net → evenly-spaced perpendicular-facing stops;
  also `--point`/`--address`), `tools/build_streetview_urls.py` (stops → stable Maps-URLs pano
  links, + Static API/metadata URLs when a key is set). Live Overpass run verified (102 stops over
  a Downtown-West Columbus bbox via the mail.ru mirror).
- **Live POC** — drove the extension to a real stop (47 Belle St, Columbus / Peninsula–East
  Franklinton, Sep 2025 imagery). The `?api=1&map_action=pano&viewpoint=` URL resolved cleanly to a
  real pano (panoid `M61h63DEEk7IsFZLvXsjUA`); Street View rendered; the rubric was applied; the
  result logged to `output/adaptive_reuse_candidates.csv`. **End-to-end loop proven.**

**Key decisions:**
- **MVP = Chrome-extension human-VLM**, image-ephemeral, attended, low-volume (Google ToS line).
  **V2 = Street View Static API + free metadata endpoint** for anything stored/scaled. Sampling
  layer (Overpass) is shared.
- **URL form:** use the documented `?api=1&map_action=pano&viewpoint=` form; never construct the
  brittle `/@…,3a,…y,…h,…t/data=!` blob. (Confirmed live: Google resolved it to the right pano.)
- **Stdlib-only tools** so the MVP runs with bare `python3`.
- **Own git repo**; root repo is local-only and ignores this via `/*`. All property/owner output =
  Category-A PII (`output/` gitignored). Push only after explicit go-ahead + audit, SSH as korteraz.

**POC finding → methodology refinement (open):**
- The first real stop surfaced the **#1 false positive immediately**: new-build mixed-use in a
  *warehouse/industrial aesthetic* (crisp uniform brick, uniform modern multi-pane windows,
  decorative brick relief) in a redevelopment district reads like a conversion but isn't. The rubric
  correctly capped it **low + needs_human_review** rather than over-flagging — the discipline works.
- **Refinement to build:** pair every Tier-A/B visual read with the parcel's **`year_built`** (a
  strong tell on a post-~2010 building ⇒ imitation, not reuse). `offmarket-scraping/lib/arcgis.py`
  already pulls county parcel data — wire that as the disambiguator. This is the local instance of
  the carried-over lesson *"no single signal is a verdict."*

**Not done (deliberate / next):**
- No full sweep yet (POC was one attended stop). No V2 API path wired (keys are Andrew-held blockers).
- No `year_built` cross-check wired yet (see refinement above).
- Reconcile with INITIATIVE-TRACKER #5's scope (detection vs. convertibility) with Andrew, and with
  Jake Diamond's manual qualification workflow (Initiative #8) before automating on top.

**Files this session:** whole `adaptive-reuse-finder/` subfolder (README, CLAUDE.md, .gitignore,
.env.example, docs/{METHODOLOGY,ARCHITECTURE,CHROME-EXTENSION-RUNBOOK,BUILD_LOG}.md,
prompts/adaptive_reuse_assessment.md, tools/{sample_points,build_streetview_urls,test_geo}.py,
data/areas/EXAMPLE_downtown_west_columbus.csv, output/{SCHEMA.md,adaptive_reuse_candidates.csv}).
Plus a status bump to the root `INITIATIVE-TRACKER.md` #5.
