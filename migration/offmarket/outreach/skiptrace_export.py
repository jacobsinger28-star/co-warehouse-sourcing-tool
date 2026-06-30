#!/usr/bin/env python3
"""
skiptrace_export.py — export top owners to a BatchSkipTracing-style upload CSV (Day 9).

Skip tracing is per-OWNER, not per-property: an entity that owns 6 parcels is traced
once. We dedupe to entities (portfolio level) and emit one row each.

Target selection:
  --grade A         only owners whose best property carries that Airtable grade
  --top N           top N owners by best property score   (default; used until grades exist)
If --grade is given but no human grades exist yet (Airtable not wired up), we fall
back to --top with a loud notice rather than exporting an empty file.

The `entity_id` column is the join key for skiptrace_import.py — most brokers preserve
extra columns through the round-trip; if yours strips them, import falls back to
name+address matching. `needs_sos_first` flags LLC/trust/corp owners that must be
resolved to a human via the TN SOS SOP (docs/SOS_SOP.md) BEFORE tracing is useful.

    python outreach/skiptrace_export.py --top 50 --out exports/skiptrace_20260612.csv
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import cursor  # noqa: E402

# One row per owning entity: best (max) score across its parcels, a representative
# parcel + mailing address, and portfolio size. grade_human comes back from Airtable.
TARGETS_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (apn) apn, total, grade_human
  FROM scores WHERE version LIKE '%-final'
  ORDER BY apn, scored_at DESC
),
ent AS (
  SELECT e.entity_id, e.name_raw, e.entity_type, e.mailing_state,
         e.is_out_of_state,
         max(l.total) AS best_score,
         max(l.grade_human) AS grade,
         count(DISTINCT o.apn) AS parcels,
         (array_agg(o.apn ORDER BY l.total DESC NULLS LAST))[1] AS top_apn
  FROM entities e
  JOIN ownerships o USING (entity_id)
  JOIN latest l ON l.apn = o.apn
  WHERE l.total IS NOT NULL
  GROUP BY e.entity_id
),
addr AS (
  SELECT DISTINCT ON (o.entity_id) o.entity_id,
         s.own_addr, s.own_city, s.own_state, s.own_zip
  FROM ownerships o JOIN staging_parcels s ON s.apn = o.apn
  ORDER BY o.entity_id, s.apn
)
SELECT ent.*, p.situs_address AS top_address,
       a.own_addr, a.own_city, a.own_state, a.own_zip
FROM ent
LEFT JOIN parcels p ON p.apn = ent.top_apn
LEFT JOIN addr a ON a.entity_id = ent.entity_id
"""

PERSON_TYPES = {"individual"}


def split_name(name_raw: str, entity_type: str) -> tuple[str, str, str]:
    """Return (first, last, business). People parse to first/last; orgs to business."""
    if entity_type not in PERSON_TYPES:
        return "", "", name_raw
    # Assessor convention "LAST, FIRST MIDDLE [& SECOND OWNER]".
    head = re.split(r"\s*&\s*|\s+AND\s+", name_raw)[0]  # first owner only
    if "," in head:
        last, rest = head.split(",", 1)
        toks = rest.strip().split()
        first = toks[0] if toks else ""
        return first.title(), last.strip().title(), ""
    return "", head.strip().title(), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grade", choices=("A", "B", "C"), default=None)
    ap.add_argument("--top", type=int, default=50)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(TARGETS_SQL)
        rows = cur.fetchall()

    if args.grade:
        graded = [r for r in rows if r["grade"] == args.grade]
        if graded:
            rows = graded
            print(f"  filtering to grade {args.grade}: {len(rows)} owners")
        else:
            print(f"  !! no '{args.grade}'-graded owners yet (Airtable not wired up / "
                  f"not graded) — falling back to top {args.top} by score")
            rows.sort(key=lambda r: r["best_score"], reverse=True)
            rows = rows[: args.top]
    else:
        rows.sort(key=lambda r: r["best_score"], reverse=True)
        rows = rows[: args.top]

    out = Path(args.out) if args.out else Path("exports/skiptrace_export.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    cols = ["entity_id", "owner_name", "first_name", "last_name", "business_name",
            "mailing_street", "mailing_city", "mailing_state", "mailing_zip",
            "entity_type", "needs_sos_first", "best_score", "parcels_owned",
            "top_apn", "top_property_address"]
    n_sos = 0
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            first, last, biz = split_name(r["name_raw"], r["entity_type"])
            needs_sos = r["entity_type"] not in PERSON_TYPES
            n_sos += needs_sos
            w.writerow([
                r["entity_id"], r["name_raw"], first, last, biz,
                r["own_addr"], r["own_city"], r["own_state"], r["own_zip"],
                r["entity_type"], "yes" if needs_sos else "no",
                round(float(r["best_score"]), 1), r["parcels"],
                r["top_apn"], r["top_address"],
            ])
    print(f"  skip-trace export: {out} ({len(rows)} owners)")
    print(f"  {n_sos} are LLC/trust/corp -> resolve to a human via docs/SOS_SOP.md "
          f"before tracing; {len(rows) - n_sos} are individuals (trace directly)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
