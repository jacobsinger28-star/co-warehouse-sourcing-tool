#!/usr/bin/env python3
"""
vlm_score.py — STUB (Day 7 deliverable, not yet implemented).

Will run Claude vision over cached site imagery using the JSON schema in
prompts/vlm_site_assessment.md (structured output, not_visible allowed, raw JSON
stored, schema-invalid responses rejected and logged). Requires ANTHROPIC_API_KEY
and the Day-7 25-row founder audit before its outputs are trusted.

Exits 0 when unconfigured so `make refresh` stays green end-to-end today.
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("vlm_score: ANTHROPIC_API_KEY not set — skipping (stub). "
              "VLM scoring is Day-7 scope; see docs/BUILD_LOG.md.")
        sys.exit(0)
    print("vlm_score: key present but module not implemented yet — "
          "implement + run the 25-row audit before trusting physical-fit scores.",
          file=sys.stderr)
    sys.exit(1)
