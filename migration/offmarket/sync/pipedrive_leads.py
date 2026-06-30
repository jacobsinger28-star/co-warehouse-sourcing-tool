#!/usr/bin/env python3
"""
pipedrive_leads.py — push the ranked sourcing queue into Pipedrive's Leads Inbox.

This is the PROSPECTING loader: it takes the scored universe for a market (the ranked
call queue you'd otherwise read off the dashboard) and lands each property in Pipedrive
as a **Lead** — an un-worked prospect a human qualifies, then converts to a Deal.

  owning entity (LLC/trust/corp)  -> Organization
  resolved owner contact / person -> Person (phones + emails), linked to the Organization
  the property itself             -> Lead (title = address · score · SF), linked to Person+Org
  full sourcing context           -> a Note on the Lead (APN, score, grade, SF, year, distance,
                                     owner-on-title, mailing addr, out-of-state flag, contact)

Deliberately separate from sync/pipedrive_sync.py (which lands completed AI *calls* as Deals):
  * different Pipedrive object — Leads Inbox, not the Deal pipeline
  * different local idempotency table — `crm_lead_links`, NOT `crm_links`
so a property can be a prospecting Lead now and a worked Deal later without the two syncs
fighting over one mapping row. Every create is idempotent via crm_lead_links: re-running
never makes a second Org/Person/Lead/Note, it reuses the one already there.

STUB-SAFE: with no PIPEDRIVE_API_TOKEN/PIPEDRIVE_DOMAIN it prints a skip note and exits 0.
`--dry-run` shows exactly what it WOULD push (no token, no network, no DB writes) — review
the mapping first.

    python sync/pipedrive_leads.py --dry-run                   # show the plan, push nothing
    python sync/pipedrive_leads.py --market nashville --top 10 # pilot: top 10 (needs token)
    python sync/pipedrive_leads.py --market nashville          # push the whole universe
    python sync/pipedrive_leads.py --include-manual            # also push the manual-review bucket
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# Reuse the proven, tested pure builders + HTTP clients from the call-outcome sync.
from sync.pipedrive_sync import (  # noqa: E402
    DryRunClient, Pipedrive, _context_lines, build_org_payload, build_person_payload, is_org,
)

LINK_TABLE = "crm_lead_links"


# --------------------------------------------------------------------------- pure builders
def build_lead_title(row: dict) -> str:
    """Address · score · SF — what the team reads in the Leads Inbox at a glance."""
    bits = [row.get("situs_address") or f"APN {row['apn']}"]
    if row.get("score") is not None:
        grade = f" {row['grade_human']}" if row.get("grade_human") else ""
        bits.append(f"{float(row['score']):.0f}/100{grade}")
    if row.get("building_sf") is not None:
        bits.append(f"{float(row['building_sf']):,.0f} SF")
    return " · ".join(bits)


def build_lead_payload(row: dict, person_id: str | None, org_id: str | None) -> dict:
    """A Lead must link to a Person OR an Organization — we always have at least one.
    Pipedrive lead ids are UUIDs; person/org ids are ints, so coerce the links to int."""
    p: dict = {"title": build_lead_title(row)}
    if person_id:
        p["person_id"] = int(person_id) if str(person_id).isdigit() else person_id
    if org_id:
        p["organization_id"] = int(org_id) if str(org_id).isdigit() else org_id
    return p


def build_lead_note(row: dict, lead_id: str | None) -> dict:
    """The full sourcing context, as an HTML note on the Lead."""
    lines = [f"APN: {row['apn']}"] + _context_lines(row)   # _context_lines: score/grade/SF/year/owner/dist
    if row.get("assessed_value") is not None:
        lines.append(f"Assessed value: ${float(row['assessed_value']):,.0f}")
    if row.get("clear_height_est"):
        lines.append(f"Clear height ~{float(row['clear_height_est']):.0f} ft")
    if row.get("mailing_address"):
        lines.append(f"Owner mailing: {row['mailing_address']}")
    if row.get("is_out_of_state"):
        lines.append("⚑ Out-of-state owner")
    lines.append(f"Bucket: {'universe' if row.get('in_universe') else 'manual review'}")
    if row.get("gate_reason"):
        lines.append(f"Gate: {row['gate_reason']}")
    if row.get("person_name"):
        lines.append(f"Contact: {row['person_name']}"
                     + (f" ({row['contact_role']})" if row.get("contact_role") else ""))
    if row.get("phones"):
        lines.append("Phones: " + ", ".join(row["phones"]))
    if row.get("emails"):
        lines.append("Emails: " + ", ".join(row["emails"]))
    p: dict = {"content": "<br>".join(lines)}
    if lead_id:
        p["lead_id"] = lead_id
    return p


# --------------------------------------------------------------------------- idempotency stores
class DbLinks:
    """local object -> remote id, persisted in crm_lead_links (separate from crm_links)."""

    def __init__(self, cur):
        self.cur = cur
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {LINK_TABLE} (
              crm          TEXT NOT NULL DEFAULT 'pipedrive',
              object_type  TEXT NOT NULL,
              local_key    TEXT NOT NULL,
              remote_id    TEXT NOT NULL,
              synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
              PRIMARY KEY (crm, object_type, local_key)
            )""")  # self-create so a pilot needn't migrate a fresh market schema first
        cur.connection.commit()

    def get(self, obj_type: str, local_key) -> str | None:
        self.cur.execute(f"SELECT remote_id FROM {LINK_TABLE} WHERE crm='pipedrive' "
                         "AND object_type=%s AND local_key=%s", (obj_type, str(local_key)))
        r = self.cur.fetchone()
        return r[0] if r else None

    def set(self, obj_type: str, local_key, remote_id) -> None:
        self.cur.execute(
            f"INSERT INTO {LINK_TABLE} (crm, object_type, local_key, remote_id) "
            "VALUES ('pipedrive', %s, %s, %s) "
            "ON CONFLICT (crm, object_type, local_key) "
            "DO UPDATE SET remote_id=EXCLUDED.remote_id, synced_at=now()",
            (obj_type, str(local_key), str(remote_id)))

    def commit(self) -> None:
        self.cur.connection.commit()


class MemLinks:
    """In-memory stand-in for --dry-run: no DB table touched, no rows written."""

    def __init__(self):
        self._d: dict = {}

    def get(self, obj_type: str, local_key) -> str | None:
        return self._d.get((obj_type, str(local_key)))

    def set(self, obj_type: str, local_key, remote_id) -> None:
        self._d[(obj_type, str(local_key))] = str(remote_id)

    def commit(self) -> None:
        pass


# --------------------------------------------------------------------------- queue selection
# The ranked universe + best owner contact per parcel — the same join the dashboard uses,
# reshaped so the reused pipedrive_sync builders find the keys they expect.
ROWS_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (apn) apn, total, grade_human
  FROM scores WHERE version LIKE %(ver)s ORDER BY apn, scored_at DESC
),
owner AS (
  SELECT DISTINCT ON (o.apn) o.apn, e.entity_id, e.entity_type, e.is_out_of_state,
         e.name_raw, e.mailing_address
  FROM ownerships o JOIN entities e USING (entity_id) ORDER BY o.apn, e.entity_id
),
contact AS (
  SELECT DISTINCT ON (entity_id) entity_id, contact_id, person_name, role, phones, emails, confidence
  FROM contacts
  ORDER BY entity_id,
           CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
           coalesce(array_length(phones, 1), 0) DESC,
           coalesce(array_length(emails, 1), 0) DESC
)
SELECT p.apn, p.situs_address, p.in_universe, p.manual_review, p.gate_reason,
       pr.building_sf, pr.year_built, pr.clear_height_est, pr.distance_miles_icbd, pr.assessed_value,
       ow.entity_id, ow.entity_type, ow.is_out_of_state, ow.name_raw, ow.mailing_address,
       c.contact_id, c.person_name, c.role AS contact_role, c.phones, c.emails,
       l.total AS score, l.grade_human
FROM parcels p
JOIN properties pr USING (apn)
LEFT JOIN owner ow ON ow.apn = p.apn
LEFT JOIN contact c ON c.entity_id = ow.entity_id
LEFT JOIN latest l ON l.apn = p.apn
WHERE {bucket}
ORDER BY l.total DESC NULLS LAST, pr.building_sf DESC NULLS LAST
"""


def sync_row(links, client, row: dict) -> dict:
    """Push one property as a Lead (+Org/+Person/+Note). Returns what was created vs reused."""
    made = {"org": False, "person": False, "lead": False, "note": False}

    org_id = None
    if is_org(row["entity_type"]):
        org_id = links.get("organization", row["entity_id"])
        if not org_id:
            org_id = client.create("organizations", build_org_payload(row))
            links.set("organization", row["entity_id"], org_id)
            made["org"] = True

    # A Person for any resolved human contact, or for an individual owner (name_raw IS a person).
    # An org-shaped owner with no human contact gets no Person — the Lead links to the Org.
    person_id = None
    if row.get("person_name") or not is_org(row["entity_type"]):
        pkey = row["contact_id"] if row.get("contact_id") is not None else f"entity-{row['entity_id']}"
        person_id = links.get("person", pkey)
        if not person_id:
            person_id = client.create("persons", build_person_payload(row, org_id))
            links.set("person", pkey, person_id)
            made["person"] = True

    lead_id = links.get("lead", row["apn"])
    if not lead_id:
        lead_id = client.create("leads", build_lead_payload(row, person_id, org_id))
        links.set("lead", row["apn"], lead_id)
        made["lead"] = True

    if not links.get("note", row["apn"]):
        note_id = client.create("notes", build_lead_note(row, lead_id))
        links.set("note", row["apn"], note_id)
        made["note"] = True
    return made


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--market", default=None,
                    help="market name (markets/<name>.yaml); default = active MARKET / nashville")
    ap.add_argument("--top", "--max", type=int, default=None, dest="top",
                    help="push only the top-N ranked rows (pilot)")
    ap.add_argument("--min-score", type=float, default=None,
                    help="skip rows scoring below this")
    ap.add_argument("--include-manual", action="store_true",
                    help="also push the 60–75k manual-review bucket (default: universe only)")
    ap.add_argument("--dry-run", action="store_true",
                    help="show what would be pushed; no token / network / DB writes needed")
    args = ap.parse_args()

    if args.market:
        os.environ["MARKET"] = args.market   # connect() scopes search_path to this market's schema
    from lib.db import cursor                 # imported after MARKET is set
    from lib.market import active_market

    token = os.environ.get("PIPEDRIVE_API_TOKEN")
    domain = os.environ.get("PIPEDRIVE_DOMAIN")

    if args.dry_run:
        client = DryRunClient()
        print(f"  pipedrive_leads: DRY RUN ({active_market()}) — showing the plan, pushing nothing")
    elif not (token and domain):
        print("  pipedrive_leads: PIPEDRIVE_API_TOKEN/PIPEDRIVE_DOMAIN not set — skipping "
              "(stub). Set them in .env to push. `--dry-run` shows the plan without a token.")
        return 0
    else:
        client = Pipedrive(token, domain)
        print(f"  pipedrive_leads: pushing {active_market()} → {domain}.pipedrive.com Leads Inbox")

    bucket = "p.in_universe OR p.manual_review" if args.include_manual else "p.in_universe"
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(ROWS_SQL.format(bucket=bucket), {"ver": "%-final"})
        rows = cur.fetchall()
    if args.min_score is not None:
        rows = [r for r in rows if r["score"] is not None and float(r["score"]) >= args.min_score]
    if args.top is not None:
        rows = rows[: args.top]
    print(f"  leads to push: {len(rows)}"
          + (" (universe only)" if not args.include_manual else " (universe + manual review)"))

    totals = {"org": 0, "person": 0, "lead": 0, "note": 0}

    def _tally(made):
        for k, v in made.items():
            totals[k] += int(v)

    if args.dry_run:
        links = MemLinks()
        for r in rows:
            _tally(sync_row(links, client, r))
    else:
        # Commit PER ROW so a mid-batch failure leaves earlier rows fully linked — an
        # idempotent re-run then resumes instead of re-creating Pipedrive objects.
        with cursor(commit=False) as cur:
            links = DbLinks(cur)
            for r in rows:
                _tally(sync_row(links, client, r))
                links.commit()
    print(f"  created → orgs={totals['org']} persons={totals['person']} "
          f"leads={totals['lead']} notes={totals['note']} "
          f"(existing objects were reused, not duplicated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
