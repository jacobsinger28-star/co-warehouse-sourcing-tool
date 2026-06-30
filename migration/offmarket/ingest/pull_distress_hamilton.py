#!/usr/bin/env python3
"""
pull_distress_hamilton.py — Hamilton County / Cincinnati distress feeds -> distress_signals + tax.

  Native tax delinquency (parcel layer DELQ_TAXES)            ──> staging_tax_delinquency
  City of Cincinnati PMCE "Building Enforcement" (POINT layer) ──> type='code_violation' (SPATIAL)

Two notes specific to Hamilton:
  * Tax delinquency is in the COUNTY parcel layer (DELQ_TAXES) — no founder Trustee CSV. One
    staging_tax_delinquency row per parcel with DELQ_TAXES > 0 (presence => years_delinquent=1,
    the honest floor; score.py's tax CTE then scores it). amount_owed carries the dollars.
  * Code enforcement has NO parcel key, so the join is SPATIAL (ST_Contains(parcel, case_point)),
    the same technique pull_parcels_hamilton uses for the footprint proxy. The PMCE feed carries
    full history; we take ~30 months for the 24-month scoring window plus boundary buffer.

NO permit pull: year_built is unavailable in Hamilton's open feeds (-> NULL), so the
no_permits_10yr_pre1985 anomaly can't fire, and the city "New Building Permits" feed is a thin
5-year snapshot. Add permits + year_built together when the Auditor bulk CAMA is wired (see yaml).

CAVEAT (geographic): parcels are COUNTYWIDE but PMCE code-enforcement is CITY OF CINCINNATI only —
suburban-Hamilton industrial gets parcel + tax-delinquency distress but no code-violation signal.

Run AFTER build_universe (parity with the other markets).

    MARKET=hamilton python ingest/pull_distress_hamilton.py
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import sources  # noqa: E402

LOOKBACK_MONTHS = 30
PAGE = 2000


from lib.ingest_base import ms_to_date as _ms_to_date  # shared coercer (HEALTH_AUDIT §C1)


def _cutoff(months: int) -> date:
    t = date.today()
    total = t.year * 12 + (t.month - 1) - months
    return date(total // 12, total % 12 + 1, 1)


# --------------------------------------------------------------------------- #
# Native tax delinquency (from the parcel layer) -> staging_tax_delinquency
# --------------------------------------------------------------------------- #
def load_tax_delinquency() -> int:
    src = sources()["parcels"]
    with cursor() as cur:
        cur.execute("TRUNCATE staging_tax_delinquency")
        cur.execute(
            """
            INSERT INTO staging_tax_delinquency
              (apn_raw, apn_norm, owner_name, amount_owed, years_delinquent,
               tax_years, source_file, raw)
            SELECT s.apn, s.apn, s.owner,
                   (s.raw->>'DELQ_TAXES')::numeric,
                   1,                              -- presence => >=1yr; exact count not in feed
                   NULL,
                   %s,
                   jsonb_build_object('DELQ_TAXES', s.raw->>'DELQ_TAXES',
                                      'FORECL_FLAG', s.raw->>'FORECL_FLAG')
            FROM staging_parcels s
            WHERE COALESCE((s.raw->>'DELQ_TAXES')::numeric, 0) > 0
            """,
            (src + "#DELQ_TAXES",),
        )
        n = cur.rowcount
    print(f"  tax-delinquency rows (DELQ_TAXES > 0): {n}")
    return n


# --------------------------------------------------------------------------- #
# Code enforcement -> code_violation signals (SPATIAL point-in-parcel)
# --------------------------------------------------------------------------- #
def _detail(a: dict) -> str:
    parts = [a.get("COMP_TYPE_DESC")]
    sub = a.get("SUB_TYPE_DESC")
    if sub and sub.strip() and sub.strip().upper() not in ("NA", "GENERAL"):
        parts.append(sub)
    label = " / ".join(p.strip() for p in parts if p and p.strip())
    status = (a.get("DATA_STATUS_DISPLAY") or "").strip()
    return f"{label} ({status})" if status else (label or "code enforcement case")


def fetch_code_enforcement(job: JobRun) -> tuple[int, int]:
    url = sources()["violations"]
    cutoff = _cutoff(LOOKBACK_MONTHS)
    fields = "OBJECTID,COMP_TYPE_DESC,SUB_TYPE_DESC,DATA_STATUS_DISPLAY,ENTERED_DATE"
    ref_base = url + "#case="

    with cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS staging_code_cases")
        cur.execute("""
            CREATE TABLE staging_code_cases (
              objectid   bigint PRIMARY KEY,
              geom       geometry(Point, 4326),
              detail     text,
              event_date date,
              source_ref text
            )
        """)

    INS = ("INSERT INTO staging_code_cases (objectid, geom, detail, event_date, source_ref) "
           "VALUES %s ON CONFLICT (objectid) DO NOTHING")
    TMPL = "(%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), %s, %s, %s)"

    def _flush(rows):
        if not rows:
            return 0
        with cursor() as cur:
            psycopg2.extras.execute_values(cur, INS, rows, template=TMPL, page_size=1000)
        return len(rows)

    buf, staged = [], 0
    for feat in arcgis.query(
        url, where=f"ENTERED_DATE >= DATE '{cutoff.isoformat()}'", out_fields=fields,
        return_geometry=True, out_sr=4326, order_by="OBJECTID", page_size=PAGE,
    ):
        a = feat.get("attributes", {})
        g = feat.get("geometry") or {}
        oid, x, y = a.get("OBJECTID"), g.get("x"), g.get("y")
        if oid is None or x is None or y is None:
            job.fail("code case missing OBJECTID/geometry", ref=str(oid))
            continue
        buf.append((oid, x, y, _detail(a), _ms_to_date(a.get("ENTERED_DATE")),
                    ref_base + str(oid)))
        job.ok()
        if len(buf) >= PAGE:
            staged += _flush(buf); buf = []
    staged += _flush(buf)

    with cursor() as cur:
        cur.execute("CREATE INDEX ON staging_code_cases USING GIST (geom)")
        cur.execute("CREATE INDEX IF NOT EXISTS parcels_geom_gix ON parcels USING GIST (geom)")
        cur.execute("ANALYZE staging_code_cases")
        cur.execute(
            """
            INSERT INTO distress_signals (apn, type, detail, event_date, source_ref)
            SELECT DISTINCT ON (p.apn, sc.source_ref)
                   p.apn, 'code_violation', sc.detail, sc.event_date, sc.source_ref
            FROM staging_code_cases sc
            JOIN parcels p ON ST_Contains(p.geom, sc.geom)
            WHERE sc.source_ref IS NOT NULL
            ORDER BY p.apn, sc.source_ref, sc.event_date DESC NULLS LAST
            ON CONFLICT (apn, type, source_ref) DO UPDATE SET
              detail = EXCLUDED.detail, event_date = EXCLUDED.event_date
            """
        )
        n_signals = cur.rowcount
        cur.execute("DROP TABLE IF EXISTS staging_code_cases")
        cur.execute("SELECT count(DISTINCT apn) FROM distress_signals WHERE type='code_violation'")
        n_parcels = cur.fetchone()[0]

    print(f"  swept {staged} code-enforcement cases since {cutoff.isoformat()}; "
          f"{n_signals} landed on {n_parcels} of our parcels")
    return n_signals, n_parcels


def main() -> int:
    print("pull_distress_hamilton: tax delinquency + code enforcement (spatial join) ...")
    with cursor(commit=False) as cur:
        cur.execute("SELECT count(*) FROM parcels")
        if cur.fetchone()[0] == 0:
            raise RuntimeError("parcels table is empty — run pull_parcels_hamilton first")
    with JobRun("load_tax_delinquency_hamilton") as job:
        job.ok(load_tax_delinquency())
    with JobRun("pull_code_enforcement_hamilton") as job:
        fetch_code_enforcement(job)
        print(f"  code job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
