#!/usr/bin/env python3
"""
build_streetview_urls.py — turn a stops CSV (from sample_points.py) into Street View URLs
to open in the Claude-in-Chrome extension.

For each stop it prints the documented, stable Maps-URLs panorama link:
    https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG&heading=H&pitch=P&fov=F
(For address-only stops it prints the /maps/place/<address> form, which snaps to the road
frontage — the offmarket-scraping fix for interior parcels with no centroid pano.)

If GOOGLE_MAPS_API_KEY is set, it ALSO prints the V2 Static API image + free metadata URLs.
We do NOT build the /@lat,lng,3a,..y,..h,..t/data=! form — its data= blob is opaque and unstable.

Stdlib only. Usage:
  python3 build_streetview_urls.py ../data/areas/NAME.csv [--pitch 0] [--fov 80] [--limit N]
"""
import argparse
import csv
import os
import sys
import urllib.parse

PANO = "https://www.google.com/maps/@?api=1&map_action=pano"
PLACE = "https://www.google.com/maps/place/"
SV_IMG = "https://maps.googleapis.com/maps/api/streetview"
SV_META = "https://maps.googleapis.com/maps/api/streetview/metadata"


def pano_url(lat, lng, heading, pitch, fov):
    params = {"viewpoint": f"{lat},{lng}", "pitch": pitch, "fov": fov}
    if heading != "":
        params["heading"] = heading
    return f"{PANO}&{urllib.parse.urlencode(params)}"


def place_url(address):
    return PLACE + urllib.parse.quote_plus(address)


def static_urls(lat, lng, heading, pitch, fov, key):
    base = {"size": "640x640", "location": f"{lat},{lng}", "pitch": pitch,
            "fov": fov, "source": "outdoor", "key": key}
    if heading != "":
        base["heading"] = heading
    img = f"{SV_IMG}?{urllib.parse.urlencode(base)}"
    meta = f"{SV_META}?{urllib.parse.urlencode({'location': f'{lat},{lng}', 'key': key})}"
    return img, meta


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stops_csv", help="CSV produced by sample_points.py")
    ap.add_argument("--pitch", default="0")
    ap.add_argument("--fov", default="80")
    ap.add_argument("--limit", type=int, default=0, help="only the first N stops (0 = all)")
    args = ap.parse_args(argv)

    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not os.path.exists(args.stops_csv):
        print(f"ERROR: no such file: {args.stops_csv}", file=sys.stderr)
        return 2

    with open(args.stops_csv, newline="") as f:
        rows = list(csv.DictReader(f))
    if args.limit:
        rows = rows[: args.limit]

    for i, r in enumerate(rows, 1):
        label = " ".join(x for x in [r.get("street_name", ""),
                                     (r.get("side", "") + " side") if r.get("side") else ""] if x).strip()
        if r.get("source") == "address" and r.get("address"):
            print(f"[{i}] {r['address']}")
            print(f"    pano:  {place_url(r['address'])}")
        else:
            lat, lng, heading = r["lat"], r["lng"], r.get("heading", "")
            print(f"[{i}] {label or (lat + ',' + lng)}  (heading {heading or 'free'})")
            print(f"    pano:  {pano_url(lat, lng, heading, args.pitch, args.fov)}")
            if key:
                img, meta = static_urls(lat, lng, heading, args.pitch, args.fov, key)
                print(f"    img:   {img}")
                print(f"    meta:  {meta}")

    tail = "" if key else "  (set GOOGLE_MAPS_API_KEY to also emit V2 Static API + metadata URLs)"
    print(f"\n{len(rows)} stops.{tail}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
