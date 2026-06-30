#!/usr/bin/env python3
"""
pull_distress_charlotte.py — Charlotte distress feeds -> distress_signals.

  City of Charlotte HNS Code Enforcement (ParcelId) ──> type='code_violation'
  Mecklenburg Building Permits (parcelnum)          ──> type='permit_anomaly'
                                                        (no_permits_10yr_pre1985)

Writes the SAME distress_signals shape scoring/score.py reads:
  * code_violation rows carry event_date (DateCreated) so the 24-month window counts them.
    NOTE: the HNS feed is a rolling ~8-week window (DATA_NOTES_CHARLOTTE.md) — these are
    strong CURRENT signals; multi-year history must be accumulated by the weekly cron.
  * permit_anomaly 'no_permits_10yr_pre1985' over gated parcels (built <1985, no permit in
    10yr). Mecklenburg permits go back ~36yr, so the 10yr window is real here (unlike
    Nashville's ~3yr feed). Absence flags are recomputed + stale ones deleted each run.

Run AFTER build_universe (permit anomalies are derived over the gated set).

    MARKET=charlotte python ingest/pull_distress_charlotte.py
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
# Code enforcement -> code_violation signals
# --------------------------------------------------------------------------- #
def pull_code_enforcement(apns: list[str], job: JobRun) -> int:
    url = sources()["violations"]
    fields = "CaseNumber,ParcelId,CaseType,CaseStatus,DateCreated,DetailedDescription"
    src_base = url + "#case="
    rows: dict[str, tuple] = {}      # source_ref -> signal row (dedupe)
    for feat in arcgis.query_by_in(
        url, "ParcelId", apns, out_fields=fields, batch=300, page_size=2000,
    ):
        a = feat.get("attributes", {})
        apn, case = a.get("ParcelId"), a.get("CaseNumber")
        if not apn or not case:
            job.fail("code case missing ParcelId/CaseNumber", ref=case)
            continue
        when = _ms_to_date(a.get("DateCreated"))
        desc = (a.get("DetailedDescription") or "").strip().replace("\n", " ")[:140]
        detail = f"{a.get('CaseType')} ({a.get('CaseStatus')})"
        if desc:
            detail += f": {desc}"
        rows[src_base + str(case)] = (apn, "code_violation", detail, when, src_base + str(case))
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
    fields = "permitnum,parcelnum,permittype,issuedate,compldate,permitstat,bldgcost"
    by_key: dict[tuple, tuple] = {}
    min_issued = None
    for feat in arcgis.query_by_in(
        url, "parcelnum", apns, out_fields=fields, batch=300, page_size=2000,
    ):
        a = feat.get("attributes", {})
        if not a.get("permitnum") or not a.get("parcelnum"):
            job.fail("permit row missing permitnum/parcelnum", ref=a.get("parcelnum"))
            continue
        issued = _ms_to_date(a.get("issuedate"))
        if issued and (min_issued is None or issued < min_issued):
            min_issued = issued
        by_key[(a["permitnum"], a["parcelnum"])] = (
            a["permitnum"], a["parcelnum"], a.get("permittype"),
            None, issued, a.get("bldgcost"),
            a.get("permitstat"), None, json.dumps(a),
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
              const_cost = EXCLUDED.const_cost, raw = EXCLUDED.raw, loaded_at = now()
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
    print("pull_distress_charlotte: code enforcement + permits ...")
    apns = our_apns()
    if not apns:
        raise RuntimeError("parcels table is empty — run pull_parcels_charlotte first")
    with JobRun("pull_code_enforcement_charlotte") as job:
        pull_code_enforcement(apns, job)
    with JobRun("pull_permits_charlotte") as job:
        min_issued = fetch_permits(apns, job)
        derive_anomalies(min_issued)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
