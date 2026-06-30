#!/usr/bin/env python3
"""
fetch_images.py — STUB (Day 6 deliverable, not yet implemented).

Will fetch 2 Street View headings + 1 aerial per top-200 property, disk-cached by
APN (never re-fetch). Real implementation lands when GOOGLE_MAPS_API_KEY exists to
test against — an untested imagery module is worse than an honest stub.

Exits 0 when unconfigured so `make refresh` stays green end-to-end today.
"""
import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=200)
    ap.parse_args()
    if not os.environ.get("GOOGLE_MAPS_API_KEY"):
        print("fetch_images: GOOGLE_MAPS_API_KEY not set — skipping (stub). "
              "Imagery is Day-6 scope; see docs/BUILD_LOG.md.")
        sys.exit(0)
    print("fetch_images: key present but module not implemented yet — "
          "implement before relying on imagery.", file=sys.stderr)
    sys.exit(1)
