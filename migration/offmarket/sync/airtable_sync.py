#!/usr/bin/env python3
"""
airtable_sync.py — STUB (Day 8 deliverable, not yet implemented).

Will push the top 150 (score + component breakdown + evidence links) to the
founder's Airtable board and pull A/B/C grades + statuses back into
scores.grade_human. Requires AIRTABLE_API_KEY / AIRTABLE_BASE_ID.

Exits 0 when unconfigured so `make refresh` stays green end-to-end today.
"""
import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--push-top", type=int, default=None)
    ap.add_argument("--pull-grades", action="store_true")
    ap.parse_args()
    if not (os.environ.get("AIRTABLE_API_KEY") and os.environ.get("AIRTABLE_BASE_ID")):
        print("airtable_sync: AIRTABLE_API_KEY/AIRTABLE_BASE_ID not set — skipping "
              "(stub). Airtable board is Day-8 scope; see docs/BUILD_LOG.md.")
        sys.exit(0)
    print("airtable_sync: keys present but module not implemented yet.", file=sys.stderr)
    sys.exit(1)
