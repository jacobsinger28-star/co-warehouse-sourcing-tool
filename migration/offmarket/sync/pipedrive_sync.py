#!/usr/bin/env python3
"""
pipedrive_sync.py — push AI-call outcomes into Pipedrive (the outreach system of record).

After place_calls.py dials and call_results.py records outcomes, this lands each completed
call in Pipedrive so a human works it from the CRM:
  * owning entity        -> Organization (LLC/trust/corp) — individuals skip straight to Person
  * resolved contact     -> Person (phones + emails), linked to the Organization
  * the property         -> Deal (title = address + APN), linked to Person + Org
  * the call itself       -> a DONE call Activity (disposition + score + transcript + recording)
  * a WARM outcome        -> an OPEN follow-up Activity (task) assigned to a human  ← the handoff

Every create is idempotent via the crm_links table (local object -> remote id): re-running
never makes a second Org/Person/Deal/Activity, it reuses the one already there.

STUB-SAFE (like imagery/Airtable): with no PIPEDRIVE_API_TOKEN it prints a skip note and
exits 0, so `make refresh` stays green. `--dry-run` shows exactly what it WOULD push
(no token needed) — use it to review the mapping before wiring the real account.

    python sync/pipedrive_sync.py --dry-run            # show the plan, push nothing
    python sync/pipedrive_sync.py --warm-only          # push only warm leads (needs token)
    python sync/pipedrive_sync.py                       # push all completed call outcomes
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import cursor  # noqa: E402
from outreach.call_provider import WARM  # noqa: E402

ORG_TYPES = {"llc", "corporation", "corp", "trust", "partnership", "company", "entity"}


# --------------------------------------------------------------------------- pure builders
def is_org(entity_type: str | None) -> bool:
    """Org-shaped owners get an Organization; individuals are just a Person."""
    return (entity_type or "").strip().lower() not in ("individual", "person", "")


def build_org_payload(row: dict) -> dict:
    p = {"name": row["name_raw"]}
    if row.get("mailing_address"):
        p["address"] = row["mailing_address"]
    return p


def build_person_payload(row: dict, org_id: str | None) -> dict:
    name = row.get("person_name") or row["name_raw"]
    p: dict = {"name": name}
    phones = row.get("phones") or []
    emails = row.get("emails") or []
    if phones:
        p["phone"] = [{"value": v, "primary": i == 0, "label": "mobile"}
                      for i, v in enumerate(phones)]
    if emails:
        p["email"] = [{"value": v, "primary": i == 0, "label": "work"}
                      for i, v in enumerate(emails)]
    if org_id:
        p["org_id"] = org_id
    return p


def build_deal_payload(row: dict, person_id: str | None, org_id: str | None) -> dict:
    title = f"{row.get('situs_address') or 'property'} ({row['apn']})"
    p: dict = {"title": title}
    if person_id:
        p["person_id"] = person_id
    if org_id:
        p["org_id"] = org_id
    return p


def _context_lines(row: dict) -> list[str]:
    sf = row.get("building_sf")
    out = [f"Score: {float(row['score']):.0f}/100" if row.get("score") is not None else None,
           f"Grade: {row['grade_human']}" if row.get("grade_human") else None,
           f"Building: {float(sf):,.0f} SF" if sf is not None else None,
           f"Year built: {row['year_built']}" if row.get("year_built") else None,
           f"Owner on title: {row['name_raw']}",
           f"Distance to core: {float(row['distance_miles_icbd']):.1f} mi"
           if row.get("distance_miles_icbd") is not None else None]
    return [x for x in out if x]


def build_call_activity_payload(row: dict, deal_id: str | None, person_id: str | None) -> dict:
    note_lines = _context_lines(row)
    if row.get("recording_url"):
        note_lines.append(f"Recording: {row['recording_url']}")
    if row.get("transcript"):
        note_lines.append("")
        note_lines.append(f"Transcript: {row['transcript']}")
    p: dict = {
        "subject": f"AI call — {row['disposition'].replace('_', ' ')} — "
                   f"{(row.get('person_name') or row['name_raw'])[:40]}",
        "type": "call",
        "done": 1,
        "note": "<br>".join(note_lines),
    }
    if row.get("occurred_at"):
        p["due_date"] = row["occurred_at"].isoformat() if hasattr(
            row["occurred_at"], "isoformat") else str(row["occurred_at"])
    if deal_id:
        p["deal_id"] = deal_id
    if person_id:
        p["person_id"] = person_id
    return p


def build_followup_payload(row: dict, deal_id: str | None, person_id: str | None,
                           user_id: str | None, due: date) -> dict:
    """OPEN task assigned to a human — this IS the warm-lead handoff inside the CRM."""
    p: dict = {
        "subject": f"☎️ FOLLOW UP (warm) — {(row.get('person_name') or row['name_raw'])[:40]}",
        "type": "call",
        "done": 0,
        "due_date": due.isoformat(),
        "note": f"Warm AI call ({row['disposition'].replace('_', ' ')}). "
                f"Owner engaged — call back. " + " · ".join(_context_lines(row)),
    }
    if user_id:
        p["user_id"] = int(user_id) if str(user_id).isdigit() else user_id
    if deal_id:
        p["deal_id"] = deal_id
    if person_id:
        p["person_id"] = person_id
    return p


# --------------------------------------------------------------------------- crm_links (idempotency)
def link_get(cur, obj_type: str, local_key) -> str | None:
    cur.execute("SELECT remote_id FROM crm_links WHERE crm='pipedrive' "
                "AND object_type=%s AND local_key=%s", (obj_type, str(local_key)))
    r = cur.fetchone()
    return r[0] if r else None


def link_set(cur, obj_type: str, local_key, remote_id) -> None:
    cur.execute(
        "INSERT INTO crm_links (crm, object_type, local_key, remote_id) "
        "VALUES ('pipedrive', %s, %s, %s) "
        "ON CONFLICT (crm, object_type, local_key) "
        "DO UPDATE SET remote_id=EXCLUDED.remote_id, synced_at=now()",
        (obj_type, str(local_key), str(remote_id)))


# --------------------------------------------------------------------------- HTTP clients
class DryRunClient:
    """Prints what would be created and returns synthetic ids — no token, no network."""
    name = "dry-run"

    def __init__(self):
        self._n = 0

    def create(self, resource: str, payload: dict) -> str:
        self._n += 1
        rid = f"dry-{resource}-{self._n}"
        label = payload.get("name") or payload.get("title") or payload.get("subject") or ""
        print(f"    + {resource:13} {rid:16} {label[:60]}")
        return rid


class Pipedrive:
    """Thin Pipedrive v1 client. Token via query param (Pipedrive's standard auth)."""
    name = "pipedrive"

    def __init__(self, token: str, domain: str):
        import requests  # local import keeps the stub path dependency-free
        self._requests = requests
        self._base = f"https://{domain}.pipedrive.com/api/v1"
        self._params = {"api_token": token}

    def create(self, resource: str, payload: dict) -> str:
        from tenacity import retry, stop_after_attempt, wait_exponential

        @retry(stop=stop_after_attempt(3),
               wait=wait_exponential(multiplier=1, min=1, max=8))
        def _post():
            resp = self._requests.post(f"{self._base}/{resource}",
                                       params=self._params, json=payload, timeout=30)
            resp.raise_for_status()
            return resp.json()
        data = _post()
        if not data.get("success"):
            raise RuntimeError(f"pipedrive {resource} create failed: {data.get('error')}")
        return str(data["data"]["id"])


# --------------------------------------------------------------------------- sync orchestration
SELECT_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (apn) apn, total, grade_human FROM scores
  WHERE version LIKE '%-final' ORDER BY apn, scored_at DESC)
SELECT ol.log_id, ol.apn, ol.disposition, ol.transcript, ol.recording_url,
       ol.duration_seconds, ol.occurred_at,
       c.contact_id, c.person_name, c.phones, c.emails, c.entity_id,
       e.name_raw, e.entity_type, e.mailing_address, e.is_out_of_state,
       p.situs_address, pr.building_sf, pr.year_built, pr.distance_miles_icbd,
       l.total AS score, l.grade_human
FROM outreach_log ol
JOIN contacts c ON c.contact_id = ol.contact_id
JOIN entities e ON e.entity_id = c.entity_id
JOIN parcels p ON p.apn = ol.apn
LEFT JOIN properties pr ON pr.apn = ol.apn
LEFT JOIN latest l ON l.apn = ol.apn
WHERE ol.disposition <> 'pending'
ORDER BY l.total DESC NULLS LAST, ol.log_id
"""


def sync_row(cur, client, row: dict, user_id: str | None, followup_days: int) -> dict:
    """Push one completed call. Returns which objects were created (vs reused)."""
    made = {"org": False, "person": False, "deal": False, "activity": False, "followup": False}

    org_id = None
    if is_org(row["entity_type"]):
        org_id = link_get(cur, "organization", row["entity_id"])
        if not org_id:
            org_id = client.create("organizations", build_org_payload(row))
            link_set(cur, "organization", row["entity_id"], org_id)
            made["org"] = True

    person_id = link_get(cur, "person", row["contact_id"])
    if not person_id:
        person_id = client.create("persons", build_person_payload(row, org_id))
        link_set(cur, "person", row["contact_id"], person_id)
        made["person"] = True

    deal_id = link_get(cur, "deal", row["apn"])
    if not deal_id:
        deal_id = client.create("deals", build_deal_payload(row, person_id, org_id))
        link_set(cur, "deal", row["apn"], deal_id)
        made["deal"] = True

    # Call activity — one per outreach_log row (idempotent by log_id).
    if not link_get(cur, "activity", row["log_id"]):
        act_id = client.create("activities",
                               build_call_activity_payload(row, deal_id, person_id))
        link_set(cur, "activity", row["log_id"], act_id)
        made["activity"] = True

    # Warm -> open follow-up task for a human (keyed separately so it coexists with the call).
    if row["disposition"] in WARM and not link_get(cur, "activity", f"{row['log_id']}-followup"):
        due = date.today() + timedelta(days=followup_days)
        fu_id = client.create("activities",
                              build_followup_payload(row, deal_id, person_id, user_id, due))
        link_set(cur, "activity", f"{row['log_id']}-followup", fu_id)
        made["followup"] = True
    return made


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--warm-only", action="store_true",
                    help="push only warm leads (conversation/meeting_set)")
    ap.add_argument("--dry-run", action="store_true",
                    help="show what would be pushed; no token / network needed")
    ap.add_argument("--max", type=int, default=None)
    args = ap.parse_args()

    token = os.environ.get("PIPEDRIVE_API_TOKEN")
    domain = os.environ.get("PIPEDRIVE_DOMAIN")
    user_id = os.environ.get("PIPEDRIVE_USER_ID")           # warm-task assignee
    followup_days = int(os.environ.get("PIPEDRIVE_FOLLOWUP_DAYS", "1"))

    if args.dry_run:
        client = DryRunClient()
        print("  pipedrive_sync: DRY RUN — showing the plan, pushing nothing")
    elif not (token and domain):
        print("  pipedrive_sync: PIPEDRIVE_API_TOKEN/PIPEDRIVE_DOMAIN not set — skipping "
              "(stub). Set them in .env to push. `--dry-run` shows the plan without a token.")
        return 0
    else:
        client = Pipedrive(token, domain)

    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(SELECT_SQL)
        rows = cur.fetchall()
    if args.warm_only:
        rows = [r for r in rows if r["disposition"] in WARM]
    if args.max is not None:
        rows = rows[: args.max]
    print(f"  completed calls to sync: {len(rows)}"
          + (" (warm only)" if args.warm_only else ""))

    totals = {"org": 0, "person": 0, "deal": 0, "activity": 0, "followup": 0}
    # Dry-run reads links but must not persist; real run commits its crm_links.
    with cursor(commit=not args.dry_run) as cur:
        for r in rows:
            made = sync_row(cur, client, r, user_id, followup_days)
            for k, v in made.items():
                totals[k] += int(v)
        if args.dry_run:
            cur.connection.rollback()
    print(f"  created → orgs={totals['org']} persons={totals['person']} deals={totals['deal']} "
          f"activities={totals['activity']} follow-ups={totals['followup']} "
          f"(existing objects were reused, not duplicated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
