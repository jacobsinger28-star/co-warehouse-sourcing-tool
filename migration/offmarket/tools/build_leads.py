#!/usr/bin/env python3
"""
build_leads.py — produce a single dial-ready leads CSV for the call queue.

Joins the enriched owner rows (skiptrace returned CSV, which carries the contact
research) with the ranked property export (rank + property/score detail), keyed on
top_apn == apn. One row per owning entity, sorted by score, columns ordered for a
caller working the list top-down.

    python tools/build_leads.py \
        --returned exports/skiptrace_returned_publicweb_20260616.csv \
        --ranked   exports/ranked_20260612_final.csv \
        --out      exports/leads_dialready_20260616.csv
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

LEAD_COLS = [
    "rank", "best_score", "property_address", "apn", "building_sf", "year_built",
    "distance_miles_icbd", "hold_years", "code_violations_24mo",
    "entity_type", "owner_name", "parcels_owned", "mailing_address",
    "is_out_of_state", "needs_sos_first",
    "principals", "registered_agent", "phone1", "phone2", "email1", "website",
    "contact_confidence", "contact_source", "contact_source_url", "contact_notes",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--returned", required=True)
    ap.add_argument("--ranked", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    ranked = {}
    with open(args.ranked, newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            ranked[r["apn"]] = r

    leads = []
    with open(args.returned, newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            rk = ranked.get(r.get("top_apn"), {})
            mailing = ", ".join(p for p in [
                r.get("mailing_street"), r.get("mailing_city"),
                r.get("mailing_state"), r.get("mailing_zip")] if p)
            leads.append({
                "rank": rk.get("rank", ""),
                "best_score": r.get("best_score", ""),
                "property_address": r.get("top_property_address", ""),
                "apn": r.get("top_apn", ""),
                "building_sf": rk.get("building_sf", ""),
                "year_built": rk.get("year_built", ""),
                "distance_miles_icbd": rk.get("distance_miles_icbd", ""),
                "hold_years": rk.get("hold_years", ""),
                "code_violations_24mo": rk.get("code_violations_24mo", ""),
                "entity_type": r.get("entity_type", ""),
                "owner_name": r.get("owner_name", ""),
                "parcels_owned": r.get("parcels_owned", ""),
                "mailing_address": mailing,
                "is_out_of_state": rk.get("is_out_of_state", ""),
                "needs_sos_first": r.get("needs_sos_first", ""),
                "principals": r.get("principals", ""),
                "registered_agent": r.get("registered_agent", ""),
                "phone1": r.get("phone1", ""),
                "phone2": r.get("phone2", ""),
                "email1": r.get("email1", ""),
                "website": r.get("website", ""),
                "contact_confidence": r.get("contact_confidence", ""),
                "contact_source": r.get("contact_source", ""),
                "contact_source_url": r.get("contact_source_url", ""),
                "contact_notes": r.get("contact_notes", ""),
            })

    # Sort by score desc; rows that have a phone float above equal-score rows.
    leads.sort(key=lambda r: (float(r["best_score"] or 0),
                              1 if (r["phone1"] or r["phone2"]) else 0),
               reverse=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=LEAD_COLS)
        w.writeheader()
        w.writerows(leads)

    n_phone = sum(1 for r in leads if r["phone1"] or r["phone2"])
    print(f"  leads: {out} ({len(leads)} owners, {n_phone} with >=1 phone)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
