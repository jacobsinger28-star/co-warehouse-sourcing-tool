#!/usr/bin/env python3
"""
score.py — assemble per-property facts from the DB, score via scoring/rules.py,
persist explainable score rows, export the ranked list (Day 5).

The scoring math lives entirely in scoring/rules.py (pure, unit-tested,
weights-driven). This file only: reads facts, calls compute_score, writes scores,
exports CSV. Gates here and in build_universe use the SAME evaluate_gates code.

  --stage provisional   pre-imagery pass; picks the top-200 for fetch_images
  --stage final         post-VLM pass; the list the founder works

Each run appends a snapshot to `scores` (PK apn+scored_at) — history is kept so
"why did this move?" is answerable across weekly refreshes.

    python scoring/score.py --stage provisional
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.config import load_weights  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import active_market, industrial_codes  # noqa: E402
from lib.normalize_text import estate_flag  # noqa: E402
from scoring.rules import compute_score  # noqa: E402

FACTS_SQL = """
WITH viol AS (
  SELECT apn, count(*) AS n24
  FROM distress_signals
  WHERE type = 'code_violation'
    AND event_date >= now() - interval '24 months'
  GROUP BY apn
),
permit AS (
  SELECT apn, TRUE AS no_permits_flag
  FROM distress_signals
  WHERE type = 'permit_anomaly' AND detail LIKE 'no_permits_10yr_pre1985%%'
  GROUP BY apn
),
cond AS (
  -- assessor CAMA condition/obsolescence flag (detail starts with the severity word).
  -- Markets without these signals contribute no rows -> cama_condition is NULL -> scores 0.
  SELECT apn,
         CASE WHEN bool_or(detail LIKE 'poor%%') THEN 'poor'
              WHEN bool_or(detail LIKE 'fair%%') THEN 'fair' END AS cama_condition
  FROM distress_signals WHERE type = 'poor_condition' GROUP BY apn
),
tax AS (
  -- Years delinquent: prefer the parsed count (import_csv._years_delinquent ->
  -- years_delinquent), fall back to distinct tax-year strings, floored at 1
  -- (presence in the Trustee file => at least one year delinquent). NOTE: the old
  -- count(DISTINCT tax_years) alone is 1 for one-row-per-APN files and so could
  -- NEVER reach the 2+ tier. Calibrate the parse when the real file arrives.
  SELECT apn_norm AS apn,
         GREATEST(COALESCE(MAX(years_delinquent), 0),
                  count(DISTINCT tax_years), 1)::int AS years
  FROM staging_tax_delinquency
  GROUP BY apn_norm
),
owner AS (
  -- one owner row per parcel; deterministic pick (lowest entity_id) when multiple
  SELECT DISTINCT ON (o.apn) o.apn, e.entity_type, e.is_out_of_state, e.name_raw
  FROM ownerships o JOIN entities e USING (entity_id)
  ORDER BY o.apn, e.entity_id
)
SELECT p.apn, p.land_use_code, p.in_target_submarket, p.situs_address,
       pr.building_sf, pr.building_sf_largest, pr.building_count,
       pr.distance_miles_icbd, pr.hold_years, pr.year_built, pr.sf_confidence,
       ow.entity_type, ow.is_out_of_state, ow.name_raw,
       COALESCE(v.n24, 0)      AS code_violations_24mo,
       COALESCE(pm.no_permits_flag, FALSE) AS permit_none_10yr_pre1985,
       cd.cama_condition,
       t.years                 AS tax_delinquency_years,
       so.parking_fullness, so.signage_present, so.condition, so.divisibility,
       so.truck_access, so.dock_doors_est, so.drive_ins_est,
       (so.apn IS NOT NULL AND (so.image_paths IS NULL
            OR array_length(so.image_paths, 1) IS NULL)) AS no_usable_imagery
FROM parcels p
JOIN properties pr USING (apn)
LEFT JOIN owner ow ON ow.apn = p.apn
LEFT JOIN viol v ON v.apn = p.apn
LEFT JOIN permit pm ON pm.apn = p.apn
LEFT JOIN cond cd ON cd.apn = p.apn
LEFT JOIN tax t ON t.apn = p.apn
LEFT JOIN site_observations so ON so.apn = p.apn
WHERE p.in_universe OR p.manual_review
"""

# Human grades (A/B/C) are pulled in from Airtable and stored on a scores row. Each
# score run APPENDS a new snapshot, and every consumer reads the NEWEST row per APN
# (DISTINCT ON apn ORDER BY scored_at DESC). So a fresh snapshot MUST carry the most
# recent human grade forward — otherwise weekly re-scoring silently buries the grade
# under a NULL-grade row and `--grade A` selection goes empty. See docs/BUILD_LOG.md.
LATEST_GRADES_SQL = """
SELECT DISTINCT ON (apn) apn, grade_human
FROM scores WHERE grade_human IS NOT NULL
ORDER BY apn, scored_at DESC
"""


def latest_grades(cur) -> dict[str, str]:
    """Most-recent non-null human grade per APN. `cur` must be a dict cursor."""
    cur.execute(LATEST_GRADES_SQL)
    return {r["apn"]: r["grade_human"] for r in cur.fetchall()}


def _facts(row: dict) -> dict:
    f = lambda v: float(v) if v is not None else None  # noqa: E731
    return {
        "apn": row["apn"],
        "building_sf": f(row["building_sf"]),
        "land_use_industrial": row["land_use_code"] in industrial_codes(),
        "in_target_submarket": bool(row["in_target_submarket"]),
        "distance_miles_icbd": f(row["distance_miles_icbd"]),
        "parking_fullness": row["parking_fullness"],
        "signage_present": row["signage_present"],
        "tax_delinquency_years": row["tax_delinquency_years"],
        "dock_doors_est": row["dock_doors_est"],
        "drive_ins_est": row["drive_ins_est"],
        "divisibility": row["divisibility"],
        "condition": row["condition"],
        "truck_access": row["truck_access"],
        "code_violations_24mo": row["code_violations_24mo"],
        "hold_years": f(row["hold_years"]),
        "entity_type": row["entity_type"],
        "is_out_of_state": bool(row["is_out_of_state"]),
        "estate_keyword": estate_flag(row["name_raw"]),
        "permit_lapsed_or_expired": False,  # not derivable from Issued feed (DATA_NOTES)
        "permit_none_10yr_pre1985": bool(row["permit_none_10yr_pre1985"]),
        "cama_condition": row["cama_condition"],
        "year_built": row["year_built"],
        "sf_mismatch": row["sf_confidence"] == "mismatch",
        "violation_join_uncertain": False,  # APN-keyed joins; flag stays for fallback joins
        "no_usable_imagery": bool(row["no_usable_imagery"]),
    }


def run(stage: str) -> list[dict]:
    cfg = load_weights()
    version = f"{cfg.get('version', 'v?')}-{stage}"
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(FACTS_SQL)
        rows = cur.fetchall()
        prior_grades = latest_grades(cur)

    results = []
    with JobRun(f"score-{stage}") as job:
        scored_rows = []
        for row in rows:
            res = compute_score(_facts(row), cfg)
            results.append({**row, **res})
            scored_rows.append(
                (row["apn"], version, res["total"],
                 prior_grades.get(row["apn"]),
                 psycopg2.extras.Json(res)))
            job.ok()
        with cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO scores (apn, version, total, grade_human, components) "
                "VALUES %s",
                scored_rows, page_size=1000,
            )
    print(f"  scored {len(results)} properties (version {version})")
    return results


def export(results: list[dict], stage: str) -> Path:
    out_dir = Path("exports")
    out_dir.mkdir(exist_ok=True)
    # Market in the filename so a Charlotte run can't overwrite Nashville's same-day CSV.
    out = out_dir / f"ranked_{active_market()}_{date.today():%Y%m%d}_{stage}.csv"
    ranked = sorted(
        (r for r in results if r["status"] == "scored"),
        key=lambda r: r["total"], reverse=True)
    cols = ["rank", "apn", "total", "situs_address", "building_sf",
            "building_sf_largest", "building_count", "year_built",
            "distance_miles_icbd", "hold_years", "entity_type", "name_raw",
            "is_out_of_state", "code_violations_24mo", "permit_none_10yr_pre1985",
            "gate_reason", "components"]
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for i, r in enumerate(ranked, 1):
            w.writerow([i] + [r.get(c) if c != "components" else r["components"]
                              for c in cols[1:]])
    print(f"  ranked export: {out} ({len(ranked)} rows)")
    print(f"\n  top 10 (founder: grade these A/B/C per FOUNDER_INPUTS.md #4):")
    for i, r in enumerate(ranked[:10], 1):
        comp = r["components"]
        drivers = sorted(comp.items(), key=lambda kv: -kv[1])[:3]
        why = ", ".join(f"{k}={v:g}" for k, v in drivers if v > 0)
        print(f"   {i:>2}. {r['total']:>5.1f}  {r['apn']:<16} "
              f"{(r['situs_address'] or '?')[:34]:<34} "
              f"{r['building_sf']:>9,.0f} SF  [{why}]")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=("provisional", "final"), default="provisional")
    args = ap.parse_args()
    print(f"score: stage={args.stage} ...")
    results = run(args.stage)
    export(results, args.stage)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
