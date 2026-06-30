#!/usr/bin/env python3
"""
merge_contact_parts.py — consolidate the workflow's per-batch contact research into
one research JSON per market, ready for tools/merge_contact_research.py.

The owner-contact-enrichment workflow wrote one file per batch to
exports/contact_research_parts/part_<NNN>.json (a JSON array of contact dicts). Those
records carry entity_id but NOT market, and entity_id is only unique *within* a market's
Postgres schema — so we recover each record's market by joining part_<NNN>.json back to
its source batch exports/contact_queue_parts/batch_<NNN>.json (same index, same owners),
which does carry market. The 30-owner calibration file (market from exports/_calib.json)
and any prior hand-research JSONs are folded in too.

Output: exports/contact_research_<market>.json — the union of every source-backed finding
for that market, keyed by entity_id, in the exact shape merge_contact_research.py reads.

    python tools/merge_contact_parts.py
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPORTS = ROOT / "exports"
PARTS = EXPORTS / "contact_research_parts"
BATCHES = EXPORTS / "contact_queue_parts"

# Fields a research record must expose for merge_contact_research.py.
FIELDS = ["entity_id", "owner_name", "registered_agent", "principals", "phone1",
          "phone2", "email1", "website", "best_source_url", "source_type",
          "confidence", "notes"]


def _norm(rec: dict) -> dict:
    """Coerce a raw finding into the canonical shape (missing keys -> '')."""
    out = {k: (rec.get(k, "") or "") for k in FIELDS}
    try:
        out["entity_id"] = int(rec.get("entity_id"))
    except (TypeError, ValueError):
        out["entity_id"] = rec.get("entity_id")
    return out


def _has_contact(rec: dict) -> bool:
    p1 = re.sub(r"\D", "", str(rec.get("phone1") or ""))
    p2 = re.sub(r"\D", "", str(rec.get("phone2") or ""))
    em = str(rec.get("email1") or "")
    return len(p1) >= 10 or len(p2) >= 10 or "@" in em


def _better(a: dict, b: dict) -> dict:
    """Pick the richer of two findings for the same (market, entity_id)."""
    if _has_contact(b) and not _has_contact(a):
        return b
    if _has_contact(a) and not _has_contact(b):
        return a
    rank = {"high": 3, "medium": 2, "low": 1, "": 0}
    return b if rank.get(b.get("confidence", ""), 0) > rank.get(a.get("confidence", ""), 0) else a


def main() -> int:
    # market -> {entity_id -> record}
    by_market: dict[str, dict[int, dict]] = {}

    def add(market: str, rec: dict) -> None:
        rec = _norm(rec)
        eid = rec["entity_id"]
        m = by_market.setdefault(market, {})
        m[eid] = _better(m[eid], rec) if eid in m else rec

    # 1) Workflow part files, market recovered from the matching batch file.
    n_parts = n_part_recs = 0
    for part_path in sorted(glob.glob(str(PARTS / "part_*.json"))):
        idx = re.search(r"part_(\d+)\.json", part_path).group(1)
        batch_path = BATCHES / f"batch_{idx}.json"
        if not batch_path.exists():
            print(f"  ! no batch file for {part_path} — skipping")
            continue
        eid_market = {int(o["entity_id"]): o["market"]
                      for o in json.loads(batch_path.read_text())}
        try:
            recs = json.loads(Path(part_path).read_text())
        except json.JSONDecodeError as e:
            print(f"  ! bad JSON in {part_path}: {e} — skipping")
            continue
        n_parts += 1
        for rec in recs:
            try:
                eid = int(rec.get("entity_id"))
            except (TypeError, ValueError):
                continue
            market = eid_market.get(eid)
            if market:
                add(market, rec)
                n_part_recs += 1

    # 2) Calibration batch (market map from _calib.json).
    calib_map = {}
    calib_json = EXPORTS / "_calib.json"
    if calib_json.exists():
        for grp in json.loads(calib_json.read_text()).values():
            for o in grp:
                calib_map[int(o["entity_id"])] = o["market"]
    calib_recs = EXPORTS / "contact_research_calib_20260617.json"
    if calib_recs.exists():
        for rec in json.loads(calib_recs.read_text()):
            m = calib_map.get(int(rec["entity_id"]))
            if m:
                add(m, rec)

    # 3) Prior hand-research (Nashville top-50 + SOS), all Nashville.
    for prior in ("contact_research_20260616.json", "contact_research_sos_20260616.json"):
        p = EXPORTS / prior
        if p.exists():
            for rec in json.loads(p.read_text()):
                add("nashville", rec)

    # Write one file per market.
    for market, recs in sorted(by_market.items()):
        out = EXPORTS / f"contact_research_{market}.json"
        ordered = sorted(recs.values(), key=lambda r: r["entity_id"])
        out.write_text(json.dumps(ordered, indent=1))
        n = len(ordered)
        wc = sum(1 for r in ordered if _has_contact(r))
        print(f"  {market}: {out.name} — {n} owners, {wc} with a source-backed contact "
              f"({wc/n*100:.0f}%)")

    total = sum(len(v) for v in by_market.values())
    print(f"  consolidated {n_part_recs} part records from {n_parts} batch files "
          f"+ calibration + prior → {total} owner records across {len(by_market)} markets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
