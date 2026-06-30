"""Recon Colliers XHR endpoints.

Loads sales.colliers.com and colliers.com/en-us/properties in a real Chromium
browser, captures every XHR/fetch request, and prints the ones that look like
API calls (JSON responses, /api/, /graphql, /search, etc).

Run:
    cd backend
    ./.venv/bin/python -m scripts.recon_colliers
"""
from __future__ import annotations

import asyncio
import json
import sys
from urllib.parse import urlparse

# Reuse the project's stealthed Playwright setup
sys.path.insert(0, ".")
from scrapers.base import BaseScraper  # noqa: E402


INTERESTING_HINTS = (
    "/api/",
    "/graphql",
    "/search",
    "/properties",
    "/listings",
    "/v1/",
    "/v2/",
    ".json",
)
NOISE_HOSTS = (
    "googletagmanager.com",
    "google-analytics.com",
    "doubleclick.net",
    "facebook.com",
    "linkedin.com",
    "hotjar.com",
    "qualtrics.com",
    "newrelic.com",
    "cookielaw.org",
    "onetrust.com",
    "cloudfront.net/cdn-cgi",
    "demdex.net",
    "adobedtm.com",
    "omtrdc.net",
)
TARGET_URLS = [
    "https://www.colliers.com/en-us/properties?propertyType=Industrial&transactionType=Sale",
    "https://sales.colliers.com/",
    "https://capital.colliers.com/",
]


def _is_noise(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return any(noise in host for noise in NOISE_HOSTS)


def _is_interesting(url: str, resource_type: str) -> bool:
    if _is_noise(url):
        return False
    if resource_type in ("xhr", "fetch"):
        return True
    return any(h in url.lower() for h in INTERESTING_HINTS)


async def recon_url(url: str) -> None:
    print(f"\n{'=' * 80}\nLoading: {url}\n{'=' * 80}")

    captured: list[dict] = []

    async with BaseScraper(headless=True) as scraper:
        page = await scraper.new_page()

        async def on_request(request):
            if not _is_interesting(request.url, request.resource_type):
                return
            captured.append({
                "method": request.method,
                "url": request.url,
                "resource_type": request.resource_type,
                "headers": dict(request.headers),
                "post_data": request.post_data,
            })

        async def on_response(response):
            req_url = response.request.url
            if not _is_interesting(req_url, response.request.resource_type):
                return
            # Tag the captured entry with the status & content-type
            for entry in captured:
                if entry["url"] == req_url and "status" not in entry:
                    entry["status"] = response.status
                    entry["content_type"] = response.headers.get("content-type", "")
                    # Try to grab a JSON body preview
                    ctype = entry["content_type"].lower()
                    if "json" in ctype:
                        try:
                            body = await response.text()
                            entry["body_preview"] = body[:800]
                        except Exception:
                            entry["body_preview"] = "<failed to read>"
                    break

        page.on("request", on_request)
        page.on("response", on_response)

        try:
            await page.goto(url, wait_until="networkidle", timeout=45_000)
        except Exception as exc:
            print(f"  goto failed: {exc}")
            # Don't bail — we may still have captured useful requests during load
        await asyncio.sleep(3)

        # Scroll to trigger any lazy-load XHR
        try:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(3)
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(3)
        except Exception:
            pass

        await page.close()

    # Report
    print(f"\nCaptured {len(captured)} interesting requests:\n")
    for i, entry in enumerate(captured, 1):
        print(f"[{i}] {entry['method']} {entry.get('status', '?')} "
              f"({entry['resource_type']}) {entry['url']}")
        ctype = entry.get("content_type", "")
        if ctype:
            print(f"     content-type: {ctype}")
        if entry.get("post_data"):
            preview = entry["post_data"][:300]
            print(f"     post_data: {preview}")
        if entry.get("body_preview"):
            print(f"     body_preview: {entry['body_preview'][:400]}")
        # Print interesting headers
        hdrs = entry["headers"]
        interesting_hdrs = {
            k: v for k, v in hdrs.items()
            if k.lower() in (
                "authorization", "x-api-key", "x-csrf-token", "x-requested-with",
                "x-algolia-application-id", "x-algolia-api-key", "apikey",
                "x-auth-token", "ocp-apim-subscription-key",
            )
        }
        if interesting_hdrs:
            print(f"     auth_headers: {interesting_hdrs}")
        print()


async def main():
    for url in TARGET_URLS:
        try:
            await recon_url(url)
        except Exception as exc:
            print(f"recon failed for {url}: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
