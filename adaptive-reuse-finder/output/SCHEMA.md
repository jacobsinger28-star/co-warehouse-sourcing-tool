# `adaptive_reuse_candidates.csv` — column dictionary

The output of a sweep. **The CSV itself is gitignored** (it carries real property addresses =
Category-A PII); this dictionary is safe to track. One row per classified stop you choose to keep
(typically only flagged / review candidates, not every "very_low" pass-through).

| Column | Source | Notes |
|---|---|---|
| `id` | tool | stable row id (e.g. `area-NNN`) |
| `area` | sample_points | the area label |
| `source` | classification | `extension` (MVP human-VLM) / `static_api` (V2) / `manual` |
| `model_version` | classification | `human-chrome-vlm` for the MVP (mirrors offmarket) |
| `assessed_at` | tool | date classified (YYYY-MM-DD) |
| `street_name` | sample_points | road the stop sits on |
| `sample_lat`,`sample_lng` | sample_points | the requested viewpoint |
| `heading`,`side` | sample_points | facing heading + which side of the street |
| `snapped_address` | Street View | address Google snapped the pano to |
| `pano_id` | Street View / metadata | the panorama id (idempotency / dedup key) |
| `pano_lat`,`pano_lng` | Street View / metadata | the *actual* pano location |
| `capture_date` | Street View / metadata | imagery vintage (stale imagery is a known trap) |
| `streetview_url` | tool | the pano URL (for human re-check) |
| `adaptive_reuse_likelihood` | rubric | 0.00–1.00 |
| `confidence_band` | rubric | `high`/`medium`/`low`/`very_low` |
| `primary_signals` | rubric | `tier:signal` items, `;`-joined (e.g. `B:industrial_windows`) |
| `original_use_guess` | rubric | + envelope design intent |
| `current_use_guess` | rubric | what it's used for now |
| `use_mismatch` | rubric | the gate: current use ≠ envelope intent |
| `needs_human_review` | rubric | true/false |
| `review_reason` | rubric | why review is needed |
| `reasoning` | rubric | 1–3 sentence justification |

**Provenance discipline (from `../offmarket-scraping`):** never store the image itself in the MVP —
only these derived fields + coordinates (ToS + PII). If you ever merge this into the offmarket
`site_observations` table, remember its upsert is a **full-row replace** — read-reconstruct-overlay,
never partial-write.
