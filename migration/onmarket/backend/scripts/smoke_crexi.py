"""Smoke-test CrexiScraper end-to-end against the live api.crexi.com.

Runs the direct-API scraper across the buy-box markets (no browser, no DB),
prints per-market counts, broker-capture stats, and a few sample listings.

Run from backend/:  python -m scripts.smoke_crexi
"""
from __future__ import annotations

import asyncio
import sys
import logging
from collections import Counter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

sys.path.insert(0, ".")
from scrapers.crexi import CrexiScraper  # noqa: E402


async def main():
    listings = []
    # markets=[] -> all target markets (Crexi is market-scoped internally)
    async with CrexiScraper() as cx:
        async for listing in cx.scrape(markets=[], market_rents={}):
            listings.append(listing)

    print(f"\n=== Results: {len(listings)} in-buy-box industrial-for-sale listings ===\n")

    by_market = Counter((l.get("raw_data") or {}).get("market") for l in listings)
    for mk, n in by_market.most_common():
        print(f"  {mk:<18} {n}")

    has_name  = sum(1 for l in listings if l.get("broker_name"))
    has_brkg  = sum(1 for l in listings if (l.get("raw_data") or {}).get("broker_brokerage"))
    has_price = sum(1 for l in listings if l.get("asking_price_total"))
    has_sf    = sum(1 for l in listings if l.get("total_sf"))
    has_specs = sum(1 for l in listings if any(
        l.get(k) is not None for k in ("clear_height", "loading_docks", "zoning", "power")
    ))
    print(f"\n  with broker_name : {has_name}/{len(listings)}")
    print(f"  with brokerage   : {has_brkg}/{len(listings)}")
    print(f"  with asking_price: {has_price}/{len(listings)}")
    print(f"  with total_sf    : {has_sf}/{len(listings)}")
    print(f"  with any specs   : {has_specs}/{len(listings)}")

    print("\n=== First 8 listings ===")
    for i, l in enumerate(listings[:8], 1):
        rd = l.get("raw_data") or {}
        print(f"\n[{i}] {l['address']}  ({rd.get('market')})")
        print(f"     SF: {l.get('total_sf')}  Price: {l.get('asking_price_total')}  "
              f"$/SF: {l.get('asking_price_psf')}  Status: {l.get('status')}")
        print(f"     Broker: {l.get('broker_name')}  |  {rd.get('broker_brokerage')}")
        print(f"     Profile: {rd.get('broker_profile_url')}")
        print(f"     URL: {l.get('listing_url')}")


if __name__ == "__main__":
    asyncio.run(main())
