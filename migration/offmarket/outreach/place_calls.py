#!/usr/bin/env python3
"""
place_calls.py — hand the ranked call queue to an AI dialer (vendor-agnostic).

One call per OWNING ENTITY (its best-confidence contact, about its top-scored property),
mirroring how skiptrace_export / call_sheets dedupe to the portfolio level. The actual
vendor is resolved at runtime by outreach/call_provider.get_provider() — defaults to the
no-network `stub` so this runs and is testable before a dialer is chosen.

COMPLIANCE GATE (enforced, not optional — AI calls to skip-traced cell numbers carry
TCPA + state AI-disclosure exposure):
  * dnc_checked must be TRUE — a number not scrubbed against Do-Not-Call is SKIPPED.
    `--allow-unscrubbed` overrides for dev/testing only, with a loud warning.
  * any owner with a prior `do_not_contact` disposition is dropped, permanently.
  * a contact already reached (any non-'pending' disposition) is not re-dialed
    (override with `--recall`).
  * every script carries a required AI-disclosure line (build_script()).

Dry-run by DEFAULT (prints the plan, writes nothing, dials nothing). Pass `--commit` to
actually place calls and log a 'pending' outreach_log row per call (which call_results.py
later updates with the outcome).

    python outreach/place_calls.py --grade A                 # dry-run the A-tier queue
    python outreach/place_calls.py --top 25 --commit         # place 25 calls (stub by default)
    CALL_PROVIDER=bland python outreach/place_calls.py --top 25 --commit
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402
from outreach.call_provider import CallTask, get_provider  # noqa: E402

# One row per owning entity: best-confidence contact (with a phone), the entity's
# top-scored property, and the facts the call script needs.
TARGETS_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (apn) apn, total, grade_human
  FROM scores WHERE version LIKE '%-final'
  ORDER BY apn, scored_at DESC
),
ent AS (
  SELECT e.entity_id, e.name_raw, e.entity_type, e.portfolio_group_id,
         max(l.total) AS best_score,
         -- grade of the TOP-scored parcel (NOT max('A','B','C')='C', which would
         -- label an entity by its WORST letter and make --grade A under-select).
         (array_agg(l.grade_human ORDER BY l.total DESC NULLS LAST))[1] AS grade,
         (array_agg(o.apn ORDER BY l.total DESC NULLS LAST))[1] AS top_apn
  FROM entities e
  JOIN ownerships o USING (entity_id)
  JOIN latest l ON l.apn = o.apn
  WHERE l.total IS NOT NULL
  GROUP BY e.entity_id
),
best_contact AS (
  SELECT DISTINCT ON (entity_id)
         contact_id, entity_id, person_name, phones, emails, source,
         confidence, dnc_checked
  FROM contacts
  WHERE array_length(phones, 1) > 0
  ORDER BY entity_id,
           CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2
                           WHEN 'low' THEN 1 ELSE 0 END DESC,
           contact_id
)
SELECT ent.entity_id, ent.name_raw, ent.entity_type, ent.best_score, ent.grade,
       ent.top_apn,
       c.contact_id, c.person_name, c.phones, c.emails, c.confidence, c.dnc_checked,
       p.situs_address, p.land_use_desc,
       pr.building_sf, pr.year_built, pr.distance_miles_icbd, pr.hold_years
FROM ent
JOIN best_contact c ON c.entity_id = ent.entity_id
JOIN parcels p ON p.apn = ent.top_apn
LEFT JOIN properties pr ON pr.apn = ent.top_apn
ORDER BY ent.best_score DESC
"""


def fmt(n) -> str:
    return "—" if n is None else f"{float(n):,.0f}"


def signals_for(apn: str) -> list[dict]:
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT type, detail, event_date, source_ref FROM distress_signals "
            "WHERE apn = %s ORDER BY event_date DESC NULLS LAST", (apn,))
        return cur.fetchall()


def load_suppressions() -> tuple[set[int], set[int]]:
    """Return (contacts_already_reached, contacts_marked_do_not_contact).

    do_not_contact suppresses by both contact_id AND every contact of the same entity
    (a person who said 'remove me' shouldn't be re-dialed via a sibling number).
    """
    reached: set[int] = set()
    dnc: set[int] = set()
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT contact_id, disposition FROM outreach_log "
            "WHERE contact_id IS NOT NULL")
        rows = cur.fetchall()
        cur.execute(
            "SELECT DISTINCT c.contact_id FROM outreach_log ol "
            "JOIN contacts c0 ON c0.contact_id = ol.contact_id "
            "JOIN contacts c ON c.entity_id = c0.entity_id "
            "WHERE ol.disposition = 'do_not_contact'")
        dnc = {r["contact_id"] for r in cur.fetchall()}
    for r in rows:
        if r["disposition"] and r["disposition"] != "pending":
            reached.add(r["contact_id"])
    return reached, dnc


def build_script(t: dict, signals: list[dict]) -> dict:
    """Structured brief the AI agent speaks from. NOTHING here is asserted as fact without
    being in our data; the agent is told to verify, not claim. Opens with AI disclosure."""
    company = os.environ.get("OUTREACH_COMPANY_NAME", "[your company]")
    callback = os.environ.get("OUTREACH_CALLBACK_NUMBER", "")
    addr = t["situs_address"] or "your property"
    reasons = [f"{s['type'].replace('_', ' ')}"
               + (f" ({s['event_date']})" if s.get("event_date") else "")
               for s in signals[:3]]
    return {
        # Required AI-disclosure opener. Several US states mandate disclosing that the
        # caller is an automated/AI system — keep this first, always.
        "disclosure": (f"Hi, this is an automated assistant calling on behalf of {company}. "
                       f"I'm an AI — happy to connect you with a person if you'd prefer."),
        "to": f"{t['person_name'] or t['name_raw']}",
        "about_property": addr,
        "facts": {
            "building_sf": fmt(t["building_sf"]),
            "year_built": t["year_built"] or "unknown",
            "owner_on_title": t["name_raw"],
            "hold_years": fmt(t["hold_years"]),
        },
        # Why we're calling — internal context for tone, NOT to be recited to the owner.
        "context_signals": reasons or ["ranked on owner profile / location / vintage"],
        "objectives": [
            "Confirm we're speaking with the owner / a decision-maker.",
            "Gauge willingness to sell or lease the building.",
            "Confirm occupancy/vacancy and rough clear height.",
            "If interested: capture a callback time for a human follow-up.",
        ],
        "callback_number": callback,
        "do_not": "Do not state any figure as confirmed fact; ask and verify on the call.",
    }


def classify_contact(row, *, reached, dnc_suppressed,
                     allow_unscrubbed: bool = False, recall: bool = False) -> str:
    """PURE compliance/eligibility decision for one targeting row (no I/O, unit-testable).

    Returns 'eligible' or a skip reason: 'do_not_contact' | 'already_reached' | 'no_phone'
    | 'dnc_not_checked'. DNC is FAIL-CLOSED — a contact whose number is not dnc_checked is
    SKIPPED unless allow_unscrubbed is explicitly passed (TCPA exposure; ledger #5 /
    HEALTH_AUDIT §D1). Order is load-bearing: do-not-contact and already-reached take
    precedence over the DNC skip so suppression is never silently overridden."""
    if row["contact_id"] in dnc_suppressed:
        return "do_not_contact"
    if row["contact_id"] in reached and not recall:
        return "already_reached"
    if not (row.get("phones") or []):
        return "no_phone"
    if not row.get("dnc_checked") and not allow_unscrubbed:
        return "dnc_not_checked"
    return "eligible"


DEFAULT_HARD_CAP = 100   # max real calls per run without an explicit --max ceiling


def preflight_guard(*, n_eligible, provider_name, committed, max_override,
                    allow_unscrubbed, second_confirm, hard_cap=DEFAULT_HARD_CAP):
    """PURE safety gate for a COMMITTED run against a REAL (non-stub) dialer. Returns a list
    of fatal reasons (empty = OK to dial). Dry-runs and the no-network 'stub' provider are
    never gated — they place no real calls. HEALTH_AUDIT §D1: no run may dial an unbounded
    number of real calls (require an explicit --max past the cap), and --allow-unscrubbed
    (TCPA exposure) must take a second explicit confirmation before any real vendor dials."""
    reasons: list[str] = []
    if not committed or provider_name == "stub":
        return reasons
    if max_override is None and n_eligible > hard_cap:
        reasons.append(
            f"{n_eligible} eligible calls exceeds the {hard_cap}-call safety cap. Pass "
            f"--max N to set an explicit per-run ceiling before dialing a real vendor.")
    if allow_unscrubbed and not second_confirm:
        reasons.append(
            "--allow-unscrubbed dials numbers NOT scrubbed against Do-Not-Call (TCPA risk). "
            "Re-run with --yes-dial-unscrubbed to confirm you accept that.")
    return reasons


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grade", choices=("A", "B", "C"), default=None)
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--max", type=int, default=None, help="hard cap on calls placed")
    ap.add_argument("--provider", default=None, help="override CALL_PROVIDER")
    ap.add_argument("--commit", action="store_true",
                    help="actually place calls + log them (default: dry-run)")
    ap.add_argument("--allow-unscrubbed", action="store_true",
                    help="DEV ONLY: dial numbers not DNC-checked (logs a warning)")
    ap.add_argument("--recall", action="store_true",
                    help="re-dial contacts already reached (default: skip them)")
    ap.add_argument("--min-delay", type=float, default=6.0,
                    help="min seconds between real calls (rate limit; non-stub commits only)")
    ap.add_argument("--yes-dial-unscrubbed", action="store_true",
                    help="second confirmation required by --allow-unscrubbed before a real run")
    args = ap.parse_args()

    provider = get_provider(args.provider)
    print(f"  provider: {provider.name}"
          + ("  (DRY RUN — no calls placed, nothing written)" if not args.commit else ""))

    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(TARGETS_SQL)
        rows = cur.fetchall()

    # Grade-or-top selection, identical convention to skiptrace_export / call_sheets.
    if args.grade:
        graded = [r for r in rows if r["grade"] == args.grade]
        if graded:
            rows = graded
            print(f"  filtering to grade {args.grade}: {len(rows)} owners")
        else:
            print(f"  !! no '{args.grade}'-graded owners yet — falling back to top {args.top}")
            rows = rows[: args.top]
    else:
        rows = rows[: args.top]

    reached, dnc_suppressed = load_suppressions()

    eligible: list[tuple[dict, CallTask]] = []
    skips = {"do_not_contact": 0, "dnc_not_checked": 0, "already_reached": 0, "no_phone": 0}
    for r in rows:
        verdict = classify_contact(
            r, reached=reached, dnc_suppressed=dnc_suppressed,
            allow_unscrubbed=args.allow_unscrubbed, recall=args.recall)
        if verdict != "eligible":
            skips[verdict] += 1
            continue
        script = build_script(r, signals_for(r["top_apn"]))
        task = CallTask(
            contact_id=r["contact_id"], entity_id=r["entity_id"], apn=r["top_apn"],
            to_number=(r["phones"] or [])[0], owner_name=r["name_raw"],
            person_name=r["person_name"], script=script)
        eligible.append((r, task))

    if args.max is not None:
        eligible = eligible[: args.max]

    if skips["dnc_not_checked"] and not args.allow_unscrubbed:
        print(f"  ⚠️  {skips['dnc_not_checked']} owners SKIPPED: phone not DNC-checked. "
              f"Scrub against Do-Not-Call first (sets contacts.dnc_checked). "
              f"`--allow-unscrubbed` overrides for dev only.")
    if args.allow_unscrubbed:
        print("  ⚠️  --allow-unscrubbed: dialing numbers NOT scrubbed against DNC. "
              "Do not use against real owners in production.")

    print(f"  eligible to call: {len(eligible)}  ·  skipped: "
          + ", ".join(f"{k}={v}" for k, v in skips.items() if v))

    if not args.commit:
        for r, task in eligible[:50]:
            print(f"    [{r['grade'] or '-'}] {float(r['best_score']):.0f}  "
                  f"{(r['situs_address'] or '?')[:38]:38}  → "
                  f"{(task.person_name or task.owner_name or '?')[:24]:24}  {task.to_number}")
        if len(eligible) > 50:
            print(f"    … and {len(eligible) - 50} more")
        print("  (dry-run) re-run with --commit to place these calls.")
        return 0

    fatal = preflight_guard(
        n_eligible=len(eligible), provider_name=provider.name, committed=args.commit,
        max_override=args.max, allow_unscrubbed=args.allow_unscrubbed,
        second_confirm=args.yes_dial_unscrubbed)
    if fatal:
        for reason in fatal:
            print(f"  ⛔ {reason}")
        print("  refusing to place calls (dry-run is always available without --commit).")
        return 2

    placed = 0
    with JobRun("place_calls") as job:
        with cursor() as cur:
            for r, task in eligible:
                try:
                    call_id = provider.start_call(task)
                    cur.execute(
                        """
                        INSERT INTO outreach_log
                          (apn, contact_id, channel, occurred_at, disposition,
                           provider, provider_call_id, notes)
                        VALUES (%s, %s, 'call', %s, 'pending', %s, %s, %s)
                        ON CONFLICT (provider, provider_call_id)
                          WHERE provider_call_id IS NOT NULL
                          DO UPDATE SET occurred_at = EXCLUDED.occurred_at
                        """,
                        (task.apn, task.contact_id, date.today(), provider.name,
                         call_id, f"AI call queued for {task.person_name or task.owner_name}"))
                    placed += 1
                    job.ok()
                except Exception as e:  # one bad call shouldn't sink the batch
                    job.fail(e, ref=task.apn)
                # Rate-limit real vendors (HEALTH_AUDIT §D1); the stub places no real calls.
                if provider.name != "stub" and args.min_delay > 0:
                    time.sleep(args.min_delay)
    print(f"  placed {placed}/{len(eligible)} calls via '{provider.name}' "
          f"(logged as 'pending'; run call_results.py to ingest outcomes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
