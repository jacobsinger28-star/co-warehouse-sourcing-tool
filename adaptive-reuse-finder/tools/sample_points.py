#!/usr/bin/env python3
"""
sample_points.py — turn an area into a list of Street View "stops" to classify.

Given a bounding box, pull the road network from Overpass (OpenStreetMap), drop a point
every N metres along each road, and for each point emit TWO views — one facing each side
of the street (road bearing ± 90°). The result is a CSV of stops that feeds
build_streetview_urls.py and the Chrome-extension runbook.

Stdlib only (urllib + math + csv) so the MVP runs anywhere with python3 — no GIS deps.

Usage:
  # An area (bbox = min_lat,min_lng,max_lat,max_lng):
  python3 sample_points.py --bbox 39.9580,-83.0120,39.9620,-83.0060 \
          --spacing 30 --area downtown_west_columbus --out ../data/areas/downtown_west_columbus.csv

  # A single coordinate (offline smoke test — no Overpass call):
  python3 sample_points.py --point 39.9601,-83.0089 --area smoke --out ../data/areas/smoke.csv

  # A single address (no geocoding here; build_streetview_urls.py emits the /maps/place/ URL):
  python3 sample_points.py --address "512 Maier Pl, Columbus, OH" --area smoke --out ../data/areas/smoke.csv

CSV columns: area, source, street_name, lat, lng, road_bearing, heading, side, address
"""
import argparse
import csv
import json
import math
import os
import sys
import urllib.parse
import urllib.request

DEFAULT_OVERPASS = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")

# Road classes that have building frontage worth viewing. Everything else (motorways,
# footpaths, tracks, …) is excluded so we don't sample highway shoulders or trails.
EXCLUDED_HIGHWAY = {
    "motorway", "motorway_link", "trunk", "trunk_link", "footway", "path",
    "cycleway", "steps", "pedestrian", "bridleway", "track", "raceway",
    "bus_guideway", "escape", "corridor", "construction", "proposed",
}


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres."""
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Initial bearing from point 1 to point 2, degrees clockwise from North in [0, 360)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def interpolate_along(coords, spacing_m):
    """Walk a polyline of (lat, lon) and return (lat, lon, segment_bearing) every spacing_m.

    Samples are placed at cumulative distances 0, spacing, 2·spacing, … along the WHOLE
    polyline (so spacing carries across vertices, not resetting per segment). The bearing is
    that of the segment the sample sits on, so a perpendicular (±90°) faces the frontage.
    """
    if not coords:
        return []
    if len(coords) == 1:
        return [(coords[0][0], coords[0][1], 0.0)]

    # Cumulative distance at each vertex + the bearing of each segment.
    cum = [0.0]
    brgs = []
    for (la1, lo1), (la2, lo2) in zip(coords, coords[1:]):
        cum.append(cum[-1] + haversine_m(la1, lo1, la2, lo2))
        brgs.append(bearing_deg(la1, lo1, la2, lo2))
    total = cum[-1]

    out = []
    seg_idx = 0
    k = 0
    while k * spacing_m <= total + 1e-9:
        t = k * spacing_m
        while seg_idx < len(brgs) and cum[seg_idx + 1] < t - 1e-9:
            seg_idx += 1
        i = min(seg_idx, len(brgs) - 1)
        seg_len = cum[i + 1] - cum[i]
        f = 0.0 if seg_len == 0 else (t - cum[i]) / seg_len
        la1, lo1 = coords[i]
        la2, lo2 = coords[i + 1]
        out.append((la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f, brgs[i]))
        k += 1
    return out


def query_overpass(bbox, url, timeout=90):
    """Return a list of ways: [{"name": str|None, "geometry": [(lat, lon), ...]}]."""
    min_lat, min_lng, max_lat, max_lng = bbox
    q = (
        "[out:json][timeout:60];\n"
        f'way["highway"]({min_lat},{min_lng},{max_lat},{max_lng});\n'
        "out geom;"
    )
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": "adaptive-reuse-finder/0.1 (SimiCapital internal tool)"
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    ways = []
    for el in payload.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        if el.get("tags", {}).get("highway") in EXCLUDED_HIGHWAY:
            continue
        geom = [(g["lat"], g["lon"]) for g in el["geometry"]]
        ways.append({"name": el.get("tags", {}).get("name"), "geometry": geom})
    return ways


def stops_from_ways(ways, spacing_m, area):
    """Expand ways into deduped left/right facing stops."""
    seen = set()
    rows = []
    for w in ways:
        name = w["name"] or ""
        for lat, lon, brg in interpolate_along(w["geometry"], spacing_m):
            key = (round(lat, 5), round(lon, 5))  # ~1 m dedup across overlapping ways
            if key in seen:
                continue
            seen.add(key)
            for side, off in (("right", 90.0), ("left", -90.0)):
                rows.append({
                    "area": area, "source": "overpass", "street_name": name,
                    "lat": f"{lat:.6f}", "lng": f"{lon:.6f}",
                    "road_bearing": f"{brg:.1f}", "heading": f"{(brg + off) % 360:.1f}",
                    "side": side, "address": "",
                })
    return rows


def write_csv(rows, out_path):
    fields = ["area", "source", "street_name", "lat", "lng",
              "road_bearing", "heading", "side", "address"]
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--bbox", help="min_lat,min_lng,max_lat,max_lng")
    src.add_argument("--point", help="lat,lng  (single offline stop, no Overpass call)")
    src.add_argument("--address", help="a street address (no geocoding; uses /place/ URL later)")
    ap.add_argument("--area", required=True, help="short name/label for this area")
    ap.add_argument("--out", required=True, help="output CSV path")
    ap.add_argument("--spacing", type=float, default=30.0, help="metres between samples (default 30)")
    ap.add_argument("--overpass-url", default=DEFAULT_OVERPASS)
    args = ap.parse_args(argv)

    if args.point:
        try:
            lat, lng = (float(x) for x in args.point.split(","))
        except ValueError:
            ap.error("--point must be 'lat,lng'")
        rows = [{"area": args.area, "source": "point", "street_name": "", "lat": f"{lat:.6f}",
                 "lng": f"{lng:.6f}", "road_bearing": "", "heading": "", "side": "", "address": ""}]
    elif args.address:
        rows = [{"area": args.area, "source": "address", "street_name": "", "lat": "", "lng": "",
                 "road_bearing": "", "heading": "", "side": "", "address": args.address}]
    else:
        try:
            bbox = tuple(float(x) for x in args.bbox.split(","))
            assert len(bbox) == 4
        except (ValueError, AssertionError):
            ap.error("--bbox must be 'min_lat,min_lng,max_lat,max_lng'")
        try:
            ways = query_overpass(bbox, args.overpass_url)
        except Exception as e:  # noqa: BLE001 — surface a clear operator message
            print(f"ERROR: Overpass query failed ({e}).\n"
                  f"  Check connectivity, the bbox, or try --overpass-url with a mirror.",
                  file=sys.stderr)
            return 2
        if not ways:
            print("ERROR: no roads returned for that bbox — is it tiny or off-land?", file=sys.stderr)
            return 2
        rows = stops_from_ways(ways, args.spacing, args.area)

    write_csv(rows, args.out)
    n_stops = len(rows)
    n_pts = len({(r["lat"], r["lng"]) for r in rows if r["lat"]})
    print(f"Wrote {n_stops} stops"
          + (f" ({n_pts} points × 2 sides)" if args.bbox else "")
          + f" → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
