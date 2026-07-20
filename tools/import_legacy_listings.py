#!/usr/bin/env python3
"""
Recover the pre-override EasyBay listings and load the still-relevant ones into
the deployed sourcing console.

Reads ../../general-scraping/backend/live_listings.db (the old tool's DB — the
same records that ran on Railway before the July-1 repo override), checks each
listing_url is still live on the brokerage site, and POSTs the survivors to the
console's authed bulk-import endpoint (/api/live/import, mark_cached=1 so the
UI badges them and a future force-refresh re-verifies them).

No PII printed; no PII committed — the DB stays gitignored, rows travel only to
the authed server.

Usage:
  python3 tools/import_legacy_listings.py --check            # report only
  python3 tools/import_legacy_listings.py --upload URL       # check + upload
      (reads the password from SOURCING_PASSWORD env)
"""
from __future__ import annotations
import argparse
import concurrent.futures as cf
import json
import os
import sqlite3
import sys
import urllib.request
from pathlib import Path

DB = Path(__file__).resolve().parent.parent.parent / "general-scraping/backend/live_listings.db"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
FIELDS = ["source", "listing_url", "address", "total_sf", "building_type",
          "clear_height", "office_pct", "zoning", "power", "loading_docks",
          "grade_doors", "sprinklered", "parking_ratio", "truck_court_depth",
          "occupancy_pct", "walt", "asking_price_psf",
          "broker_name", "broker_email", "broker_phone", "broker_cell",
          "score_category", "scoring_reason", "lat", "lng"]


def check_url(url: str) -> str:
    """alive | redirected | dead | error"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            final = r.geturl()
            if r.status != 200:
                return "dead"
            # 200 but bounced to a search/home page = listing gone
            from urllib.parse import urlparse
            a, b = urlparse(url), urlparse(final)
            if b.path in ("", "/") or (a.path.rstrip("/") not in (b.path.rstrip("/"),) and len(b.path) < 12):
                return "redirected"
            return "alive"
    except urllib.error.HTTPError as e:
        return "dead" if e.code in (404, 410) else "error"
    except Exception:
        return "error"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--upload", metavar="BASE_URL")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("SELECT * FROM listings WHERE listing_url IS NOT NULL")]
    con.close()
    if args.limit:
        rows = rows[: args.limit]
    print(f"{len(rows)} legacy listings in {DB.name}")

    with cf.ThreadPoolExecutor(10) as ex:
        verdicts = list(ex.map(lambda r: check_url(r["listing_url"]), rows))
    by = {}
    for v in verdicts:
        by[v] = by.get(v, 0) + 1
    print("relevance:", json.dumps(by))
    by_src = {}
    for r, v in zip(rows, verdicts):
        if v == "alive":
            by_src[r["source"]] = by_src.get(r["source"], 0) + 1
    print("alive by source:", json.dumps(by_src))

    if not args.upload:
        return
    password = os.environ.get("SOURCING_PASSWORD", "")
    if not password:
        sys.exit("set SOURCING_PASSWORD to upload")
    keep = [{f: r.get(f) for f in FIELDS} for r, v in zip(rows, verdicts) if v == "alive"]
    print(f"uploading {len(keep)} alive listings…")
    for i in range(0, len(keep), 50):
        chunk = keep[i : i + 50]
        body = json.dumps({"password": password, "listings": chunk, "mark_cached": True}).encode()
        req = urllib.request.Request(
            args.upload.rstrip("/") + "/api/live/import",
            data=body, headers={"Content-Type": "application/json", "User-Agent": UA}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            print(f"  chunk {i // 50 + 1}: {r.read().decode()}")


if __name__ == "__main__":
    main()
