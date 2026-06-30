#!/usr/bin/env python3
"""
pull_violations.py — code-enforcement violations for our parcels (Day 4).

Source: Property Standards Violations ArcGIS feature service (NOT Socrata — the
portal migrated; see DATA_NOTES.md). Joined on Property_APN, which matches the
parcel APN format exactly (verified 2026-06-11), so no address fallback needed.

  ArcGIS (by APN batch) -> staging_violations -> distress_signals type='code_violation'

Every signal row carries source_ref = dataset URL + Request # (hard requirement:
no unsourced signals, enforced by NOT NULL + the unique index). Idempotent.

    python ingest/pull_violations.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis, sources as S  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402


def _ms_to_date(ms):
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date()
    except (TypeError, ValueError, OSError):
        return None


def our_apns() -> list[str]:
    with cursor(commit=False) as cur:
        cur.execute("SELECT apn FROM parcels")
        return [r[0] for r in cur.fetchall()]


def fetch(apns: list[str], job: JobRun) -> int:
    fields = ("Request_Nbr,Property_APN,Property_Address,Date_Received,"
              "Reported_Problem,Status,Last_Activity_Date,Last_Act__Result,"
              "Violations_Noted,Property_Owner")
    # Dedupe on the upsert key — the AGOL feeds can return literal duplicate rows
    # (hit on permits), and one statement can't update the same key twice.
    by_key: dict[str, tuple] = {}
    for feat in arcgis.query_by_in(
        S.PROPERTY_STANDARDS_VIOLATIONS, "Property_APN", apns,
        out_fields=fields, batch=400, page_size=1000,
    ):
        a = feat.get("attributes", {})
        if not a.get("Request_Nbr"):
            job.fail("violation row without Request_Nbr", ref=a.get("Property_APN"))
            continue
        by_key[a["Request_Nbr"]] = (
            a["Request_Nbr"], a.get("Property_APN"), a.get("Property_Address"),
            _ms_to_date(a.get("Date_Received")), a.get("Reported_Problem"),
            a.get("Status"), _ms_to_date(a.get("Last_Activity_Date")),
            a.get("Last_Act__Result"), a.get("Violations_Noted"),
            a.get("Property_Owner"), json.dumps(a),
        )
        job.ok()
    rows = list(by_key.values())
    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO staging_violations
              (request_nbr, apn, prop_address, date_received, reported_problem,
               status, last_activity_date, last_activity_result, violations_noted,
               property_owner, raw)
            VALUES %s
            ON CONFLICT (request_nbr) DO UPDATE SET
              status = EXCLUDED.status,
              last_activity_date = EXCLUDED.last_activity_date,
              last_activity_result = EXCLUDED.last_activity_result,
              violations_noted = EXCLUDED.violations_noted,
              raw = EXCLUDED.raw, loaded_at = now()
            """,
            rows, page_size=500,
        )
    print(f"  violations staged: {len(rows)}")
    return len(rows)


def promote() -> None:
    """staging -> distress_signals. source_ref = layer URL + request number."""
    with cursor() as cur:
        cur.execute(
            """
            INSERT INTO distress_signals (apn, type, detail, event_date, source_ref)
            SELECT s.apn, 'code_violation',
                   left(concat_ws(' | ',
                        nullif(s.reported_problem, ''),
                        nullif('noted: ' || s.violations_noted, 'noted: '),
                        nullif('status: ' || s.status, 'status: ')), 800),
                   s.date_received,
                   %s || '#' || s.request_nbr
            FROM staging_violations s
            JOIN parcels p ON p.apn = s.apn
            ON CONFLICT (apn, type, source_ref) DO UPDATE SET
              detail = EXCLUDED.detail, event_date = EXCLUDED.event_date
            """,
            (S.PROPERTY_STANDARDS_VIOLATIONS,),
        )
        n = cur.rowcount
    print(f"  distress_signals (code_violation) upserted: {n}")


def qa() -> None:
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            """
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE event_date >= now() - interval '24 months') AS last_24mo,
                   count(DISTINCT apn) AS parcels
            FROM distress_signals WHERE type = 'code_violation'
            """
        )
        r = cur.fetchone()
        print(f"  QA: {r['total']} violation signals on {r['parcels']} parcels "
              f"({r['last_24mo']} within 24mo scoring window)")
        cur.execute(
            """
            SELECT d.apn, d.event_date, left(d.detail, 70) AS detail
            FROM distress_signals d JOIN parcels p ON p.apn = d.apn
            WHERE d.type='code_violation' AND p.in_universe
            ORDER BY d.event_date DESC NULLS LAST LIMIT 5
            """
        )
        print("  sample (in-universe, newest — hand-check these per QA #5):")
        for row in cur.fetchall():
            print(f"    {row['apn']} {row['event_date']} {row['detail']}")


def main() -> int:
    print("pull_violations: fetching Property Standards Violations ...")
    with JobRun("pull_violations") as job:
        apns = our_apns()
        if not apns:
            raise RuntimeError("parcels table is empty — run pull_parcels first")
        fetch(apns, job)
        promote()
        qa()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
