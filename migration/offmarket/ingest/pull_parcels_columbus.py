#!/usr/bin/env python3
"""
pull_parcels_columbus.py — ingest Columbus / Franklin County industrial parcels.

  Franklin County Tax Parcels (Parcel_Features/0) ──> staging_parcels ──> parcels + properties
  Franklin County Building Footprints (Reference_Data/1) ──> footprint-proxy building_sf

Columbus building SF — corrected 2026-06-17: the Franklin County Tax Parcel layer DOES
carry an authoritative assessor building area, BLDGAREA ("Gross Floor Area"), populated on
2,363 of 3,796 industrial parcels (incl. ~all of the >=75k universe). The original build
checked only the RESIDENTIAL field (RESFLRAREA, null on industrial) and wrongly concluded
"no commercial SF". So building_sf is now COALESCE(BLDGAREA, footprint_proxy): the real
assessor GBA where present (sf_confidence='assessor'), the building-footprint-polygon sum as
a FALLBACK for the minority without it (sf_confidence='proxy', flagged on the dashboard).
footprint_sf is set to the parcel LAND area (like Charlotte) so build_universe's
"building_sf > entire parcel" mismatch check works.

Other Columbus specifics:
  * apn = PARCELID (dashed, e.g. 040-005809); CLASSCD is a STRING code (numeric IN errors).
  * Owner mailing state is parsed out of the COMBINED PSTLCITYSTZIP ("CITY ST ZIP") string —
    there is no separate state column (unlike Nashville/Charlotte).
  * assessed_value = TOTVALUEBASE (appraised total value); acres = STATEDAREA.
  * year_built is STILL NULL — RESYRBLT is residential-only and Franklin County publishes no
    commercial/industrial year-built in any open feature service (it lives only in the Auditor
    bulk CAMA file, which 403s automated fetch). Needs a manual/founder CAMA pull to fill.

Writes the SAME canonical staging tables as the other markets, so transform/normalize.py,
transform/build_universe.py and scoring/score.py run unchanged under MARKET=columbus.

    MARKET=columbus python ingest/pull_parcels_columbus.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import industrial_codes, sources  # noqa: E402

OUT_FIELDS = ("PARCELID,OWNERNME1,OWNERNME2,PSTLADDRES,PSTLCITYSTZIP,"
              "SALEDATE,SALEPRICE,SITEADDRESS,CLASSCD,CLASSDSCRP,RESYRBLT,"
              "BLDGAREA,TOTVALUEBASE,STATEDAREA")

STAGING_PARCEL_COLS = (
    "apn,owner,own_addr,own_city,own_state,own_zip,own_date_ms,sale_price,"
    "prop_addr,prop_city,prop_zip,lu_code,lu_desc,acres,totl_appr,totl_assd,geom,raw"
)
STAGING_PARCEL_TMPL = ("(" + ",".join(["%s"] * 16) +
                       ",ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))),%s)")

# "CITY ST ZIP[-4]" -> the 2-letter state that precedes the trailing ZIP.
_STATE_RE = re.compile(r"\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$")

# building-footprint layer is swept ONCE (ordered by OBJECTID, deduped) rather than per
# parcel-bbox — overlapping bboxes would re-pull the same footprint and double-count SF.
FOOTPRINT_PAGE = 2000


def _state(city_state_zip: str | None) -> str | None:
    if not city_state_zip:
        return None
    m = _STATE_RE.search(city_state_zip.strip())
    return m.group(1) if m else None


from lib.ingest_base import coerce_ms as _coerce_ms  # shared coercer (HEALTH_AUDIT §C1)


def fetch_parcels(job: JobRun) -> int:
    """Land industrial-band parcels (with geometry) into staging_parcels."""
    codes = list(industrial_codes())
    inlist = ",".join("'" + c + "'" for c in codes)
    where = f"CLASSCD IN ({inlist})"
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
        rows.append((
            apn, a.get("OWNERNME1"), a.get("PSTLADDRES"),
            None, _state(a.get("PSTLCITYSTZIP")), None,   # own_city, own_state, own_zip
            _coerce_ms(a.get("SALEDATE")), a.get("SALEPRICE"),
            a.get("SITEADDRESS"), None, None,             # prop_addr, prop_city, prop_zip
            a.get("CLASSCD"), a.get("CLASSDSCRP"),
            a.get("STATEDAREA"), a.get("TOTVALUEBASE"), None,  # acres, totl_appr(=appraised total), totl_assd
            json.dumps(geom), json.dumps(a),              # BLDGAREA rides along in raw -> read in promote()
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
        # No CAMA building rows in Columbus — building_sf comes from the footprint proxy.
        cur.execute("TRUNCATE staging_building_chars")
    print(f"  parcels staged: {len(rows)}")
    return len(rows)


def promote() -> None:
    """staging -> parcels + properties. building_sf = authoritative assessor BLDGAREA where
    present (sf_confidence='assessor'); compute_footprint_sf() fills the rest with the
    footprint proxy (sf_confidence='proxy').

    footprint_sf is left NULL on purpose, which makes build_universe SKIP its "building bigger
    than the whole parcel = garbage" mismatch check for Columbus. That check fits Nashville
    (guarding against absurd CAMA SF), but here building_sf is the assessor's OWN authoritative
    gross floor area, and proxy SF is sub-parcel by construction — so comparing it to the
    parcel polygon's land area only false-flags legitimate multi-story warehouses, industrial
    condos (FAR > 1), and parcels whose polygon is a small building pad (a 74k-SF building on a
    3.4k-SF condo parcel). Verified: that comparison mismatched 156 parcels, ~nearly all real."""
    with cursor() as cur:
        cur.execute("""
            INSERT INTO parcels (apn, geom, situs_address, land_sf, land_use_code,
                                 land_use_desc, last_seen_at)
            SELECT apn, geom, prop_addr,
                   ROUND((ST_Area(geom::geography)*10.7639)::numeric, 0),
                   lu_code, lu_desc, now()
            FROM staging_parcels
            ON CONFLICT (apn) DO UPDATE SET
              geom=EXCLUDED.geom, situs_address=EXCLUDED.situs_address,
              land_sf=EXCLUDED.land_sf, land_use_code=EXCLUDED.land_use_code,
              land_use_desc=EXCLUDED.land_use_desc, last_seen_at=now()
        """)
        n_parcels = cur.rowcount

        cur.execute("""
            INSERT INTO properties
              (apn, building_sf, building_sf_largest, building_count, footprint_sf,
               year_built, last_sale_date, last_sale_price, assessed_value, hold_years,
               sf_confidence, last_seen_at)
            SELECT s.apn,
              NULLIF((s.raw->>'BLDGAREA')::numeric, 0),           -- authoritative assessor GBA
              NULLIF((s.raw->>'BLDGAREA')::numeric, 0),           -- _largest = same (parcel-level)
              CASE WHEN NULLIF((s.raw->>'BLDGAREA')::numeric, 0) IS NOT NULL THEN 1 ELSE 0 END,
              NULL::numeric,                                      -- footprint_sf: NULL -> skip mismatch check
              NULL::int,                                          -- year_built: not in any open feed
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN to_timestamp(s.own_date_ms/1000.0)::date END,
              NULLIF(s.sale_price, 0),
              NULLIF(s.totl_appr, 0),                             -- assessed_value = TOTVALUEBASE
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN ROUND(((extract(epoch from now()) - s.own_date_ms/1000.0)
                               / 31557600.0)::numeric, 1) END,
              CASE WHEN NULLIF((s.raw->>'BLDGAREA')::numeric, 0) IS NOT NULL
                   THEN 'assessor' ELSE 'proxy' END,
              now()
            FROM staging_parcels s
            ON CONFLICT (apn) DO UPDATE SET
              building_sf=EXCLUDED.building_sf, building_sf_largest=EXCLUDED.building_sf_largest,
              building_count=EXCLUDED.building_count, footprint_sf=EXCLUDED.footprint_sf,
              assessed_value=EXCLUDED.assessed_value, last_sale_date=EXCLUDED.last_sale_date,
              last_sale_price=EXCLUDED.last_sale_price, hold_years=EXCLUDED.hold_years,
              sf_confidence=EXCLUDED.sf_confidence, last_seen_at=now()
        """)
        n_props = cur.rowcount

        # Repair any invalid parcel rings so the footprint join + submarket gate don't error.
        cur.execute("""
            UPDATE parcels SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
            WHERE NOT ST_IsValid(geom)
        """)
    print(f"  promoted: parcels~{n_parcels}, properties~{n_props}")


def compute_footprint_sf(job: JobRun) -> None:
    """Footprint proxy — now a FALLBACK only. Sweep the county building footprints once and,
    in PostGIS, sum the footprint areas whose interior point lands inside each parcel. Fill
    properties.building_sf / _largest / _count ONLY where the authoritative assessor BLDGAREA
    was absent (building_sf still NULL after promote). Leaves footprint_sf (NULL) and the
    'assessor' rows untouched."""
    fp_url = sources()["building_footprints"]
    with cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS staging_footprints")
        cur.execute("CREATE TABLE staging_footprints "
                    "(objectid bigint PRIMARY KEY, geom geometry(Geometry,4326))")

    INS = ("INSERT INTO staging_footprints (objectid, geom) VALUES %s "
           "ON CONFLICT (objectid) DO NOTHING")
    TMPL = "(%s, ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))))"

    def _flush(rows):
        if not rows:
            return 0
        with cursor() as cur:
            psycopg2.extras.execute_values(cur, INS, rows, template=TMPL, page_size=1000)
        return len(rows)

    # ONE ordered sweep of every footprint in the county; OBJECTID PK + ON CONFLICT make it
    # idempotent even if pagination ever overlaps. The PostGIS join keeps only the footprints
    # whose interior point lands inside an industrial parcel.
    buf, staged = [], 0
    for feat in arcgis.query(
        fp_url, where="1=1", out_fields="OBJECTID", order_by="OBJECTID",
        geojson=True, return_geometry=True, page_size=FOOTPRINT_PAGE,
    ):
        g = feat.get("geometry")
        a = feat.get("properties") or {}
        oid = a.get("OBJECTID")
        if oid is None:
            oid = feat.get("id")
        if g is None or oid is None:
            continue
        buf.append((oid, json.dumps(g)))
        if len(buf) >= 2000:
            staged += _flush(buf); buf = []
    staged += _flush(buf)

    with cursor() as cur:
        # Assign each footprint to the parcel containing its interior point (avoids the
        # double-count a boundary-spanning footprint would get from ST_Intersects).
        # Materialise the point + GIST indexes so the join is index-accelerated, not O(n*m).
        cur.execute("ALTER TABLE staging_footprints ADD COLUMN pt geometry(Point,4326)")
        cur.execute("UPDATE staging_footprints SET pt = ST_PointOnSurface(geom) "
                    "WHERE ST_IsValid(geom) AND GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')")
        cur.execute("CREATE INDEX ON staging_footprints USING GIST (pt)")
        cur.execute("CREATE INDEX IF NOT EXISTS parcels_geom_gix ON parcels USING GIST (geom)")
        cur.execute("ANALYZE staging_footprints")
        cur.execute("""
            WITH fp AS (
              SELECT p.apn, ST_Area(f.geom::geography)*10.7639 AS sqft
              FROM staging_footprints f
              JOIN parcels p ON ST_Contains(p.geom, f.pt)
              WHERE f.pt IS NOT NULL
            ), agg AS (
              SELECT apn, SUM(sqft) bsf, MAX(sqft) largest, COUNT(*) cnt
              FROM fp GROUP BY apn
            )
            UPDATE properties pr SET
              building_sf = ROUND(agg.bsf::numeric, 0),
              building_sf_largest = ROUND(agg.largest::numeric, 0),
              building_count = agg.cnt
              -- footprint_sf left as parcel land area (promote); sf_confidence stays 'proxy'
            FROM agg WHERE agg.apn = pr.apn AND pr.building_sf IS NULL
        """)
        n = cur.rowcount
        cur.execute("DROP TABLE IF EXISTS staging_footprints")
    print(f"  footprints staged: {staged}; building_sf (proxy FALLBACK) set on {n} "
          f"parcels lacking assessor BLDGAREA")
    job.ok(n)


def main() -> int:
    print("pull_parcels_columbus: fetching Franklin County industrial parcels ...")
    with JobRun("pull_parcels_columbus") as job:
        n = fetch_parcels(job)
        if not n:
            raise RuntimeError("no parcels fetched — check endpoint / CLASSCD filter")
        promote()
        print("  computing footprint-proxy building_sf ...")
        compute_footprint_sf(job)
        print(f"  job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
