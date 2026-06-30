#!/usr/bin/env python3
"""
pull_parcels_charlotte.py — ingest Charlotte / Mecklenburg industrial parcels.

  Mecklenburg CAMA (TaxParcel_camadata) ──> staging_parcels + staging_building_chars
                                        ──> parcels + properties

Charlotte differs from Nashville's pull_parcels in two ways (see DATA_NOTES_CHARLOTTE.md):
  * ONE CAMA layer carries owner + land use + building SF + year + sale + geometry, keyed
    on `pid`. No second CAMA layer / APN join.
  * Industrial filter is TEXT on `landuse_description` (lusecode is many-to-many), driven
    by markets/charlotte.yaml land_use.industrial_codes — NOT a numeric code set.

building_sf = SUM(DISTINCT heatedarea) per pid, excluding self-storage building types.
DISTINCT because the feed mixes three shapes: a heatedarea repeated as a parcel total
(collapses to one value), genuine multi-building parcels with differing per-building SF
(summed — matches the founder's "SUM of structures" rule), and literal duplicate rows
(deduped, so a raw SUM can't multiply them). See promote() for the full reasoning.

Writes the SAME canonical staging tables as Nashville, so transform/normalize.py,
transform/build_universe.py and scoring/score.py run unchanged under MARKET=charlotte.

    MARKET=charlotte python ingest/pull_parcels_charlotte.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import excluded_structure_types, industrial_codes, sources  # noqa: E402

OUT_FIELDS = (
    "pid,ownrlstnme,ownrfrstnme,mailaddr1,mailaddr2,city,state,zipcode,"
    "saledate,saleprice,address,loccity,landuse_description,bldgtype,"
    "heatedarea,finarea,yearbuilt,vacorimprov,totalvalue"
)

STAGING_PARCEL_COLS = (
    "apn,owner,own_addr,own_city,own_state,own_zip,own_date_ms,sale_price,"
    "prop_addr,prop_city,prop_zip,lu_code,lu_desc,acres,totl_appr,totl_assd,geom,raw"
)
# 16 plain values, then geom (GeoJSON -> 2D MULTIPOLYGON 4326), then raw jsonb (same
# shape/template as the Nashville loader).
STAGING_PARCEL_TMPL = ("(" + ",".join(["%s"] * 16) +
                       ",ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))),%s)")


from lib.ingest_base import coerce_ms as _coerce_ms  # shared coercer (HEALTH_AUDIT §C1)


def _owner_name(last, first):
    """Mecklenburg splits owner into last/first. For an entity (LLC/INC/LP) the full
    name is in `ownrlstnme` and `ownrfrstnme` is blank -> use the entity name as-is."""
    last = (last or "").strip()
    first = (first or "").strip()
    return f"{last}, {first}" if first else last


def _industrial_where() -> str:
    codes = industrial_codes()  # parcel-level landuse_description values to keep
    inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)
    return f"landuse_description IN ({inlist})"


def fetch_parcels(job: JobRun) -> list[str]:
    """Land industrial parcels (with geometry) into staging_parcels (one row per pid),
    and every building row into staging_building_chars."""
    where = _industrial_where()
    parcels: dict[str, tuple] = {}   # pid -> staging_parcels row (keep max-heatedarea)
    best_sf: dict[str, float] = {}
    bldg_rows = []
    for feat in arcgis.query(
        sources()["parcels"], where=where, out_fields=OUT_FIELDS,
        geojson=True, return_geometry=True, page_size=2000,
    ):
        a = feat.get("properties", {})
        geom = feat.get("geometry")
        pid = a.get("pid")
        if not pid:
            job.fail("missing pid", ref=str(a.get("OBJECTID")))
            continue
        ha = a.get("heatedarea") or a.get("finarea") or 0
        # every building row -> CAMA staging (structure_type=bldgtype, finished_area=heatedarea)
        bldg_rows.append((pid, None, a.get("bldgtype"), ha, a.get("yearbuilt"), json.dumps(a)))
        # parcel-level staging: dedupe by pid, keep the largest-SF row (needs geometry)
        if geom is None:
            continue
        if pid in parcels and ha <= best_sf.get(pid, 0):
            continue
        best_sf[pid] = ha
        own_addr = a.get("mailaddr1")
        if a.get("mailaddr2"):
            own_addr = f"{own_addr or ''} {a['mailaddr2']}".strip()
        parcels[pid] = (
            pid, _owner_name(a.get("ownrlstnme"), a.get("ownrfrstnme")),
            own_addr, a.get("city"), (a.get("state") or "").strip() or None, a.get("zipcode"),
            _coerce_ms(a.get("saledate")), a.get("saleprice"),
            a.get("address"), a.get("loccity"), None,
            a.get("landuse_description"),          # lu_code = the gate key (parcel-level use)
            a.get("bldgtype"),                     # lu_desc = building-level descriptor (display)
            None,                                  # acres: land_sf computed from geometry in promote
            None, a.get("totalvalue"),
            json.dumps(geom), json.dumps(a),
        )
        job.ok()

    with cursor() as cur:
        cur.execute("TRUNCATE staging_parcels")
        psycopg2.extras.execute_values(
            cur,
            f"INSERT INTO staging_parcels ({STAGING_PARCEL_COLS}) VALUES %s "
            "ON CONFLICT (apn) DO NOTHING",
            list(parcels.values()), template=STAGING_PARCEL_TMPL, page_size=500,
        )
        cur.execute("TRUNCATE staging_building_chars")
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO staging_building_chars "
            "(apn,card,structure_type,finished_area,year_built,raw) VALUES %s",
            bldg_rows, page_size=1000,
        )
    print(f"  parcels staged: {len(parcels)} | CAMA building rows: {len(bldg_rows)}")
    return sorted(parcels)


def promote() -> None:
    """staging -> parcels + properties (Charlotte-specific aggregation).

    building_sf = MAX(heatedarea) per pid excluding self-storage; land_sf from the
    parcel polygon (Mecklenburg's acreage field units are ambiguous — see notes)."""
    excl = ",".join("'" + s.replace("'", "''") + "'" for s in excluded_structure_types())
    cond = f"b.structure_type NOT IN ({excl})" if excl else "TRUE"
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

        # building_sf = SUM(DISTINCT finished_area) per pid, NOT MAX. Robust to all three
        # shapes the Mecklenburg CAMA feed throws: (a) heatedarea repeated as a parcel total
        # -> DISTINCT collapses to one value; (b) genuine multi-building parcels with differing
        # per-building SF -> summed (matches the founder's Nashville "SUM of structures"
        # decision, so multi-box campuses aren't missed); (c) literal DUPLICATE rows the feed
        # returns -> deduped by DISTINCT (a raw SUM would multiply them). Trade-off: two
        # genuinely separate buildings of identical SF collapse to one (rare, slight undercount).
        cur.execute(f"""
            WITH agg AS (
              SELECT s.apn,
                SUM(DISTINCT b.finished_area) FILTER (WHERE {cond}) AS bsf,
                MAX(b.finished_area) FILTER (WHERE {cond}) AS lg,
                COUNT(DISTINCT b.finished_area) FILTER (WHERE {cond} AND b.finished_area IS NOT NULL) AS cnt,
                (array_agg(b.year_built ORDER BY b.finished_area DESC NULLS LAST)
                  FILTER (WHERE {cond}))[1] AS yb
              FROM staging_parcels s
              LEFT JOIN staging_building_chars b ON b.apn = s.apn
              GROUP BY s.apn
            )
            INSERT INTO properties
              (apn, building_sf, building_sf_largest, building_count, year_built,
               last_sale_date, last_sale_price, assessed_value, hold_years, sf_confidence,
               last_seen_at)
            SELECT s.apn, agg.bsf, agg.lg, COALESCE(agg.cnt,0), agg.yb,
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN to_timestamp(s.own_date_ms/1000.0)::date END,
              NULLIF(s.sale_price, 0),
              NULLIF(s.totl_assd, 0),
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

        cur.execute("""
            UPDATE properties pr
            SET footprint_sf = ROUND((ST_Area(pa.geom::geography)*10.7639)::numeric, 0)
            FROM parcels pa WHERE pa.apn = pr.apn AND pa.geom IS NOT NULL
        """)
        cur.execute("""
            UPDATE parcels
            SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
            WHERE NOT ST_IsValid(geom)
        """)
        n_fixed = cur.rowcount
    print(f"  promoted: parcels~{n_parcels}, properties~{n_props}, geom_repaired={n_fixed}")


def main() -> int:
    print("pull_parcels_charlotte: fetching Mecklenburg industrial CAMA ...")
    with JobRun("pull_parcels_charlotte") as job:
        apns = fetch_parcels(job)
        if not apns:
            raise RuntimeError("no parcels fetched — check CAMA endpoint / land-use filter")
        promote()
        print(f"  job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
