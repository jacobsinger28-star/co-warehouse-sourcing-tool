#!/usr/bin/env python3
"""
pull_parcels.py — ingest industrial parcels + their building characteristics.

  ArcGIS ownership parcels (industrial LUCodes) ─┐
                                                 ├─> staging ─> parcels + properties
  ArcGIS CAMA building rows (by APN)            ─┘

What it does NOT do: owner/entity resolution, portfolio grouping, the universe gates.
Owner fields are left in staging_parcels for normalize.py (Day 3); gates are
build_universe.py (Day 2). This stage just lands clean parcel + aggregated-building rows.

building_sf = SUM of FinishedArea across all buildings on the parcel, excluding
self-storage structure types (founder decision 2026-06-11). largest + count stored too.

    python ingest/pull_parcels.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis, sources as S  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402

OWN_FIELDS = ("APN,Owner,OwnAddr1,OwnCity,OwnState,OwnZip,OwnDate,SalePrice,"
              "PropAddr,PropCity,PropZip,LUCode,LUDesc,Acres,TotlAppr,TotlAssd")
CAMA_FIELDS = "APN,AssessorCardNumber,StructureType,FinishedArea,YearBuilt"

STAGING_PARCEL_COLS = (
    "apn,owner,own_addr,own_city,own_state,own_zip,own_date_ms,sale_price,"
    "prop_addr,prop_city,prop_zip,lu_code,lu_desc,acres,totl_appr,totl_assd,geom,raw"
)
# 16 plain values, then geom (GeoJSON -> 2D MULTIPOLYGON 4326), then raw jsonb.
# ST_Force2D: Nashville parcel geometry carries a Z dimension the column doesn't.
STAGING_PARCEL_TMPL = ("(" + ",".join(["%s"] * 16) +
                       ",ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))),%s)")


from lib.ingest_base import coerce_ms as _coerce_ms  # shared coercer (HEALTH_AUDIT §C1)


def fetch_parcels(job: JobRun) -> list[str]:
    """Land industrial-band ownership parcels (with geometry) into staging_parcels."""
    # IsActive guard: today all industrial parcels are 'Y' (verified 2026-06-11),
    # but retired/historical parcel records would silently pollute future refreshes.
    where = ("LUCode IN (" + ",".join(f"'{c}'" for c in S.INDUSTRIAL_LUCODES) + ")"
             " AND IsActive = 'Y'")
    rows, apns = [], []
    for feat in arcgis.query(
        S.PARCELS_OWNERSHIP, where=where, out_fields=OWN_FIELDS,
        geojson=True, return_geometry=True, page_size=2000,
    ):
        a = feat.get("properties", {})
        geom = feat.get("geometry")
        apn = a.get("APN")
        if not apn:
            job.fail("missing APN", ref=str(a.get("OBJECTID")))
            continue
        if geom is None:
            job.fail("no geometry", ref=apn)
            continue
        rows.append((
            apn, a.get("Owner"), a.get("OwnAddr1"), a.get("OwnCity"), a.get("OwnState"),
            a.get("OwnZip"), _coerce_ms(a.get("OwnDate")), a.get("SalePrice"),
            a.get("PropAddr"), a.get("PropCity"), a.get("PropZip"),
            a.get("LUCode"), a.get("LUDesc"), a.get("Acres"),
            a.get("TotlAppr"), a.get("TotlAssd"),
            json.dumps(geom), json.dumps(a),
        ))
        apns.append(apn)
        job.ok()
    with cursor() as cur:
        cur.execute("TRUNCATE staging_parcels")
        psycopg2.extras.execute_values(
            cur,
            f"INSERT INTO staging_parcels ({STAGING_PARCEL_COLS}) VALUES %s "
            "ON CONFLICT (apn) DO NOTHING",
            rows, template=STAGING_PARCEL_TMPL, page_size=500,
        )
    print(f"  parcels staged: {len(rows)} (apns: {len(set(apns))})")
    return sorted(set(apns))


def fetch_cama(apns: list[str], job: JobRun) -> int:
    """Land CAMA building rows for the staged APNs into staging_building_chars."""
    rows = []
    for feat in arcgis.query_by_in(
        S.PARCELS_BUILDING_CHARACTERISTICS, "APN", apns,
        out_fields=CAMA_FIELDS, batch=250, page_size=2000,
    ):
        a = feat.get("attributes", {})
        rows.append((
            a.get("APN"), a.get("AssessorCardNumber"), a.get("StructureType"),
            a.get("FinishedArea"), a.get("YearBuilt"), json.dumps(a),
        ))
    with cursor() as cur:
        cur.execute("TRUNCATE staging_building_chars")
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO staging_building_chars "
            "(apn,card,structure_type,finished_area,year_built,raw) VALUES %s",
            rows, page_size=1000,
        )
    print(f"  CAMA building rows staged: {len(rows)}")
    return len(rows)


def promote() -> None:
    """staging -> parcels + properties (aggregated). All set-based, idempotent on apn."""
    excl = ",".join(f"'{s}'" for s in S.EXCLUDED_STRUCTURE_TYPES)
    with cursor() as cur:
        # parcels
        cur.execute("""
            INSERT INTO parcels (apn, geom, situs_address, land_sf, land_use_code,
                                 land_use_desc, last_seen_at)
            SELECT apn, geom, prop_addr, ROUND((acres*43560.0)::numeric,0), lu_code,
                   lu_desc, now()
            FROM staging_parcels
            ON CONFLICT (apn) DO UPDATE SET
              geom=EXCLUDED.geom, situs_address=EXCLUDED.situs_address,
              land_sf=EXCLUDED.land_sf, land_use_code=EXCLUDED.land_use_code,
              land_use_desc=EXCLUDED.land_use_desc, last_seen_at=now()
        """)
        n_parcels = cur.rowcount

        # properties — aggregate building chars, excluding self-storage structures.
        cur.execute(f"""
            WITH agg AS (
              SELECT s.apn,
                SUM(b.finished_area) FILTER (
                  WHERE b.structure_type NOT IN ({excl})) AS bsf,
                MAX(b.finished_area) FILTER (
                  WHERE b.structure_type NOT IN ({excl})) AS largest,
                COUNT(*) FILTER (
                  WHERE b.structure_type NOT IN ({excl})
                    AND b.finished_area IS NOT NULL) AS cnt,
                (array_agg(b.year_built ORDER BY b.finished_area DESC NULLS LAST)
                  FILTER (WHERE b.structure_type NOT IN ({excl})))[1] AS yb
              FROM staging_parcels s
              LEFT JOIN staging_building_chars b ON b.apn = s.apn
              GROUP BY s.apn
            )
            INSERT INTO properties
              (apn, building_sf, building_sf_largest, building_count, year_built,
               last_sale_date, last_sale_price, assessed_value, hold_years, sf_confidence,
               last_seen_at)
            SELECT s.apn, agg.bsf, agg.largest, COALESCE(agg.cnt,0), agg.yb,
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN to_timestamp(s.own_date_ms/1000.0)::date END,
              NULLIF(s.sale_price, 0),
              COALESCE(NULLIF(s.totl_assd,0), NULLIF(s.totl_appr,0)),
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN ROUND(((extract(epoch from now()) - s.own_date_ms/1000.0)
                               / 31557600.0)::numeric, 1) END,
              'ok', now()
            FROM staging_parcels s JOIN agg ON agg.apn = s.apn
            ON CONFLICT (apn) DO UPDATE SET
              building_sf=EXCLUDED.building_sf, building_sf_largest=EXCLUDED.building_sf_largest,
              building_count=EXCLUDED.building_count, year_built=EXCLUDED.year_built,
              last_sale_date=EXCLUDED.last_sale_date, last_sale_price=EXCLUDED.last_sale_price,
              assessed_value=EXCLUDED.assessed_value, hold_years=EXCLUDED.hold_years,
              last_seen_at=now()
        """)
        n_props = cur.rowcount

        # footprint_sf = parcel polygon area (sqft). True building-footprint data
        # isn't published; the >40% mismatch check in build_universe uses this proxy.
        cur.execute("""
            UPDATE properties pr
            SET footprint_sf = ROUND((ST_Area(pa.geom::geography)*10.7639)::numeric, 0)
            FROM parcels pa WHERE pa.apn = pr.apn AND pa.geom IS NOT NULL
        """)

        # Repair invalid rings (Nashville has a few self-intersecting parcel polygons)
        # so the submarket gate's ST_Contains / ST_Centroid don't error downstream.
        cur.execute("""
            UPDATE parcels
            SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
            WHERE NOT ST_IsValid(geom)
        """)
        n_fixed = cur.rowcount
    print(f"  promoted: parcels~{n_parcels}, properties~{n_props}, geom_repaired={n_fixed}")


def main() -> int:
    print("pull_parcels: fetching industrial parcels + CAMA from ArcGIS ...")
    with JobRun("pull_parcels") as job:
        apns = fetch_parcels(job)
        if not apns:
            raise RuntimeError("no parcels fetched — check ArcGIS endpoint / LUCode filter")
        fetch_cama(apns, job)
        promote()
        print(f"  job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
