"""Probe the RCM AjaxEngine endpoint directly with httpx — no browser.

If this works cold, the API approach is viable. If it returns 403 / a bot wall,
we'll need to bootstrap via Playwright first to capture cookies.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys

import httpx

PV = "BX0EQVWsJMGzGR6ZiWBDEnJAH-tErDnvHaBoKDFAOy4"  # Colliers SalesTracker engine pv
LISTINGS_URL = f"https://my.rcm1.com/api/AjaxEngine/GetListingsHtml?&pv={PV}"
CONFIG_URL = (
    f"https://my.rcm1.com/api/Handler/ListingEngine/Config?pv={PV}&callback=listingCallback"
)
SALES_URL = "https://sales.colliers.com/"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


async def main():
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://sales.colliers.com",
        "Referer": "https://sales.colliers.com/",
        "X-Requested-With": "XMLHttpRequest",
    }

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        # 1) Confirm cold call to Config
        print(f"--- GET {CONFIG_URL}")
        r = await client.get(CONFIG_URL, headers=headers)
        print(f"  status: {r.status_code}, len: {len(r.text)}")
        # strip callback wrapper
        text = r.text
        m = re.match(r"^listingCallback\((.*)\)\s*;?\s*$", text, re.DOTALL)
        if m:
            cfg = json.loads(m.group(1))
            print(f"  EngineId: {cfg.get('engineConfig', {}).get('EngineId')} "
                  f"ProjectId: {cfg.get('engineConfig', {}).get('ProjectId')} "
                  f"Name: {cfg.get('engineConfig', {}).get('Name')}")
        else:
            print(f"  body[:200]: {text[:200]}")

        # 2) Try GetListingsHtml — POST with the body the browser sent
        print(f"\n--- POST {LISTINGS_URL}")
        body_variants = [
            "FilterProjectUserAttr=0&PageSize=50&Start=1",
            "FilterProjectUserAttr=0&PageSize=200&Start=1",
            "FilterProjectUserAttr=0&PageSize=10&Start=1",
        ]
        for body in body_variants:
            print(f"\n  POST body: {body}")
            r = await client.post(
                LISTINGS_URL,
                content=body,
                headers={
                    **headers,
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                },
            )
            print(f"  status: {r.status_code}, len: {len(r.text)}, ctype: {r.headers.get('content-type')}")
            text = r.text
            print(f"  body[:500]: {text[:500]}")
            if r.status_code == 200 and len(text) > 200:
                with open("/tmp/colliers_listings_first.html", "w") as f:
                    f.write(text)
                print("  saved to /tmp/colliers_listings_first.html")
                break

        # 3) Probe filters endpoint
        FILTERS_URL = f"https://my.rcm1.com/api/Handler/ListingEngine/GetFilters?pv={PV}"
        print(f"\n--- POST {FILTERS_URL}")
        r = await client.post(
            FILTERS_URL,
            content="",
            headers={
                **headers,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
        )
        print(f"  status: {r.status_code}, len: {len(r.text)}, ctype: {r.headers.get('content-type')}")
        text = r.text
        print(f"  body[:1000]: {text[:1000]}")
        if r.status_code == 200 and len(text) > 100:
            with open("/tmp/colliers_filters.json", "w") as f:
                f.write(text)


if __name__ == "__main__":
    asyncio.run(main())
