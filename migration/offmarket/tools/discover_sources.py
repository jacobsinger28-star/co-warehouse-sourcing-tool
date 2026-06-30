#!/usr/bin/env python3
"""
Re-run Day-1 source discovery against the live ArcGIS endpoints.

Prints, for each confirmed source: layer name, field list, record count, and (for
parcels) the distinct industrial land-use codes. Use this to refresh DATA_NOTES.md
or to detect when Metro Nashville changes a schema out from under us.

    python tools/discover_sources.py
    python tools/discover_sources.py --fields-only

No DB, no API key — read-only public ArcGIS REST. Safe to run anytime.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import sources as S  # noqa: E402

TIMEOUT = 40


def _get(url: str, params: dict) -> dict:
    params = {**params, "f": "json"}
    r = requests.get(url, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(f"ArcGIS error for {url}: {data['error']}")
    return data


def describe_layer(name: str, url: str) -> None:
    print(f"\n=== {name} ===\n{url}")
    meta = _get(url, {})
    print(f"  layer: {meta.get('name')} | maxRecordCount: {meta.get('maxRecordCount')}"
          f" | geom: {meta.get('geometryType')}")
    for fld in meta.get("fields", []):
        t = fld["type"].replace("esriFieldType", "")
        print(f"    {fld['name']:<28} {t:<10} {fld.get('alias', '')}")


def count(url: str, where: str = "1=1") -> int:
    return _get(url + "/query", {"where": where, "returnCountOnly": "true"}).get("count", -1)


def distinct_industrial_land_use() -> None:
    print("\n=== Distinct industrial-band LUCode/LUDesc (ownership parcels) ===")
    where = ("LUDesc LIKE '%WAREHOUSE%' OR LUDesc LIKE '%WARHOUSE%' OR "
             "LUDesc LIKE '%INDUSTRIAL%' OR LUDesc LIKE '%MANUF%' OR "
             "LUDesc LIKE '%DISTRIB%' OR LUDesc LIKE '%FLEX%' OR LUDesc LIKE '%TERMINAL%'")
    data = _get(S.PARCELS_OWNERSHIP + "/query", {
        "where": where, "outFields": "LUCode,LUDesc",
        "returnGeometry": "false", "returnDistinctValues": "true",
        "orderByFields": "LUCode",
    })
    for f in data.get("features", []):
        a = f["attributes"]
        print(f"    {a.get('LUCode',''):<6} {a.get('LUDesc','')}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fields-only", action="store_true", help="skip counts (faster)")
    args = ap.parse_args()

    layers = [
        ("Ownership parcels", S.PARCELS_OWNERSHIP),
        ("Building characteristics (CAMA)", S.PARCELS_BUILDING_CHARACTERISTICS),
        ("Property Standards Violations", S.PROPERTY_STANDARDS_VIOLATIONS),
        ("Building Permits Issued", S.BUILDING_PERMITS_ISSUED),
    ]
    for name, url in layers:
        try:
            describe_layer(name, url)
        except Exception as e:  # noqa: BLE001 — discovery tool, surface and continue
            print(f"  !! FAILED: {e}")

    if not args.fields_only:
        try:
            distinct_industrial_land_use()
            print("\n=== Counts ===")
            ind_where = "LUCode IN ('064','077','071','072','070')"
            n_parcels = count(S.PARCELS_OWNERSHIP, ind_where)
            n_big = count(S.PARCELS_BUILDING_CHARACTERISTICS, "FinishedArea>=75000")
            print(f"  industrial-band parcels (LUCode 064/077/071/072/070): {n_parcels}")
            print(f"  CAMA building rows >= 75k SF: {n_big}")
        except Exception as e:  # noqa: BLE001
            print(f"  !! counts FAILED: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
