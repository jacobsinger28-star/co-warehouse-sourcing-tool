"""Smoke-test ColliersScraper end-to-end.

Runs the new direct-API scraper, prints summary stats and 5 sample listings
including the broker contact fields.
"""
from __future__ import annotations

import asyncio
import sys
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

sys.path.insert(0, ".")
from scrapers.colliers import ColliersScraper  # noqa: E402


async def main():
    listings = []
    async with ColliersScraper() as cs:
        async for listing in cs.scrape(markets=[], market_rents={}):
            listings.append(listing)

    print(f"\n=== Results: {len(listings)} industrial-for-sale listings ===\n")

    has_broker_email = sum(1 for l in listings if l.get("broker_email"))
    has_broker_name  = sum(1 for l in listings if l.get("broker_name"))
    has_broker_phone = sum(1 for l in listings if l.get("broker_phone"))
    has_price        = sum(1 for l in listings if l.get("asking_price_total"))
    has_sf           = sum(1 for l in listings if l.get("total_sf"))
    has_url          = sum(1 for l in listings if l.get("listing_url"))

    print(f"  with broker_email: {has_broker_email}/{len(listings)}")
    print(f"  with broker_name : {has_broker_name}/{len(listings)}")
    print(f"  with broker_phone: {has_broker_phone}/{len(listings)}")
    print(f"  with asking_price: {has_price}/{len(listings)}")
    print(f"  with total_sf    : {has_sf}/{len(listings)}")
    print(f"  with listing_url : {has_url}/{len(listings)}")

    print("\n=== First 5 listings ===")
    for i, l in enumerate(listings[:5], 1):
        print(f"\n[{i}] {l['address']}")
        print(f"     SF: {l.get('total_sf')}  Price: {l.get('asking_price_total')}  "
              f"$/SF: {l.get('asking_price_psf')}  Status: {l.get('status')}")
        print(f"     Type: {l.get('asset_subtype')}")
        print(f"     Broker: {l.get('broker_name')} <{l.get('broker_email')}> {l.get('broker_phone')}")
        print(f"     URL: {l.get('listing_url')}")


if __name__ == "__main__":
    asyncio.run(main())
