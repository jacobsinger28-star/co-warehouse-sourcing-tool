#!/usr/bin/env python3
"""
pull_permits.py — building permits for our parcels + permit-anomaly derivation (Day 4).

Source: Building Permits Issued ArcGIS feature service (NOT Socrata; see DATA_NOTES.md).
Join key: the feed's `Parcel` field == our APN format (verified).

Two permit_anomaly sub-signals were specced in weights.yaml:
  * lapsed_or_expired_permit — NOT derivable from this feed (no finaled/expired
    status column). Documented in DATA_NOTES.md; the rule simply never fires at MVP.
  * no_permits_10yr_pre1985 — derived here: pre-1985 building (CAMA YearBuilt) with
    zero issued permits in the last 10 years -> zero capital investment signal.

Absence-derived signals go stale (a parcel that later pulls a permit must lose the
flag), so qualifying rows are recomputed and non-qualifying rows DELETED each run.
Derivation is limited to gated parcels (in_universe or manual_review) — an absence
flag on a parcel we'll never score is noise.

The feed's history depth is measured and stamped into every detail string: if
coverage is shallower than 10 years, "no permits in 10yr" weakens to "no permits
in feed coverage" and the detail says so explicitly (store evidence, not conclusions).

    python ingest/pull_permits.py
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
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


def fetch(apns: list[str], job: JobRun) -> tuple[int, date | None]:
    fields = ("Permit__,Parcel,Permit_Type_Description,Date_Entered,Date_Issued,"
              "Const_Cost,Address,Purpose")
    # The feed contains literal duplicate rows for one (permit, parcel); a single
    # upsert statement can't touch the same key twice -> dedupe here, keep last.
    by_key: dict[tuple, tuple] = {}
    min_issued = None
    for feat in arcgis.query_by_in(
        S.BUILDING_PERMITS_ISSUED, "Parcel", apns,
        out_fields=fields, batch=400, page_size=1000,
    ):
        a = feat.get("attributes", {})
        if not a.get("Permit__") or not a.get("Parcel"):
            job.fail("permit row missing Permit__/Parcel", ref=a.get("Address"))
            continue
        issued = _ms_to_date(a.get("Date_Issued"))
        if issued and (min_issued is None or issued < min_issued):
            min_issued = issued
        by_key[(a["Permit__"], a["Parcel"])] = (
            a["Permit__"], a["Parcel"], a.get("Permit_Type_Description"),
            _ms_to_date(a.get("Date_Entered")), issued,
            a.get("Const_Cost"), a.get("Address"), a.get("Purpose"), json.dumps(a),
        )
        job.ok()
    rows = list(by_key.values())
    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO staging_permits
              (permit_nbr, apn, permit_type, date_entered, date_issued,
               const_cost, address, purpose, raw)
            VALUES %s
            ON CONFLICT (permit_nbr, apn) DO UPDATE SET
              permit_type = EXCLUDED.permit_type, date_issued = EXCLUDED.date_issued,
              const_cost = EXCLUDED.const_cost, purpose = EXCLUDED.purpose,
              raw = EXCLUDED.raw, loaded_at = now()
            """,
            rows, page_size=500,
        )
    print(f"  permits staged: {len(rows)} "
          f"(feed coverage back to {min_issued or 'n/a'})")
    return len(rows), min_issued


def derive_anomalies(min_issued: date | None) -> None:
    """Recompute no_permits_10yr_pre1985 over gated parcels; delete stale flags."""
    today = date.today()
    ten_years_ago = today.replace(year=today.year - 10)
    # If the feed doesn't reach back 10 years, say exactly what we CAN claim.
    if min_issued and min_issued > ten_years_ago:
        window_desc = (f"no permits since feed start {min_issued.isoformat()} "
                       f"(feed shallower than the 10yr spec — weaker evidence)")
    else:
        window_desc = f"no permits issued since {ten_years_ago.isoformat()}"
    source_ref = S.BUILDING_PERMITS_ISSUED + "#derived-no-permits-10yr"

    with cursor() as cur:
        # Qualifying set: gated, pre-1985, no permit in the window.
        cur.execute(
            """
            SELECT p.apn, pr.year_built
            FROM parcels p
            JOIN properties pr USING (apn)
            WHERE (p.in_universe OR p.manual_review)
              AND pr.year_built IS NOT NULL AND pr.year_built < 1985
              AND NOT EXISTS (
                SELECT 1 FROM staging_permits sp
                WHERE sp.apn = p.apn AND sp.date_issued >= %s)
            """,
            (ten_years_ago,),
        )
        qualifying = cur.fetchall()

        # Stale flags out (parcel got a permit / left the gated set), current in.
        cur.execute(
            "DELETE FROM distress_signals WHERE type='permit_anomaly' "
            "AND source_ref = %s AND apn <> ALL(%s)",
            (source_ref, [q[0] for q in qualifying] or [""]),
        )
        n_del = cur.rowcount
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO distress_signals (apn, type, detail, event_date, source_ref)
            VALUES %s
            ON CONFLICT (apn, type, source_ref) DO UPDATE SET detail = EXCLUDED.detail
            """,
            [(apn, "permit_anomaly",
              f"no_permits_10yr_pre1985: built {yb}, {window_desc}",
              None, source_ref) for apn, yb in qualifying],
            page_size=500,
        )
    print(f"  permit_anomaly signals: {len(qualifying)} current, {n_del} stale removed")


def qa() -> None:
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            """
            SELECT count(*) AS staged, count(DISTINCT apn) AS parcels,
                   min(date_issued) AS oldest, max(date_issued) AS newest
            FROM staging_permits
            """
        )
        r = cur.fetchone()
        print(f"  QA: {r['staged']} permits on {r['parcels']} parcels, "
              f"{r['oldest']} -> {r['newest']}")
        cur.execute(
            """
            SELECT d.apn, left(d.detail, 70) AS detail
            FROM distress_signals d JOIN parcels p ON p.apn=d.apn
            WHERE d.type='permit_anomaly' AND p.in_universe LIMIT 3
            """
        )
        for row in cur.fetchall():
            print(f"    {row['apn']} {row['detail']}")


def main() -> int:
    print("pull_permits: fetching Building Permits Issued ...")
    with JobRun("pull_permits") as job:
        apns = our_apns()
        if not apns:
            raise RuntimeError("parcels table is empty — run pull_parcels first")
        _, min_issued = fetch(apns, job)
        derive_anomalies(min_issued)
        qa()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
