#!/usr/bin/env python3
"""
skiptrace_import.py — load a returned skip-trace CSV into contacts (Day 9).

BatchSkipTracing (and similar) return your uploaded rows with phone/email columns
appended. We:
  * match each returned row back to its entity (by the round-tripped entity_id
    column; fall back to normalized name+mailing address),
  * collect every phone-like and email-like column,
  * upsert one contact per (entity, source) into `contacts`.

Phone/email columns are detected heuristically (any header containing 'phone'/'mobile'
/'cell' or 'email') so we don't hard-code one broker's exact schema. dnc_checked stays
FALSE — DNC scrubbing is a separate manual/legal step before dialing.

Idempotent: re-importing the same file refreshes that entity's batchskiptracing contact.

    python outreach/skiptrace_import.py --file exports/skiptrace_returned.csv
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402
from lib.normalize_text import norm_address, norm_name  # noqa: E402

PHONE_RE = re.compile(r"phone|mobile|cell|tel", re.I)
EMAIL_RE = re.compile(r"e-?mail", re.I)
PHONE_DIGITS = re.compile(r"\d")


def clean_phone(v: str) -> str | None:
    if not v:
        return None
    digits = re.sub(r"\D", "", v)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def build_entity_lookup() -> dict[str, int]:
    """name_norm + mailing_norm -> entity_id, for the fallback match path."""
    out = {}
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT entity_id, name_norm, mailing_norm FROM entities")
        for r in cur.fetchall():
            out[(r["name_norm"], r["mailing_norm"] or "")] = r["entity_id"]
    return out


def resolve_entity(row: dict, lookup: dict, valid_ids: set[int]) -> int | None:
    eid = row.get("entity_id")
    if eid and str(eid).isdigit() and int(eid) in valid_ids:
        return int(eid)
    # Fallback: reconstruct the normalized key from name + mailing columns.
    name = row.get("owner_name") or row.get("business_name") or \
        " ".join(filter(None, [row.get("first_name"), row.get("last_name")]))
    key = (norm_name(name),
           norm_address(row.get("mailing_street"), row.get("mailing_city"),
                        row.get("mailing_state"), row.get("mailing_zip")))
    return lookup.get(key)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--source", default="batchskiptracing")
    args = ap.parse_args()
    path = Path(args.file)
    if not path.exists():
        print(f"skiptrace_import: {path} not found"); return 1

    lookup = build_entity_lookup()
    valid_ids = set(lookup.values())
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT entity_id FROM entities")
        valid_ids = {r["entity_id"] for r in cur.fetchall()}

    contacts = []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        phone_cols = [c for c in (reader.fieldnames or []) if PHONE_RE.search(c)]
        email_cols = [c for c in (reader.fieldnames or []) if EMAIL_RE.search(c)]
        if not phone_cols:
            print(f"  !! no phone-like columns in {reader.fieldnames} — nothing to import")
            return 1
        print(f"  phone columns: {phone_cols}  email columns: {email_cols or 'none'}")

        n_rows = no_hit = 0
        with JobRun("skiptrace_import") as job:
            for row in reader:
                n_rows += 1
                eid = resolve_entity(row, lookup, valid_ids)
                if not eid:
                    # A row we can't tie back to an entity IS a real failure.
                    job.fail("could not match to an entity", ref=row.get("owner_name"))
                    continue
                phones = sorted({p for c in phone_cols if (p := clean_phone(row.get(c, "")))})
                emails = sorted({e.strip().lower() for c in email_cols
                                 if (e := row.get(c, "")) and "@" in e})
                if not phones and not emails:
                    # Broker returned no contact info: a normal "miss", NOT a failure.
                    no_hit += 1
                    job.ok()
                    continue
                # Prefer the researched human (principal / registered agent) as the
                # person behind the entity; fall back to the entity/owner name. Older
                # broker CSVs lack these columns, so .get() keeps the original behavior.
                principal = (row.get("principals") or "").strip()
                ragent = (row.get("registered_agent") or "").strip()
                owner = (row.get("owner_name")
                         or " ".join(filter(None, [row.get("first_name"), row.get("last_name")]))
                         or None)
                if principal:
                    person, role = principal, "officer"
                elif ragent:
                    person, role = ragent, "registered_agent"
                else:
                    person, role = owner, "owner"
                # The research carries its own confidence; trust it over the phone-count
                # heuristic when present (a single corporate main line can still be "high").
                conf = (row.get("contact_confidence") or "").strip().lower()
                if conf not in ("high", "medium", "low"):
                    conf = "high" if len(phones) >= 2 else ("medium" if phones else "low")
                contacts.append((eid, person, role, phones, emails, args.source, conf))
                job.ok()

            with cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO contacts
                      (entity_id, person_name, role, phones, emails, source, confidence)
                    VALUES %s
                    ON CONFLICT (entity_id, source) DO UPDATE SET
                      person_name = EXCLUDED.person_name, role = EXCLUDED.role,
                      phones = EXCLUDED.phones, emails = EXCLUDED.emails,
                      confidence = EXCLUDED.confidence
                    """,
                    contacts, page_size=500,
                )
    hit_rate = (len(contacts) / n_rows * 100) if n_rows else 0
    print(f"  contacts upserted: {len(contacts)}")
    print(f"  hit rate: {len(contacts)}/{n_rows} rows returned a number "
          f"({hit_rate:.0f}%) · {no_hit} no-hits (QA #9; brief expects ~50-60%)")
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT count(*) AS n, count(*) FILTER (WHERE array_length(phones,1)>0) "
                    "AS with_phone FROM contacts")
        r = cur.fetchone()
        print(f"  contacts total: {r['n']} ({r['with_phone']} with >=1 phone)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
