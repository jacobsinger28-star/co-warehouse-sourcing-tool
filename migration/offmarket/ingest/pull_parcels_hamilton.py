#!/usr/bin/env python3
"""
pull_parcels_hamilton.py — ingest Cincinnati / Hamilton County (CAGIS) industrial parcels.

  CAGIS Countywide Cadastral (COUNTYWIDE/Cadastral/0) ──> staging_parcels ──> parcels + properties
  CAGIS Planimetric building footprints (PlanimetricLayers/6) ──> footprint-proxy building_sf

Hamilton is a Columbus-shaped market: the parcel layer carries owner/mailing/DTE-class/value/sale/
situs + native distress (DELQ_TAXES, FORECL_FLAG ride along in raw), but NO assessor building SF for
industrial (the auditor CAMA building layer is residential living-area only). So building_sf is the
SUM of planimetric building-footprint SQFT inside each parcel (sf_confidence='proxy'), exactly the
fallback Columbus uses — except here it's the ONLY SF source. year_built is also unavailable in the
open feeds (Auditor bulk CAMA only) -> NULL, so the no_permits_10yr_pre1985 anomaly can't fire yet.

CLASS is an INTEGER DTE code in this source, so the industrial filter emits an UNQUOTED IN-list.

Writes the SAME canonical staging tables as the other markets, so transform/normalize.py,
transform/build_universe.py and scoring/score.py run unchanged under MARKET=hamilton.

    MARKET=hamilton python ingest/pull_parcels_hamilton.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import industrial_codes, sources  # noqa: E402

OUT_FIELDS = ("PARCELID,OWNNM1,OWNAD1,OWNADCITY,OWNADSTATE,OWNADZIP,CLASS,MKT_TOTAL_VAL,"
              "SALDAT,SALAMT,ACREDEED,ADDRNO,ADDRST,ADDRSF,FORECL_FLAG,DELQ_TAXES")

STAGING_PARCEL_COLS = (
    "apn,owner,own_addr,own_city,own_state,own_zip,own_date_ms,sale_price,"
    "prop_addr,prop_city,prop_zip,lu_code,lu_desc,acres,totl_appr,totl_assd,geom,raw"
)
STAGING_PARCEL_TMPL = ("(" + ",".join(["%s"] * 16) +
                       ",ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))),%s)")

FOOTPRINT_PAGE = 2000


from lib.ingest_base import coerce_ms as _coerce_ms  # shared coercer (HEALTH_AUDIT §C1)


def _situs(a: dict) -> str | None:
    parts = [str(a.get(k)).strip() for k in ("ADDRNO", "ADDRST", "ADDRSF")
             if a.get(k) not in (None, "")]
    return " ".join(parts) or None


def fetch_parcels(job: JobRun) -> int:
    """Land industrial-band parcels (with geometry) into staging_parcels. CLASS is numeric ->
    unquoted IN-list."""
    inlist = ",".join(str(int(c)) for c in industrial_codes())   # CLASS is an integer field
    where = f"CLASS IN ({inlist})"
    rows, seen = [], set()
    for feat in arcgis.query(
        sources()["parcels"], where=where, out_fields=OUT_FIELDS,
        geojson=True, return_geometry=True, page_size=2000,
    ):
        a = feat.get("properties", {})
        geom = feat.get("geometry")
        apn = a.get("PARCELID")
        if not apn:
            job.fail("missing PARCELID", ref=str(a.get("OBJECTID")))
            continue
        if geom is None:
            job.fail("no geometry", ref=apn)
            continue
        if apn in seen:
            continue
        seen.add(apn)
        cls = a.get("CLASS")
        rows.append((
            apn, a.get("OWNNM1"), a.get("OWNAD1"),
            a.get("OWNADCITY"), (a.get("OWNADSTATE") or "").strip().upper() or None,
            a.get("OWNADZIP"),
            _coerce_ms(a.get("SALDAT")), a.get("SALAMT"),
            _situs(a), None, None,                       # prop_addr, prop_city, prop_zip
            (str(int(cls)) if cls is not None else None), None,  # lu_code (-> "330"), lu_desc
            a.get("ACREDEED"), a.get("MKT_TOTAL_VAL"), None,     # acres, totl_appr(=market), totl_assd
            json.dumps(geom), json.dumps(a),             # DELQ_TAXES/FORECL_FLAG ride along in raw
        ))
        job.ok()

    with cursor() as cur:
        cur.execute("TRUNCATE staging_parcels")
        psycopg2.extras.execute_values(
            cur,
            f"INSERT INTO staging_parcels ({STAGING_PARCEL_COLS}) VALUES %s "
            "ON CONFLICT (apn) DO NOTHING",
            rows, template=STAGING_PARCEL_TMPL, page_size=500,
        )
        cur.execute("TRUNCATE staging_building_chars")   # no CAMA building rows in Hamilton
    print(f"  parcels staged: {len(rows)}")
    return len(rows)


def promote() -> None:
    """staging -> parcels + properties. building_sf is filled later by the footprint proxy
    (sf_confidence='proxy', footprint_sf NULL -> build_universe skips the mismatch check).
    year_built is NULL (not in any open feed). lu_desc is backfilled from market industrial_codes."""
    codes = industrial_codes()
    with cursor() as cur:
        cur.execute("""
            INSERT INTO parcels (apn, geom, situs_address, land_sf, land_use_code, last_seen_at)
            SELECT apn, geom, prop_addr,
                   ROUND((ST_Area(geom::geography)*10.7639)::numeric, 0),
                   lu_code, now()
            FROM staging_parcels
            ON CONFLICT (apn) DO UPDATE SET
              geom=EXCLUDED.geom, situs_address=EXCLUDED.situs_address,
              land_sf=EXCLUDED.land_sf, land_use_code=EXCLUDED.land_use_code, last_seen_at=now()
        """)
        n_parcels = cur.rowcount
        # land_use_desc from the market code map (source has no per-parcel class text).
        psycopg2.extras.execute_values(
            cur,
            "UPDATE parcels AS p SET land_use_desc = v.d "
            "FROM (VALUES %s) AS v(c, d) WHERE p.land_use_code = v.c",
            list(codes.items()), page_size=200,
        )

        cur.execute("""
            INSERT INTO properties
              (apn, building_sf, building_sf_largest, building_count, footprint_sf,
               year_built, last_sale_date, last_sale_price, assessed_value, hold_years,
               sf_confidence, last_seen_at)
            SELECT s.apn,
              NULL::numeric, NULL::numeric, NULL::int,    -- building_sf filled by footprint proxy
              NULL::numeric,                              -- footprint_sf NULL -> skip mismatch check
              NULL::int,                                  -- year_built: not in any open feed
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN to_timestamp(s.own_date_ms/1000.0)::date END,
              NULLIF(s.sale_price, 0),
              NULLIF(s.totl_appr, 0),                     -- assessed_value = MKT_TOTAL_VAL
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN ROUND(((extract(epoch from now()) - s.own_date_ms/1000.0)
                               / 31557600.0)::numeric, 1) END,
              'proxy',                                    -- all SF is footprint-proxy here
              now()
            FROM staging_parcels s
            ON CONFLICT (apn) DO UPDATE SET
              assessed_value=EXCLUDED.assessed_value, last_sale_date=EXCLUDED.last_sale_date,
              last_sale_price=EXCLUDED.last_sale_price, hold_years=EXCLUDED.hold_years,
              sf_confidence='proxy', last_seen_at=now()
        """)
        n_props = cur.rowcount

        cur.execute("""
            UPDATE parcels SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
            WHERE NOT ST_IsValid(geom)
        """)
    print(f"  promoted: parcels~{n_parcels}, properties~{n_props}")


def compute_footprint_sf(job: JobRun) -> None:
    """Sweep the county building footprints once and, in PostGIS, SUM the SQFT field of the
    footprints whose interior point lands inside each parcel. This is the ONLY building-SF source
    for Hamilton (no assessor SF), so it fills building_sf for every parcel with footprints."""
    fp_url = sources()["building_footprints"]
    with cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS staging_footprints")
        cur.execute("CREATE TABLE staging_footprints "
                    "(objectid bigint PRIMARY KEY, sqft numeric, geom geometry(Geometry,4326))")

    INS = ("INSERT INTO staging_footprints (objectid, sqft, geom) VALUES %s "
           "ON CONFLICT (objectid) DO NOTHING")
    TMPL = "(%s, %s, ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))))"

    def _flush(rows):
        if not rows:
            return 0
        with cursor() as cur:
            psycopg2.extras.execute_values(cur, INS, rows, template=TMPL, page_size=1000)
        return len(rows)

    buf, staged = [], 0
    for feat in arcgis.query(
        fp_url, where="SQFT > 0", out_fields="OBJECTID,SQFT", order_by="OBJECTID",
        geojson=True, return_geometry=True, page_size=FOOTPRINT_PAGE,
    ):
        g = feat.get("geometry")
        a = feat.get("properties") or {}
        oid = a.get("OBJECTID") or feat.get("id")
        if g is None or oid is None:
            continue
        buf.append((oid, a.get("SQFT"), json.dumps(g)))
        if len(buf) >= 2000:
            staged += _flush(buf); buf = []
    staged += _flush(buf)

    with cursor() as cur:
        cur.execute("ALTER TABLE staging_footprints ADD COLUMN pt geometry(Point,4326)")
        cur.execute("UPDATE staging_footprints SET pt = ST_PointOnSurface(geom) "
                    "WHERE ST_IsValid(geom) AND GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')")
        cur.execute("CREATE INDEX ON staging_footprints USING GIST (pt)")
        cur.execute("CREATE INDEX IF NOT EXISTS parcels_geom_gix ON parcels USING GIST (geom)")
        cur.execute("ANALYZE staging_footprints")
        cur.execute("""
            WITH fp AS (
              SELECT p.apn, f.sqft
              FROM staging_footprints f
              JOIN parcels p ON ST_Contains(p.geom, f.pt)
              WHERE f.pt IS NOT NULL AND f.sqft IS NOT NULL
            ), agg AS (
              SELECT apn, SUM(sqft) bsf, MAX(sqft) largest, COUNT(*) cnt
              FROM fp GROUP BY apn
            )
            UPDATE properties pr SET
              building_sf = ROUND(agg.bsf::numeric, 0),
              building_sf_largest = ROUND(agg.largest::numeric, 0),
              building_count = agg.cnt
            FROM agg WHERE agg.apn = pr.apn
        """)
        n = cur.rowcount
        cur.execute("DROP TABLE IF EXISTS staging_footprints")
    print(f"  footprints staged: {staged}; building_sf (proxy) set on {n} parcels")
    job.ok(n)


def main() -> int:
    print("pull_parcels_hamilton: fetching Hamilton County (CAGIS) industrial parcels ...")
    with JobRun("pull_parcels_hamilton") as job:
        n = fetch_parcels(job)
        if not n:
            raise RuntimeError("no parcels fetched — check endpoint / CLASS filter")
        promote()
        print("  computing footprint-proxy building_sf ...")
        compute_footprint_sf(job)
        print(f"  job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
