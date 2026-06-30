"""Deep recon of the RCM listings engine behind sales.colliers.com.

Goal: capture the full response bodies of the API calls and learn:
  - How the pv= engine key is provisioned (extracted from HTML? cookie? fixed?)
  - What GetListingsHtml returns (HTML fragment? JSON? mixed?)
  - What pagination params work
  - Whether we can call it cold with httpx + a fresh pv
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, ".")
from scrapers.base import BaseScraper  # noqa: E402

TARGET = "https://sales.colliers.com/"


async def main():
    captured = []

    async with BaseScraper(headless=True) as scraper:
        page = await scraper.new_page()

        async def on_response(response):
            url = response.url
            if "my.rcm1.com/api" not in url and "rcm.colliers.com/api" not in url:
                return
            entry = {
                "method": response.request.method,
                "status": response.status,
                "url": url,
                "headers_request": dict(response.request.headers),
                "headers_response": dict(response.headers),
                "post_data": response.request.post_data,
            }
            try:
                entry["body"] = await response.text()
            except Exception as e:
                entry["body"] = f"<read failed: {e}>"
            captured.append(entry)

        page.on("response", on_response)

        try:
            await page.goto(TARGET, wait_until="networkidle", timeout=60_000)
        except Exception as exc:
            print(f"goto failed: {exc}")

        await asyncio.sleep(4)
        try:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(3)
        except Exception:
            pass

        # Grab the HTML so we can spot the pv= injected into a script tag
        html = await page.content()
        await page.close()

    # ---- Find pv= in the HTML ----
    pv_matches = set(re.findall(r"pv=([A-Za-z0-9_\-]{20,})", html))
    print(f"\n# pv= values found in HTML: {len(pv_matches)}")
    for v in pv_matches:
        print(f"  pv = {v}")

    # ---- Find ProjectId / ProjectKey / EngineKey-style values ----
    for key in ("ProjectId", "ProjectKey", "EngineKey", "engineId", "projectId"):
        m = re.findall(rf'{key}["\']?\s*[:=]\s*["\']([^"\']+)["\']', html)
        if m:
            print(f"  {key}: {m[:3]}")

    # ---- Print captured RCM API responses ----
    print(f"\n# Captured {len(captured)} RCM api calls:\n")
    for i, e in enumerate(captured, 1):
        path = urlparse(e["url"]).path
        qs = parse_qs(urlparse(e["url"]).query)
        print(f"[{i}] {e['method']} {e['status']} {path}")
        print(f"     query: {dict((k, v[0][:60]) for k, v in qs.items())}")
        if e["post_data"]:
            print(f"     post: {e['post_data'][:200]}")
        ctype = e["headers_response"].get("content-type", "")
        print(f"     ctype: {ctype}")
        body = e.get("body", "") or ""
        if "json" in ctype.lower() or body.lstrip().startswith(("{", "[", "listingCallback(")):
            print(f"     body[:600]: {body[:600]}")
        else:
            print(f"     body_len: {len(body)}  body[:300]: {body[:300]}")
        print()

    # ---- Save raw artifacts ----
    with open("/tmp/colliers_rcm_recon.json", "w") as f:
        json.dump(captured, f, indent=2, default=str)
    with open("/tmp/colliers_sales_page.html", "w") as f:
        f.write(html)
    print("Saved: /tmp/colliers_rcm_recon.json, /tmp/colliers_sales_page.html")


if __name__ == "__main__":
    asyncio.run(main())
