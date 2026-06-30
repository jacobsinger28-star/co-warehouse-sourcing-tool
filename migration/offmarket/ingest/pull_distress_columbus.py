#!/usr/bin/env python3
"""
pull_distress_columbus.py — Columbus / Franklin County distress feeds -> distress_signals.

  City of Columbus Code Enforcement Cases (BuildingZoning/MapServer/23) ──> type='code_violation'
  City of Columbus Building Permits (Building_Permits/FeatureServer/0)   ──> type='permit_anomaly'
                                                                            (no_permits_10yr_pre1985)

Writes the SAME distress_signals shape scoring/score.py reads: code_violation rows carry
event_date (B1_FILE_DD) so the 24-month window counts them toward `code_violations_24mo`;
permit_anomaly 'no_permits_10yr_pre1985' fires for gated parcels built <1985 with no permit in
the last 10 years. The permit feed goes back to 2010 (verified), so the 10-yr window is REAL
here — unlike Nashville's ~3yr feed (cf. Charlotte, whose feed is deep too).

THE JOIN IS SPATIAL, not by parcel number. Columbus's Accela parcel keys do NOT line up with
the Franklin County auditor PARCELID (permits drop the dash; code-enforcement uses a 14-digit
scheme entirely), so a key join is unreliable. Both feeds are POINT layers, so we sweep them
(server-side date-filtered + outSR=4326) and assign each to the parcel that CONTAINS its point —
the technique pull_parcels_columbus uses for the footprint proxy. Permits are pre-filtered to
NON-residential types server-side (industrial parcels never carry 1-3 Family / Residential
permits) so the 10-yr sweep stays ~137k instead of ~440k.

Unlike Charlotte's ~8-week rolling code feed, Columbus publishes full code history, so a single
pull satisfies the 24-month window (we take ~30 months for boundary buffer).

Run AFTER pull_parcels_columbus + pull_cama_columbus (the no_permits anomaly needs year_built,
which pull_cama_columbus supplies — so it must run before this; see the Makefile columbus target).

    MARKET=columbus python ingest/pull_distress_columbus.py
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

# How far back to pull code-enforcement cases. Scoring only counts the last 24 months; the
# extra buffer keeps cases near the window boundary and gives the dashboard recent history.
LOOKBACK_MONTHS = 30
PAGE = 2000


from lib.ingest_base import ms_to_date as _ms_to_date  # shared coercer (HEALTH_AUDIT §C1)


def _cutoff(months: int) -> date:
    """First of the month, `months` back from today (ISO date for the ArcGIS WHERE)."""
    t = date.today()
    total = t.year * 12 + (t.month - 1) - months
    return date(total // 12, total % 12 + 1, 1)


def _detail(a: dict) -> str:
    """Human case label: '<type> / <sub-type> (<status>)', skipping empty/NA parts."""
    parts = [a.get("B1_PER_TYPE")]
    sub = a.get("B1_PER_SUB_TYPE")
    if sub and sub.upper() not in ("NA", "GENERAL"):
        parts.append(sub)
    label = " / ".join(p.strip() for p in parts if p and p.strip())
    status = (a.get("B1_APPL_STATUS") or "").strip()
    return f"{label} ({status})" if status else (label or "code enforcement case")


def fetch_code_enforcement(job: JobRun) -> tuple[int, int]:
    """Sweep recent code-enforcement points -> staging_code_cases (with point geometry +
    pre-computed detail/event_date/source_ref), then spatially assign to parcels and upsert
    code_violation signals. Returns (cases_landed_on_our_parcels, distinct_parcels)."""
    url = sources()["violations"]
    cutoff = _cutoff(LOOKBACK_MONTHS)
    fields = ("OBJECTID,B1_ALT_ID,B1_PER_TYPE,B1_PER_SUB_TYPE,B1_PER_CATEGORY,"
              "B1_APPL_STATUS,B1_FILE_DD,ACA_URL,SITE_ADDRESS")
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
        url, where=f"B1_FILE_DD >= DATE '{cutoff.isoformat()}'", out_fields=fields,
        return_geometry=True, out_sr=4326, order_by="OBJECTID", page_size=PAGE,
    ):
        a = feat.get("attributes", {})
        g = feat.get("geometry") or {}
        oid, x, y = a.get("OBJECTID"), g.get("x"), g.get("y")
        if oid is None or x is None or y is None:
            job.fail("code case missing OBJECTID/geometry", ref=str(a.get("B1_ALT_ID")))
            continue
        src = a.get("ACA_URL") or (ref_base + str(a.get("B1_ALT_ID")))
        buf.append((oid, x, y, _detail(a), _ms_to_date(a.get("B1_FILE_DD")), src))
        job.ok()
        if len(buf) >= PAGE:
            staged += _flush(buf); buf = []
    staged += _flush(buf)

    with cursor() as cur:
        cur.execute("CREATE INDEX ON staging_code_cases USING GIST (geom)")
        cur.execute("CREATE INDEX IF NOT EXISTS parcels_geom_gix ON parcels USING GIST (geom)")
        cur.execute("ANALYZE staging_code_cases")
        # Assign each case point to the parcel that contains it; DISTINCT ON (apn, source_ref)
        # collapses any duplicate case rows so the ON CONFLICT upsert can't touch one key twice
        # (the Nashville CardinalityViolation lesson).
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


# --------------------------------------------------------------------------- #
# Permits -> staging + no_permits_10yr_pre1985 anomaly (spatial; over gated parcels)
# --------------------------------------------------------------------------- #
PERMIT_LOOKBACK_YEARS = 10


def _years_ago(n: int) -> date:
    t = date.today()
    try:
        return t.replace(year=t.year - n)
    except ValueError:                       # Feb 29 guard
        return t.replace(year=t.year - n, day=28)


def fetch_permits(job: JobRun) -> None:
    """Sweep non-residential permits from the last 10yr (point layer), spatially assign to
    parcels -> staging_permits, then derive no_permits_10yr_pre1985 over gated pre-1985 parcels."""
    url = sources()["permits"]
    cutoff = _years_ago(PERMIT_LOOKBACK_YEARS)
    # Industrial parcels never carry residential permits; excluding them keeps the sweep ~137k.
    where = (f"ISSUED_DT >= DATE '{cutoff.isoformat()}' "
             "AND B1_PER_TYPE NOT LIKE '%Family%' AND B1_PER_TYPE <> 'Residential'")
    fields = "OBJECTID,B1_ALT_ID,B1_PER_TYPE,ISSUED_DT,G3_VALUE_TTL"

    with cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS staging_permit_pts")
        cur.execute("CREATE TABLE staging_permit_pts (objectid bigint PRIMARY KEY, "
                    "geom geometry(Point,4326), alt_id text, issued_ms bigint, ptype text, cost numeric)")

    INS = ("INSERT INTO staging_permit_pts (objectid, geom, alt_id, issued_ms, ptype, cost) "
           "VALUES %s ON CONFLICT (objectid) DO NOTHING")
    TMPL = "(%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), %s, %s, %s, %s)"

    def _flush(rows):
        if not rows:
            return 0
        with cursor() as cur:
            psycopg2.extras.execute_values(cur, INS, rows, template=TMPL, page_size=1000)
        return len(rows)

    buf, staged, min_ms = [], 0, None
    for feat in arcgis.query(url, where=where, out_fields=fields, return_geometry=True,
                             out_sr=4326, order_by="OBJECTID", page_size=PAGE):
        a = feat.get("attributes", {})
        g = feat.get("geometry") or {}
        oid, x, y = a.get("OBJECTID"), g.get("x"), g.get("y")
        if oid is None or x is None or y is None:
            continue
        ms = a.get("ISSUED_DT")
        if ms is not None and (min_ms is None or ms < min_ms):
            min_ms = ms
        buf.append((oid, x, y, a.get("B1_ALT_ID"), ms, a.get("B1_PER_TYPE"), a.get("G3_VALUE_TTL")))
        job.ok()
        if len(buf) >= PAGE:
            staged += _flush(buf); buf = []
    staged += _flush(buf)

    with cursor() as cur:
        cur.execute("CREATE INDEX ON staging_permit_pts USING GIST (geom)")
        cur.execute("ANALYZE staging_permit_pts")
        # Assign each permit to the parcel containing its point -> staging_permits (one row per
        # (permit, parcel); DISTINCT ON collapses dup points so the upsert can't double-touch a key).
        cur.execute("""
            INSERT INTO staging_permits (permit_nbr, apn, permit_type, date_issued, const_cost, raw)
            SELECT DISTINCT ON (pp.alt_id, p.apn)
                   pp.alt_id, p.apn, pp.ptype,
                   CASE WHEN pp.issued_ms IS NOT NULL THEN to_timestamp(pp.issued_ms/1000.0)::date END,
                   pp.cost, '{}'::jsonb
            FROM staging_permit_pts pp JOIN parcels p ON ST_Contains(p.geom, pp.geom)
            WHERE pp.alt_id IS NOT NULL
            ORDER BY pp.alt_id, p.apn, pp.issued_ms DESC NULLS LAST
            ON CONFLICT (permit_nbr, apn) DO UPDATE SET
              permit_type = EXCLUDED.permit_type, date_issued = EXCLUDED.date_issued,
              const_cost = EXCLUDED.const_cost
        """)
        n_staged_parcels = cur.rowcount
        cur.execute("DROP TABLE IF EXISTS staging_permit_pts")
    print(f"  swept {staged} non-residential permits since {cutoff.isoformat()} "
          f"(feed back to {_ms_to_date(min_ms) or '?'}); {n_staged_parcels} landed on our parcels")
    derive_no_permits_anomaly(cutoff, url)


def derive_no_permits_anomaly(cutoff: date, permit_url: str) -> None:
    """Flag gated parcels built <1985 with no permit since `cutoff`; delete stale flags."""
    source_ref = permit_url + "#derived-no-permits-10yr"
    window_desc = f"no permits issued since {cutoff.isoformat()}"
    with cursor() as cur:
        cur.execute("""
            SELECT p.apn, pr.year_built
            FROM parcels p JOIN properties pr USING (apn)
            WHERE (p.in_universe OR p.manual_review)
              AND pr.year_built IS NOT NULL AND pr.year_built < 1985
              AND NOT EXISTS (SELECT 1 FROM staging_permits sp
                              WHERE sp.apn = p.apn AND sp.date_issued >= %s)
        """, (cutoff,))
        qualifying = cur.fetchall()
        cur.execute("DELETE FROM distress_signals WHERE type='permit_anomaly' "
                    "AND source_ref = %s AND apn <> ALL(%s)",
                    (source_ref, [q[0] for q in qualifying] or [""]))
        n_del = cur.rowcount
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO distress_signals (apn, type, detail, event_date, source_ref)
            VALUES %s
            ON CONFLICT (apn, type, source_ref) DO UPDATE SET detail = EXCLUDED.detail
            """,
            [(apn, "permit_anomaly",
              f"no_permits_10yr_pre1985: built {yb}, {window_desc}", None, source_ref)
             for apn, yb in qualifying], page_size=500,
        )
    print(f"  permit_anomaly signals: {len(qualifying)} current, {n_del} stale removed")


def main() -> int:
    print("pull_distress_columbus: code enforcement + permits (spatial join) ...")
    with cursor(commit=False) as cur:
        cur.execute("SELECT count(*) FROM parcels")
        if cur.fetchone()[0] == 0:
            raise RuntimeError("parcels table is empty — run pull_parcels_columbus first")
    with JobRun("pull_code_enforcement_columbus") as job:
        fetch_code_enforcement(job)
        print(f"  code job: {job.ok_count} ok, {job.fail_count} failed")
    with JobRun("pull_permits_columbus") as job:
        fetch_permits(job)
        print(f"  permit job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
