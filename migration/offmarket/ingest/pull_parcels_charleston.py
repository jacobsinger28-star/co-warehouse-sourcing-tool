#!/usr/bin/env python3
"""
pull_parcels_charleston.py — ingest Charleston County, SC industrial parcels.

  Charleston County "PARCELS WITH ATTRIBUTES" (ENERGOV/energov_ent/12)
    ──> staging_parcels ──> parcels + properties
  Charleston County 2025 Building Outlines (FEATURES_SDE_S_BLDG_2025/1, keyed by PID)
    ──> footprint-proxy building_sf (DIRECT key join on PID, not spatial)

Charleston specifics:
  * apn = PID (10-char numeric TMS; CAMA strings are space-padded -> TRIM).
  * CLASS_CODE is "<3-digit> - <LABEL>" (e.g. "304 - MFG/INDUST", "630 - SPCLTY-WHS"); we filter
    on the prefix and STORE just the 3-digit code so industrial_codes() membership works.
  * NO assessor building SF -> building_sf is the SUM of building-outline `area` per PID
    (sf_confidence='proxy'). NO year_built, NO total appraisal (assessed_value NULL), and there
    is NO distress feed for Charleston — so there is no pull_distress_charleston (by design).
  * SALE_PRICE + RECORDED_DATE are populated (SC discloses sales) -> hold_years + last sale.

Writes the SAME canonical staging tables as the other markets, so transform/normalize.py,
transform/build_universe.py and scoring/score.py run unchanged under MARKET=charleston.

    MARKET=charleston python ingest/pull_parcels_charleston.py
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import arcgis  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import industrial_codes, sources  # noqa: E402

OUT_FIELDS = ("PID,OWNER1,OWNER2,MAIL_ST_NO,MAIL_ST_NAME,MAIL_ST_TYPE,MAIL_2ND_ADDR,"
              "MAIL_CITY,MAIL_STATE,MAIL_ZIP,RECORDED_DATE,SALE_PRICE,"
              "PROP_ST_NO,PROP_ST_NAME,PROP_TYPE,PROP_CITY,CLASS_CODE,ACREAGE")

STAGING_PARCEL_COLS = (
    "apn,owner,own_addr,own_city,own_state,own_zip,own_date_ms,sale_price,"
    "prop_addr,prop_city,prop_zip,lu_code,lu_desc,acres,totl_appr,totl_assd,geom,raw"
)
STAGING_PARCEL_TMPL = ("(" + ",".join(["%s"] * 16) +
                       ",ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))),%s)")

_CODE_RE = re.compile(r"^\s*(\d+)")


from lib.ingest_base import coerce_ms as _coerce_ms  # shared coercer (HEALTH_AUDIT §C1)


def _clean(v):
    return v.strip() if isinstance(v, str) else v


def _code_prefix(class_code: str | None) -> str | None:
    """'304 - MFG/INDUST' -> '304'."""
    if not class_code:
        return None
    m = _CODE_RE.match(class_code)
    return m.group(1) if m else None


def _join(*parts) -> str | None:
    out = " ".join(str(p).strip() for p in parts if p not in (None, "") and str(p).strip())
    return out or None


def _st_no(v) -> str | None:
    """Situs street number, dropping the assessor '0' placeholder used for unaddressed parcels
    (e.g. '0 SOUTH MORGANS POINT RD' -> 'SOUTH MORGANS POINT RD')."""
    s = (str(v).strip() if v is not None else "")
    return None if s in ("", "0") else s


def fetch_parcels(job: JobRun) -> int:
    """Land industrial-band parcels (with geometry) into staging_parcels. CLASS_CODE is the
    '<code> - <label>' string, so we filter on the code prefix and store just the code."""
    where = " OR ".join(f"CLASS_CODE LIKE '{c}%'" for c in industrial_codes())
    rows, seen = [], set()
    for feat in arcgis.query(
        sources()["parcels"], where=where, out_fields=OUT_FIELDS,
        geojson=True, return_geometry=True, page_size=1000,
    ):
        a = feat.get("properties", {})
        geom = feat.get("geometry")
        apn = _clean(a.get("PID"))
        if not apn:
            job.fail("missing PID", ref=str(a.get("OBJECTID")))
            continue
        if geom is None:
            job.fail("no geometry", ref=apn)
            continue
        if apn in seen:
            continue
        seen.add(apn)
        rows.append((
            apn, _clean(a.get("OWNER1")),
            _join(a.get("MAIL_ST_NO"), a.get("MAIL_ST_NAME"), a.get("MAIL_ST_TYPE"),
                  a.get("MAIL_2ND_ADDR")),
            _clean(a.get("MAIL_CITY")), (_clean(a.get("MAIL_STATE")) or "").upper() or None,
            _clean(a.get("MAIL_ZIP")),
            _coerce_ms(a.get("RECORDED_DATE")), a.get("SALE_PRICE"),
            _join(_st_no(a.get("PROP_ST_NO")), a.get("PROP_ST_NAME"), a.get("PROP_TYPE")),
            _clean(a.get("PROP_CITY")), None,
            _code_prefix(a.get("CLASS_CODE")), _clean(a.get("CLASS_CODE")),
            a.get("ACREAGE"), None, None,                # acres, totl_appr(NULL), totl_assd
            json.dumps(geom), json.dumps(a),
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
        cur.execute("TRUNCATE staging_building_chars")
    print(f"  parcels staged: {len(rows)}")
    return len(rows)


def promote() -> None:
    """staging -> parcels + properties. building_sf filled by the footprint proxy (PID join);
    year_built + assessed_value are NULL (not published). lu_desc from the market code map."""
    codes = industrial_codes()
    with cursor() as cur:
        cur.execute("""
            INSERT INTO parcels (apn, geom, situs_address, land_sf, land_use_code,
                                 land_use_desc, last_seen_at)
            SELECT apn, geom, prop_addr,
                   ROUND((ST_Area(geom::geography)*10.7639)::numeric, 0),
                   lu_code, NULL, now()
            FROM staging_parcels
            ON CONFLICT (apn) DO UPDATE SET
              geom=EXCLUDED.geom, situs_address=EXCLUDED.situs_address,
              land_sf=EXCLUDED.land_sf, land_use_code=EXCLUDED.land_use_code, last_seen_at=now()
        """)
        n_parcels = cur.rowcount
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
              NULL::int,                                  -- year_built: not published
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN to_timestamp(s.own_date_ms/1000.0)::date END,
              NULLIF(s.sale_price, 0),
              NULL::numeric,                              -- assessed_value: total appraisal not in mirror
              CASE WHEN s.own_date_ms IS NOT NULL
                   THEN ROUND(((extract(epoch from now()) - s.own_date_ms/1000.0)
                               / 31557600.0)::numeric, 1) END,
              'proxy', now()
            FROM staging_parcels s
            ON CONFLICT (apn) DO UPDATE SET
              last_sale_date=EXCLUDED.last_sale_date, last_sale_price=EXCLUDED.last_sale_price,
              hold_years=EXCLUDED.hold_years, sf_confidence='proxy', last_seen_at=now()
        """)
        n_props = cur.rowcount

        cur.execute("""
            UPDATE parcels SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
            WHERE NOT ST_IsValid(geom)
        """)
    print(f"  promoted: parcels~{n_parcels}, properties~{n_props}")


def compute_footprint_sf(job: JobRun) -> None:
    """Footprint proxy by DIRECT PID key join (no spatial op needed): pull the building outlines
    whose PID is one of our parcels, SUM `area` per PID, and fill building_sf / _largest / _count."""
    fp_url = sources()["building_footprints"]
    with cursor(commit=False) as cur:
        cur.execute("SELECT apn FROM parcels")
        pids = [r[0] for r in cur.fetchall()]
    if not pids:
        return

    agg: dict[str, list] = defaultdict(lambda: [0.0, 0.0, 0])   # pid -> [sum, max, count]
    for feat in arcgis.query_by_in(
        fp_url, "PID", pids, out_fields="PID,area", batch=200, page_size=2000,
    ):
        a = feat.get("attributes", {})
        pid, area = (a.get("PID") or "").strip(), a.get("area")
        if not pid or area in (None, 0):
            continue
        rec = agg[pid]
        rec[0] += float(area); rec[1] = max(rec[1], float(area)); rec[2] += 1

    updates = [(round(s, 0), round(mx, 0), cnt, pid) for pid, (s, mx, cnt) in agg.items()]
    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            "UPDATE properties AS pr SET building_sf=v.bsf, building_sf_largest=v.largest, "
            "building_count=v.cnt FROM (VALUES %s) AS v(bsf, largest, cnt, apn) "
            "WHERE pr.apn = v.apn",
            updates, page_size=500,
        )
    print(f"  footprints summed on {len(updates)} parcels (PID key join)")
    job.ok(len(updates))


def main() -> int:
    print("pull_parcels_charleston: fetching Charleston County industrial parcels ...")
    with JobRun("pull_parcels_charleston") as job:
        n = fetch_parcels(job)
        if not n:
            raise RuntimeError("no parcels fetched — check endpoint / CLASS_CODE filter")
        promote()
        print("  computing footprint-proxy building_sf (PID join) ...")
        compute_footprint_sf(job)
        print(f"  job: {job.ok_count} ok, {job.fail_count} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
