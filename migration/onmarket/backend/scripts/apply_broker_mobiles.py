"""
Apply researched broker phone numbers to Pipedrive — MOBILE-FIRST.

This is the durable, repeatable writer for broker phone enrichment. It enforces
the rule the team cares about: the broker's MOBILE/cell is the primary number;
the office line is kept only as a secondary. (See memory: broker-phone-mobile-first.)

It is intentionally:
  * mobile-first  — a row's `mobile` becomes the primary (label "mobile"); `office`
    is added as a secondary "work" number. A row with only an office number is
    written as office and clearly is NOT treated as a cell.
  * non-destructive — existing numbers on the contact are preserved; we append and
    only promote the mobile to primary. We never overwrite a number already there.
  * auditable — every write drops a note with the source URL + confidence.

Input: a JSON file (--in) that is a list of objects:
  {"person_id": int, "mobile": str|null, "office": str|null,
   "source_url": str|null, "confidence": "high|medium|low|not_found", "name": str}

Usage (from backend/):
  python -m scripts.apply_broker_mobiles --in /tmp/broker_mobiles.json            # dry-run
  PIPEDRIVE_API_TOKEN=... python -m scripts.apply_broker_mobiles --in f.json --push
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, ".")
from dotenv import load_dotenv  # noqa: E402
load_dotenv()

import requests  # noqa: E402

_BASE = "https://api.pipedrive.com/v1"


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True, help="JSON results file")
    ap.add_argument("--push", action="store_true", help="write to Pipedrive (default: dry-run)")
    args = ap.parse_args()

    token = os.getenv("PIPEDRIVE_API_TOKEN")
    rows = json.load(open(args.infile))

    wrote = mobiles = office_only = skipped = 0
    for r in sorted(rows, key=lambda x: x.get("person_id", 0)):
        pid = r.get("person_id")
        mobile = r.get("mobile")
        office = r.get("office")
        src = r.get("source_url")
        conf = r.get("confidence", "?")
        name = r.get("name", "")
        if not pid or (not mobile and not office):
            print(f"  SKIP {pid} {name} (no number)")
            skipped += 1
            continue

        kind = "MOBILE" if mobile else "office-only"
        print(f"  {'WOULD WRITE' if not args.push else 'WRITE'} {pid} {name[:22]:<22} "
              f"mobile={mobile or '-'} office={office or '-'} ({conf}, {kind})")
        if not args.push:
            mobiles += 1 if mobile else 0
            office_only += 0 if mobile else 1
            continue

        if not token:
            print("ERROR: PIPEDRIVE_API_TOKEN not set"); sys.exit(1)

        # Office-only result (no published cell): leave the contact's existing
        # number(s) untouched — don't churn it. Mobile is the only thing we fix.
        if not mobile:
            print(f"     office-only — left existing number unchanged ({name})")
            office_only += 1
            continue

        p = requests.get(f"{_BASE}/persons/{pid}", params={"api_token": token}, timeout=15).json().get("data") or {}
        cur = [x for x in (p.get("phone") or []) if x.get("value")]

        # Rebuild authoritatively: MOBILE first (label mobile, primary) — even if
        # the number was already on the contact under a different label — then the
        # office, then any other existing distinct numbers (kept, never primary).
        # Dedup by digits so we never duplicate or leave the office as primary.
        new_phones = []
        seen: set[str] = set()

        def _add(val, label, primary):
            d = _digits(val)
            if not val or d in seen:
                return
            seen.add(d)
            new_phones.append({"value": val, "label": label, "primary": primary})

        _add(mobile, "mobile", True)
        if office and _digits(office) != _digits(mobile):
            _add(office, "work", False)
        for x in cur:
            lbl = "mobile" if _digits(x["value"]) == _digits(mobile) else x.get("label", "work")
            _add(x["value"], lbl, False)
        # Guarantee exactly one primary (the mobile).
        if not any(x["primary"] for x in new_phones):
            new_phones[0]["primary"] = True

        rr = requests.put(f"{_BASE}/persons/{pid}", params={"api_token": token},
                          json={"phone": new_phones}, timeout=15).json()
        if not rr.get("success"):
            print(f"     FAIL set phone {pid}")
            skipped += 1
            continue
        # Source note — skip if one already records this mobile (avoid dup notes).
        existing_notes = requests.get(f"{_BASE}/notes", params={"api_token": token, "person_id": pid, "limit": 50}, timeout=15).json().get("data") or []
        if not any(_digits(mobile) and _digits(mobile) in _digits(n.get("content", "")) and "obile" in n.get("content", "") for n in existing_notes):
            body = f"<b>Mobile</b> ({conf}): {mobile}"
            if office:
                body += f" · Office {office}"
            if src:
                body += f' — <a href="{src}">{src}</a>'
            requests.post(f"{_BASE}/notes", params={"api_token": token},
                          json={"content": body, "person_id": pid}, timeout=15)
        wrote += 1
        mobiles += 1 if mobile else 0
        office_only += 0 if mobile else 1

    verb = "Wrote" if args.push else "Would write"
    print(f"\n{verb}: {wrote if args.push else (mobiles+office_only)} contacts "
          f"({mobiles} with mobile, {office_only} office-only); skipped {skipped}.")


if __name__ == "__main__":
    main()
