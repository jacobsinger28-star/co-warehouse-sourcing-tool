#!/usr/bin/env python3
"""
pull_parcels_cuyahoga.py — ingest Cleveland / Cuyahoga County industrial parcels.

  Cuyahoga County Fiscal Officer "EPV Survey Parcel" (CCFO/EPV_Prod/2)
    ──> staging_parcels ──> parcels + properties

This is the simplest market built so far: ONE parcel FeatureServer carries every
field the pipeline needs, so there is no separate CAMA join (Nashville) and no
building-footprint proxy (Columbus):
  * building_sf  = total_com_use_area — the county's OWN summed commercial gross
    floor area (authoritative assessor SF, NOT a footprint estimate). ~41% of
    industrial-band parcels have it; the rest are vacant land / no commercial
    building record and correctly fail the 75k gate.
  * year_built   = min_com_age — note the field is MISLABELED "age" but actually
    stores the YEAR (e.g. 1974, 1988). min = the oldest commercial structure, our
    canonical year_built (Cuyahoga HAS year_built, unlike Columbus).
  * assessed_value = tax_market_total (full market value).
  * owner mailing state (mail_state) is a clean 2-letter field -> out-of-state flag.
  * total_net_delq_balance rides along in raw -> native tax-delinquency distress,
    emitted by pull_distress_cuyahoga (no founder Trustee CSV needed here).

Writes the SAME canonical staging tables as the other markets, so transform/normalize.py,
transform/build_universe.py and scoring/score.py run unchanged under MARKET=cuyahoga.

    MARKET=cuyahoga python ingest/pull_parcels_cuyahoga.py
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

OUT_FIELDS = ("parcelpin,parcel_owner,mail_addr_street,mail_city,mail_state,mail_zip,"
              "last_transfer_date,last_sales_amount,par_addr_all,tax_luc,tax_luc_description,"
              "parcel_acreage,total_com_use_area,com_bldg_count,tax_market_total,"
              "min_com_age,total_net_delq_balance")

STAGING_PARCEL_COLS = (
    "apn,owner,own_addr,own_city,own_state,own_zip,own_date_ms,sale_price,"
    "prop_addr,prop_city,prop_zip,lu_code,lu_desc,acres,totl_appr,totl_assd,geom,raw"
)
STAGING_PARCEL_TMPL = ("(" + ",".join(["%s"] * 16) +
                       ",ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))),%s)")


from lib.ingest_base import coerce_ms as _coerce_ms  # shared coercer (HEALTH_AUDIT §C1)


def fetch_parcels(job: JobRun) -> int:
    """Land industrial-band parcels (with geometry) into staging_parcels."""
    codes = list(industrial_codes())
    inlist = ",".join("'" + c + "'" for c in codes)
    where = f"tax_luc IN ({inlist})"
    rows, seen = [], set()
    for feat in arcgis.query(
        sources()["parcels"], where=where, out_fields=OUT_FIELDS,
        geojson=True, return_geometry=True, page_size=2000,
    ):
        a = feat.get("properties", {})
        geom = feat.get("geometry")
        apn = a.get("parcelpin")
        if not apn:
            job.fail("missing parcelpin", ref=str(a.get("OBJECTID")))
            continue
        if geom is None:
            job.fail("no geometry", ref=apn)
            continue
        if apn in seen:
            continue
        seen.add(apn)
        rows.append((
            apn, a.get("parcel_owner"), a.get("mail_addr_street"),
            a.get("mail_city"), (a.get("mail_state") or "").strip().upper() or None,
            a.get("mail_zip"),
            _coerce_ms(a.get("last_transfer_date")), a.get("last_sales_amount"),
            a.get("par_addr_all"), None, None,           # prop_addr, prop_city, prop_zip
            a.get("tax_luc"), a.get("tax_luc_description"),
            a.get("parcel_acreage"), a.get("tax_market_total"), None,  # acres, totl_appr(=market), totl_assd
            json.dumps(geom), json.dumps(a),             # SF/year/delq ride along in raw -> promote()
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
        # No separate CAMA building table in Cuyahoga — building_sf is summed in the parcel layer.
        cur.execute("TRUNCATE staging_building_chars")
    print(f"  parcels staged: {len(rows)}")
    return len(rows)


def promote() -> None:
    """staging -> parcels + properties.

    building_sf = total_com_use_area (authoritative summed assessor GFA). footprint_sf is
    left NULL on purpose so build_universe SKIPS its "building bigger than the parcel =
    garbage" mismatch check — that check guards against absurd CAMA SF, but here building_sf
    is the assessor's own gross floor area, which legitimately exceeds the parcel land area
    for multi-story warehouses and industrial condos (FAR > 1). building_sf_largest mirrors
    building_sf (no per-building breakdown is exposed; com_bldg_count carries the count)."""
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
              NULLIF((s.raw->>'total_com_use_area')::numeric, 0),    -- summed assessor GFA
              NULLIF((s.raw->>'total_com_use_area')::numeric, 0),    -- _largest = same (parcel-level)
              NULLIF((s.raw->>'com_bldg_count')::int, 0),
              NULL::numeric,                                         -- footprint_sf: NULL -> skip mismatch check
              NULLIF((s.raw->>'min_com_age')::int, 0),              -- year_built (field mislabeled "age")
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN to_timestamp(s.own_date_ms/1000.0)::date END,
              NULLIF(s.sale_price, 0),
              NULLIF(s.totl_appr, 0),                               -- assessed_value = tax_market_total
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN ROUND(((extract(epoch from now()) - s.own_date_ms/1000.0)
                               / 31557600.0)::numeric, 1) END,
              'ok',                                                 -- real assessor SF, no proxy
              now()
            FROM staging_parcels s
            ON CONFLICT (apn) DO UPDATE SET
              building_sf=EXCLUDED.building_sf, building_sf_largest=EXCLUDED.building_sf_largest,
              building_count=EXCLUDED.building_count, footprint_sf=EXCLUDED.footprint_sf,
              year_built=EXCLUDED.year_built, assessed_value=EXCLUDED.assessed_value,
              last_sale_date=EXCLUDED.last_sale_date, last_sale_price=EXCLUDED.last_sale_price,
              hold_years=EXCLUDED.hold_years, sf_confidence=EXCLUDED.sf_confidence,
              last_seen_at=now()
        """)
        n_props = cur.rowcount

        # Repair any invalid parcel rings so the submarket gate doesn't error.
        cur.execute("""
            UPDATE parcels SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
            WHERE NOT ST_IsValid(geom)
        """)
    print(f"  promoted: parcels~{n_parcels}, properties~{n_props}")


def main() -> int:
    print("pull_parcels_cuyahoga: fetching Cuyahoga County industrial parcels ...")
    with JobRun("pull_parcels_cuyahoga") as job:
        n = fetch_parcels(job)
        if not n:
            raise RuntimeError("no parcels fetched — check endpoint / tax_luc filter")
        promote()
        print(f"  job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
