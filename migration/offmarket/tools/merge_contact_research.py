#!/usr/bin/env python3
"""
merge_contact_research.py — fold public-records contact research back into a
skip-trace-style "returned" CSV (Day 9 enrichment, no paid skip-trace account).

Inputs:
  --export    the skiptrace_export.py CSV (owner rows + entity_id join key)
  --research  a JSON array of contact findings, one object per entity_id, shape:
              {"entity_id":..,"phone1":"","phone2":"","email1":"","website":"",
               "registered_agent":"","principals":"","best_source_url":"",
               "source_type":"","confidence":"","notes":""}

Output (--out): every export row, with the research columns appended. Phone/email
columns are named so skiptrace_import.py's heuristic detector (phone|mobile|cell|tel
/ e-?mail) picks them up — i.e. this file imports exactly like a real broker return:

    python tools/merge_contact_research.py \
        --export   exports/skiptrace_20260615.csv \
        --research exports/contact_research_20260616.json \
        --out      exports/skiptrace_returned_publicweb_20260616.csv
    python outreach/skiptrace_import.py \
        --file exports/skiptrace_returned_publicweb_20260616.csv --source public_web

Hard rule (mirrors the project's no-fake-numbers stance): this script only copies
phones/emails that the research file already carries. It never synthesizes one.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

EXTRA_COLS = ["phone1", "phone2", "email1", "website", "registered_agent",
              "principals", "contact_source", "contact_confidence",
              "contact_source_url", "contact_notes"]

PHONE_DIGITS = re.compile(r"\D")


def clean_phone(v: str) -> str:
    if not v:
        return ""
    d = PHONE_DIGITS.sub("", v)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d if len(d) == 10 else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--research", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    research = {str(r["entity_id"]): r
                for r in json.loads(Path(args.research).read_text())}

    rows_out = []
    with open(args.export, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        base_cols = reader.fieldnames or []
        for row in reader:
            r = research.get(str(row.get("entity_id")), {})
            row["phone1"] = clean_phone(r.get("phone1", ""))
            row["phone2"] = clean_phone(r.get("phone2", ""))
            row["email1"] = (r.get("email1", "") or "").strip()
            row["website"] = r.get("website", "")
            row["registered_agent"] = r.get("registered_agent", "")
            row["principals"] = r.get("principals", "")
            row["contact_source"] = r.get("source_type", "")
            row["contact_confidence"] = r.get("confidence", "")
            row["contact_source_url"] = r.get("best_source_url", "")
            row["contact_notes"] = r.get("notes", "")
            rows_out.append(row)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=base_cols + EXTRA_COLS)
        w.writeheader()
        w.writerows(rows_out)

    n_phone = sum(1 for r in rows_out if r["phone1"] or r["phone2"])
    n_email = sum(1 for r in rows_out if r["email1"])
    print(f"  merged: {out} ({len(rows_out)} rows)")
    print(f"  {n_phone} rows with >=1 phone ({n_phone/len(rows_out)*100:.0f}%), "
          f"{n_email} with an email")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
