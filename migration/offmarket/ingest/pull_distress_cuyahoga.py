#!/usr/bin/env python3
"""
pull_distress_cuyahoga.py — Cuyahoga distress feeds -> distress_signals + tax file.

  Native tax delinquency (parcel layer total_net_delq_balance) ──> staging_tax_delinquency
  City of Cleveland Code-Enforcement Notices (PARCEL_NUMBER)   ──> type='code_violation'
  City of Cleveland Building Permits (PARCEL_NUMBER)           ──> type='permit_anomaly'
                                                                  (no_permits_10yr_pre1985)

Three things make Cuyahoga richer than the other markets:
  * Tax delinquency is in the COUNTY parcel layer itself — no founder Trustee CSV. We land
    one staging_tax_delinquency row per parcel with an unpaid balance. We only know there IS
    a balance, not how many years, so years_delinquent=1 (the honest floor: presence => >=1yr;
    score.py's tax CTE then scores it the "one_year" tier). amount_owed carries the dollars.
  * Code-enforcement + permits join on the parcel PIN (PARCEL_NUMBER = parcelpin), like
    Charlotte — a clean key join, not a spatial/address match.
  * The permit feed runs ~2015->present (~11yr), so the 10yr no-permit window is real here
    (unlike Nashville's ~3yr feed). Absence flags are recomputed + stale ones deleted each run.

CAVEAT (geographic): the parcel layer is COUNTYWIDE but the Accela violation/permit feeds are
CITY OF CLEVELAND only — suburban-Cuyahoga industrial parcels get parcel + tax-delinquency
distress but no violation/permit signal until per-suburb feeds are added. See DATA_NOTES_CUYAHOGA.md.

Run AFTER build_universe (permit anomalies are derived over the gated set).

    MARKET=cuyahoga python ingest/pull_distress_cuyahoga.py
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import sources  # noqa: E402


from lib.ingest_base import ms_to_date as _ms_to_date  # shared coercer (HEALTH_AUDIT §C1)


def our_apns() -> list[str]:
    with cursor(commit=False) as cur:
        cur.execute("SELECT apn FROM parcels")
        return [r[0] for r in cur.fetchall()]


# --------------------------------------------------------------------------- #
# Native tax delinquency (from the parcel layer) -> staging_tax_delinquency
# --------------------------------------------------------------------------- #
def load_tax_delinquency() -> int:
    """One row per parcel with total_net_delq_balance > 0. score.py's tax CTE reads
    this table exactly as it reads a founder Trustee CSV — no scoring change needed."""
    src = sources()["parcels"]
    with cursor() as cur:
        cur.execute("TRUNCATE staging_tax_delinquency")
        cur.execute(
            """
            INSERT INTO staging_tax_delinquency
              (apn_raw, apn_norm, owner_name, amount_owed, years_delinquent,
               tax_years, source_file, raw)
            SELECT s.apn, s.apn, s.owner,
                   (s.raw->>'total_net_delq_balance')::numeric,
                   1,                              -- presence => >=1yr; exact count not in feed
                   NULL,
                   %s,
                   jsonb_build_object('total_net_delq_balance',
                                      s.raw->>'total_net_delq_balance')
            FROM staging_parcels s
            WHERE COALESCE((s.raw->>'total_net_delq_balance')::numeric, 0) > 0
            """,
            (src + "#total_net_delq_balance",),
        )
        n = cur.rowcount
    print(f"  tax-delinquency rows (balance > 0): {n}")
    return n


# --------------------------------------------------------------------------- #
# Code enforcement -> code_violation signals
# --------------------------------------------------------------------------- #
def pull_code_enforcement(apns: list[str], job: JobRun) -> int:
    url = sources()["violations"]
    fields = "OBJECTID,PARCEL_NUMBER,FILE_DATE,SOURCE,VIOLATION_APP_STATUS,VIOLATION_NUMBER"
    src_base = url + "#viol="
    rows: dict[str, tuple] = {}      # source_ref -> signal row (dedupe)
    for feat in arcgis.query_by_in(
        url, "PARCEL_NUMBER", apns, out_fields=fields, batch=200, page_size=2000,
    ):
        a = feat.get("attributes", {})
        apn = a.get("PARCEL_NUMBER")
        ref_id = a.get("VIOLATION_NUMBER") or a.get("OBJECTID")
        if not apn or ref_id is None:
            job.fail("violation missing PARCEL_NUMBER/id", ref=str(ref_id))
            continue
        when = _ms_to_date(a.get("FILE_DATE"))
        vnum = a.get("VIOLATION_NUMBER")
        detail = f"{a.get('SOURCE') or 'code enforcement'} ({a.get('VIOLATION_APP_STATUS')})"
        if vnum:
            detail += f": {vnum}"
        src_ref = src_base + str(ref_id)
        rows[src_ref] = (apn, "code_violation", detail, when, src_ref)
        job.ok()
    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO distress_signals (apn, type, detail, event_date, source_ref)
            VALUES %s
            ON CONFLICT (apn, type, source_ref) DO UPDATE SET
              detail = EXCLUDED.detail, event_date = EXCLUDED.event_date
            """,
            list(rows.values()), page_size=500,
        )
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT count(DISTINCT apn) AS p FROM distress_signals "
                    "WHERE type='code_violation'")
        n_parcels = cur.fetchone()["p"]
    print(f"  code_violation signals: {len(rows)} cases on {n_parcels} of our parcels")
    return len(rows)


# --------------------------------------------------------------------------- #
# Permits -> staging + no_permits_10yr_pre1985 anomaly (over gated parcels)
# --------------------------------------------------------------------------- #
def fetch_permits(apns: list[str], job: JobRun) -> date | None:
    url = sources()["permits"]
    fields = "OBJECTID,PARCEL_NUMBER,PERMIT_TYPE,ISSUE_DATE,CURRENT_TASK_STATUS"
    by_key: dict[tuple, tuple] = {}
    min_issued = None
    for feat in arcgis.query_by_in(
        url, "PARCEL_NUMBER", apns, out_fields=fields, batch=200, page_size=2000,
    ):
        a = feat.get("attributes", {})
        oid, apn = a.get("OBJECTID"), a.get("PARCEL_NUMBER")
        if oid is None or not apn:
            job.fail("permit row missing OBJECTID/PARCEL_NUMBER", ref=apn)
            continue
        issued = _ms_to_date(a.get("ISSUE_DATE"))
        if issued and (min_issued is None or issued < min_issued):
            min_issued = issued
        by_key[(str(oid), apn)] = (
            str(oid), apn, a.get("PERMIT_TYPE"),
            None, issued, None,                     # date_entered, date_issued, const_cost
            None, a.get("CURRENT_TASK_STATUS"), json.dumps(a),  # address, purpose(=status), raw
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
              purpose = EXCLUDED.purpose, raw = EXCLUDED.raw, loaded_at = now()
            """,
            rows, page_size=500,
        )
    print(f"  permits staged: {len(rows)} (feed coverage back to {min_issued or 'n/a'})")
    return min_issued


def derive_anomalies(min_issued: date | None) -> None:
    """Recompute no_permits_10yr_pre1985 over gated parcels; delete stale flags."""
    today = date.today()
    ten_years_ago = today.replace(year=today.year - 10)
    if min_issued and min_issued > ten_years_ago:
        window_desc = (f"no permits since feed start {min_issued.isoformat()} "
                       f"(feed shallower than 10yr spec — weaker evidence)")
    else:
        window_desc = f"no permits issued since {ten_years_ago.isoformat()}"
    source_ref = sources()["permits"] + "#derived-no-permits-10yr"

    with cursor() as cur:
        cur.execute(
            """
            SELECT p.apn, pr.year_built
            FROM parcels p JOIN properties pr USING (apn)
            WHERE (p.in_universe OR p.manual_review)
              AND pr.year_built IS NOT NULL AND pr.year_built < 1985
              AND NOT EXISTS (
                SELECT 1 FROM staging_permits sp
                WHERE sp.apn = p.apn AND sp.date_issued >= %s)
            """,
            (ten_years_ago,),
        )
        qualifying = cur.fetchall()
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


def main() -> int:
    print("pull_distress_cuyahoga: tax delinquency + code enforcement + permits ...")
    apns = our_apns()
    if not apns:
        raise RuntimeError("parcels table is empty — run pull_parcels_cuyahoga first")
    with JobRun("load_tax_delinquency_cuyahoga") as job:
        job.ok(load_tax_delinquency())
    with JobRun("pull_code_enforcement_cuyahoga") as job:
        pull_code_enforcement(apns, job)
    with JobRun("pull_permits_cuyahoga") as job:
        min_issued = fetch_permits(apns, job)
        derive_anomalies(min_issued)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
