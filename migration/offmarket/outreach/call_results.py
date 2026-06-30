#!/usr/bin/env python3
"""
call_results.py — ingest AI-call outcomes back into outreach_log.

The dialer returns each call's result (disposition, transcript, recording, duration) either
via webhook or a results export. This reads a results file (JSON list or CSV), normalizes
each payload through the active provider's parse_result(), and updates the matching
outreach_log row we created in place_calls.py.

Matching, in order:
  1. provider + provider_call_id   (the id we stored when we placed the call)
  2. fall back to the most-recent pending row for (contact_id, apn)

Idempotent: re-importing the same file re-applies the same outcome (matched by call id).
A 'do_not_contact' outcome is honored permanently by place_calls.py's suppression query.

    python outreach/call_results.py --file exports/call_results.json
    CALL_PROVIDER=bland python outreach/call_results.py --file results.json
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402
from outreach.call_provider import WARM, CallOutcome, get_provider  # noqa: E402


def load_payloads(path: Path) -> list[dict]:
    """Read a results file. JSON: an object list (or {"results"/"calls": [...]}). CSV: rows."""
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("results") or data.get("calls") or data.get("data") or []
        return list(data)
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def apply_outcome(cur, prov_name: str, o: CallOutcome) -> str:
    """Update the matching outreach_log row. Returns 'updated' | 'matched_fallback' | 'no_match'."""
    # Note marker is appended once and only once (idempotent on re-import).
    marker = f"vendor outcome: {o.raw_disposition}" if o.raw_disposition else None
    if o.provider_call_id:
        cur.execute(
            """
            UPDATE outreach_log SET
              disposition = %s,
              transcript = COALESCE(%s, transcript),
              recording_url = COALESCE(%s, recording_url),
              duration_seconds = COALESCE(%s, duration_seconds),
              occurred_at = COALESCE(%s, occurred_at),
              notes = CASE WHEN %s IS NULL THEN notes
                           WHEN notes LIKE '%%' || %s || '%%' THEN notes
                           ELSE COALESCE(notes || ' · ', '') || %s END
            WHERE provider = %s AND provider_call_id = %s
            RETURNING log_id
            """,
            (o.disposition, o.transcript, o.recording_url, o.duration_seconds,
             o.occurred_on, marker, marker, marker,
             prov_name, o.provider_call_id))
        if cur.fetchone():
            return "updated"
    # Fallback: newest pending row for this contact + property.
    if o.contact_id and o.apn:
        cur.execute(
            """
            UPDATE outreach_log SET
              disposition = %s, transcript = COALESCE(%s, transcript),
              recording_url = COALESCE(%s, recording_url),
              duration_seconds = COALESCE(%s, duration_seconds),
              provider = COALESCE(provider, %s), provider_call_id = COALESCE(provider_call_id, %s)
            WHERE log_id = (
              SELECT log_id FROM outreach_log
              WHERE contact_id = %s AND apn = %s AND disposition = 'pending'
              ORDER BY log_id DESC LIMIT 1)
            RETURNING log_id
            """,
            (o.disposition, o.transcript, o.recording_url, o.duration_seconds,
             prov_name, o.provider_call_id, o.contact_id, o.apn))
        if cur.fetchone():
            return "matched_fallback"
    return "no_match"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--provider", default=None, help="override CALL_PROVIDER")
    args = ap.parse_args()
    path = Path(args.file)
    if not path.exists():
        print(f"call_results: {path} not found"); return 1

    provider = get_provider(args.provider)
    payloads = load_payloads(path)
    print(f"  provider: {provider.name}  ·  {len(payloads)} result(s) in {path.name}")

    counts = {"updated": 0, "matched_fallback": 0, "no_match": 0}
    warm: list[CallOutcome] = []
    with JobRun("call_results") as job:
        with cursor() as cur:
            for p in payloads:
                o = provider.parse_result(p)
                status = apply_outcome(cur, provider.name, o)
                counts[status] += 1
                if status == "no_match":
                    job.fail("could not match to a placed call", ref=o.provider_call_id)
                else:
                    job.ok()
                    if o.disposition in WARM:
                        warm.append(o)

    print(f"  outcomes applied: updated={counts['updated']} "
          f"fallback={counts['matched_fallback']} no_match={counts['no_match']}")
    if warm:
        print(f"  🔥 {len(warm)} WARM lead(s) (conversation/meeting_set) — run "
              f"`make pipedrive-sync` to push the follow-up task + `make call-queue` for the dial list")
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT disposition, count(*) n FROM outreach_log "
                    "WHERE provider IS NOT NULL GROUP BY disposition ORDER BY n DESC")
        dist = cur.fetchall()
    if dist:
        print("  call-log dispositions: " + ", ".join(f"{r['disposition']}={r['n']}" for r in dist))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
