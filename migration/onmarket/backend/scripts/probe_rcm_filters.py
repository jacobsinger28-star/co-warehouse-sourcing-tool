"""Probe how to filter RCM listings by AssetType=Industrial and how pagination works."""
from __future__ import annotations

import asyncio
import json
import re
import sys

import httpx

PV = "BX0EQVWsJMGzGR6ZiWBDEnJAH-tErDnvHaBoKDFAOy4"
URL = f"https://my.rcm1.com/api/AjaxEngine/GetListingsHtml?&pv={PV}"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


async def post(client, body, label):
    r = await client.post(
        URL,
        content=body,
        headers={
            "User-Agent": UA,
            "Accept": "*/*",
            "Origin": "https://sales.colliers.com",
            "Referer": "https://sales.colliers.com/",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
    )
    try:
        data = r.json()
    except Exception:
        print(f"  {label}: NON-JSON status={r.status_code} body[:300]={r.text[:300]}")
        return None

    html = data.get("html", "") or ""
    # count "Industrial" mentions in the .asset divs
    industrial_cards = len(re.findall(r'class="asset">Industrial', html))
    sale_cards = len(re.findall(r'<li class="col-xs-12 col-sm-6', html))
    print(f"  {label}: status={r.status_code} total={data.get('total')} "
          f"totalAvail={data.get('totalAvail')} numProjects={data.get('numProjects')} "
          f"cards={sale_cards} industrial_cards={industrial_cards}")
    return data


async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Baseline
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=1", "baseline")

        # Try a few asset-type param shapes
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=1&AssetType=Industrial", "AssetType=Industrial")
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=1&AssetType%5B%5D=Industrial", "AssetType[]=Industrial")
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=1&AssetTypes=Industrial", "AssetTypes=Industrial")
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=1&AssetType=Industrial,Land", "AssetType=Industrial,Land")

        # Status filter
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=1&AssetType=Industrial&Status=Available", "Industrial+Available")

        # Pagination: page 2
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=51&AssetType=Industrial", "Industrial Start=51")
        await post(client, "FilterProjectUserAttr=0&PageSize=50&Start=101&AssetType=Industrial", "Industrial Start=101")

        # Big page size
        await post(client, "FilterProjectUserAttr=0&PageSize=500&Start=1&AssetType=Industrial", "Industrial PageSize=500")
        await post(client, "FilterProjectUserAttr=0&PageSize=1000&Start=1&AssetType=Industrial", "Industrial PageSize=1000")
        await post(client, "FilterProjectUserAttr=0&PageSize=2000&Start=1&AssetType=Industrial", "Industrial PageSize=2000")


if __name__ == "__main__":
    asyncio.run(main())
