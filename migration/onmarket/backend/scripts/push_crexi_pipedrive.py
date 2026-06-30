"""
Push Crexi buy-box brokers/listings into Pipedrive.

Scrapes the 7 buy-box markets via CrexiScraper (no browser), scores each listing,
applies a scope filter, and creates a Pipedrive deal + broker Person for each —
the same create_deal path the UI uses, with the in-market guardrail enforced.

SAFETY
------
- Defaults to --dry-run: prints exactly what WOULD be pushed and calls nothing.
- The real push (--push) creates NEW deals every run (create_deal does not dedup
  deals). Run it ONCE. Re-running creates duplicates.
- Requires PIPEDRIVE_API_TOKEN in the environment (or backend/.env). Never pass
  the token on the command line.

Scope (which listings get pushed):
  default          → buy-box: total_sf known AND 75,000–300,000 SF (highest quality)
  --include-unknown-sf  → also push listings with no stated SF (broader, noisier)
  --all            → every in-market industrial-for-sale listing (broadest)
  --limit N        → cap the number pushed (applies after scope filter)

Usage (from backend/):
  python -m scripts.push_crexi_pipedrive                 # dry-run, buy-box scope
  python -m scripts.push_crexi_pipedrive --all           # dry-run, everything
  PIPEDRIVE_API_TOKEN=... python -m scripts.push_crexi_pipedrive --push
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from collections import Counter

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

sys.path.insert(0, ".")
from dotenv import load_dotenv          # noqa: E402
load_dotenv()

from scrapers.crexi import CrexiScraper          # noqa: E402
from scrapers.markets import is_in_target_market  # noqa: E402
from scorer import score_listing                  # noqa: E402

_SF_MIN, _SF_MAX = 75_000, 300_000


def _in_buybox_sf(row: dict) -> bool:
    sf = row.get("total_sf")
    return sf is not None and _SF_MIN <= sf <= _SF_MAX


async def _collect() -> list[dict]:
    rows: list[dict] = []
    async with CrexiScraper() as cx:
        async for listing in cx.scrape(markets=[], market_rents={}):
            # In-market guardrail (redundant — Crexi is market-scoped — but the
            # same gate the Pipedrive endpoint enforces).
            if not is_in_target_market(listing):
                continue
            try:
                scores = score_listing(listing)
                listing["score_category"] = scores.get("Score_Category", "Unscored")
                listing["scoring_reason"] = scores.get("Scoring_Reason", "")
            except Exception:  # noqa: BLE001
                listing["score_category"] = "Unscored"
            rows.append(listing)
    return rows


def _dedup(rows: list[dict]) -> list[dict]:
    """Drop exact-duplicate relistings (same address + broker) so we don't create
    two Pipedrive deals for one property. Keeps the first seen."""
    seen: set[tuple] = set()
    out: list[dict] = []
    for r in rows:
        key = ((r.get("address") or "").strip().lower(),
               (r.get("broker_name") or "").strip().lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _select(rows: list[dict], mode: str) -> list[dict]:
    if mode == "all":
        return rows
    if mode == "include-unknown-sf":
        # buy-box range OR unknown SF (drop only confidently-out-of-range)
        return [r for r in rows if r.get("total_sf") is None or _in_buybox_sf(r)]
    return [r for r in rows if _in_buybox_sf(r)]  # default: known SF in range


def _unique_brokers(selected: list[dict]) -> list[dict]:
    """Collapse the selected listings to unique brokers (by name + brokerage),
    accumulating every listing each broker has. Crexi brokers carry no email/
    phone, so name+brokerage is the only dedup key available."""
    by: dict[tuple, dict] = {}
    for r in selected:
        name = (r.get("broker_name") or "").strip()
        if not name:
            continue
        rd = r.get("raw_data") or {}
        brokerage = rd.get("broker_brokerage")
        key = (name.lower(), (brokerage or "").strip().lower())
        b = by.setdefault(key, {
            "name": name,
            "brokerage": brokerage,
            "profile_url": rd.get("broker_profile_url"),
            "listings": [],
        })
        b["listings"].append((r.get("address"), r.get("listing_url")))
    return list(by.values())


def _print_summary(rows: list[dict], selected: list[dict], mode: str):
    print(f"\n=== Scraped {len(rows)} in-market industrial-for-sale listings ===")
    print("By market:")
    for mk, n in Counter((r.get('raw_data') or {}).get('market') for r in rows).most_common():
        print(f"   {mk:<18} {n}")
    known = sum(1 for r in rows if r.get("total_sf") is not None)
    inrange = sum(1 for r in rows if _in_buybox_sf(r))
    print(f"\nSF known: {known}/{len(rows)}   |   in 75k-300k: {inrange}   |   unknown SF: {len(rows)-known}")
    print(f"Score: " + ", ".join(f"{k}={v}" for k, v in
                                  Counter(r.get('score_category') for r in rows).most_common()))
    print(f"\n=== SELECTED for push (scope='{mode}'): {len(selected)} ===")
    for i, r in enumerate(selected[:15], 1):
        rd = r.get("raw_data") or {}
        sf = r.get("total_sf")
        print(f"  [{i:>2}] {r.get('address')}  ({rd.get('market')})")
        print(f"       SF={sf}  ${r.get('asking_price_total')}  score={r.get('score_category')}  "
              f"broker={r.get('broker_name')} / {rd.get('broker_brokerage')}")
    if len(selected) > 15:
        print(f"  ... and {len(selected)-15} more")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true", help="actually write to Pipedrive (default: dry-run)")
    ap.add_argument("--brokers-only", action="store_true",
                    help="create broker Persons only (no deals); dedups brokers, attaches their listings as notes")
    ap.add_argument("--all", action="store_true", help="push every in-market listing")
    ap.add_argument("--include-unknown-sf", action="store_true",
                    help="also push listings with no stated SF")
    ap.add_argument("--limit", type=int, default=0, help="cap number pushed (0 = no cap)")
    ap.add_argument("--analyst", default="", help="Pipedrive analyst/owner name for the deals")
    args = ap.parse_args()

    mode = "all" if args.all else ("include-unknown-sf" if args.include_unknown_sf else "buybox")

    rows = _dedup(asyncio.run(_collect()))
    selected = _select(rows, mode)
    if args.limit > 0:
        selected = selected[:args.limit]

    _print_summary(rows, selected, mode)

    brokers = _unique_brokers(selected) if args.brokers_only else []
    if args.brokers_only:
        print(f"\n=== {len(brokers)} unique brokers (Persons only, NO deals) ===")
        for i, b in enumerate(brokers[:25], 1):
            print(f"  [{i:>2}] {b['name']} / {b['brokerage']}  ({len(b['listings'])} listing(s))")
        if len(brokers) > 25:
            print(f"  ... and {len(brokers) - 25} more")

    if not args.push:
        print("\n[DRY-RUN] Nothing pushed. Re-run with --push (and PIPEDRIVE_API_TOKEN set) to write to Pipedrive.")
        return

    if not os.getenv("PIPEDRIVE_API_TOKEN"):
        print("\nERROR: PIPEDRIVE_API_TOKEN is not set. Set it in the environment or backend/.env.")
        sys.exit(1)

    if args.brokers_only:
        import requests as _rq
        from pipedrive import _find_or_create_broker_person, _add_source_note, _BASE
        token = os.getenv("PIPEDRIVE_API_TOKEN")

        def _existing_by_name(name: str):
            """Exact-name Person match — Crexi brokers carry no email/phone, so
            name is the only dedup key. Makes recurring runs idempotent."""
            try:
                r = _rq.get(f"{_BASE}/persons/search", params={
                    "api_token": token, "term": name, "fields": "name",
                    "exact_match": "true", "limit": 1,
                }, timeout=10)
                items = ((r.json().get("data") or {}).get("items")) or []
                return items[0]["item"]["id"] if items else None
            except Exception:  # noqa: BLE001
                return None

        print(f"\n=== PUSHING {len(brokers)} broker Persons (no deals) ===")
        created = reused = 0
        for i, b in enumerate(brokers, 1):
            try:
                existing = _existing_by_name(b["name"])
                if existing:
                    pid = existing
                    for addr, url in b["listings"]:
                        _add_source_note(pid, addr, url, b["brokerage"], b["profile_url"])
                    reused += 1
                    tag = "reused "
                else:
                    first_addr, first_url = b["listings"][0]
                    pid = _find_or_create_broker_person(
                        b["name"], None, None, None,
                        source_url=first_url, source_address=first_addr,
                        brokerage=b["brokerage"], profile_url=b["profile_url"],
                    )
                    if not pid:
                        print(f"  [{i}/{len(brokers)}] FAIL {b['name']} (no id returned)")
                        continue
                    for addr, url in b["listings"][1:]:
                        _add_source_note(pid, addr, url, b["brokerage"], b["profile_url"])
                    created += 1
                    tag = "created"
                print(f"  [{i}/{len(brokers)}] {tag} person {pid}  {b['name']} "
                      f"({len(b['listings'])} listing(s))")
            except Exception as exc:  # noqa: BLE001
                print(f"  [{i}/{len(brokers)}] FAIL {b['name']}: {exc}")
        print(f"\nDone: {created} created, {reused} reused (already in Pipedrive), of {len(brokers)} brokers.")
        return

    from pipedrive import create_deal  # imported here so dry-run needs no token
    print(f"\n=== PUSHING {len(selected)} deals to Pipedrive ===")
    ok = 0
    for i, row in enumerate(selected, 1):
        try:
            deal = create_deal(row, analyst_name=args.analyst)
            ok += 1
            print(f"  [{i}/{len(selected)}] OK  deal {deal.get('id')}  {deal.get('title')}")
        except Exception as exc:  # noqa: BLE001
            print(f"  [{i}/{len(selected)}] FAIL {row.get('address')}: {exc}")
    print(f"\nDone: {ok}/{len(selected)} deals created.")


if __name__ == "__main__":
    main()
