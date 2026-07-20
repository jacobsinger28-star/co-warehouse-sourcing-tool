"""
Colliers SalesTracker scraper — direct API approach.

Background
----------
sales.colliers.com is a Single Page App backed by the RCM (Real Capital Markets)
listings engine. The SPA calls a JSON XHR endpoint at
`https://my.rcm1.com/api/AjaxEngine/GetListingsHtml` which returns
`{success, total, totalAvail, numProjects, html}` — an HTML fragment wrapped in
JSON. Each `<li class="item">` is one property card with:

  - Property name + city/state
  - Asking price (when public)
  - Asset type ("Industrial - Warehouse / Distribution", etc.)
  - Square footage
  - Status (Available / Sold / Under Contract)
  - **Listing broker: name, email, phone** ← already on the card, no detail fetch
  - Detail-page URL

The engine is identified by a `pv=` token rendered into the sales.colliers.com
HTML (a single, static value at time of writing — we still re-extract it each
run in case Colliers rotates it).

How this differs from the existing Playwright Colliers branch
-------------------------------------------------------------
- One HTTP request returns all ~1,600 active listings (PageSize=2000 is
  honored). The Playwright version had to scroll a virtualised grid.
- Broker contact info is captured on the first pass — directly addresses the
  outreach layer's missing-feature #1 from SESSION_HANDOFF.md.
- AssetType=Industrial filter param exists in the schema but the server
  ignores it (verified during recon). We filter client-side from the
  `<div class="asset">` cell — fast, deterministic.

Failure modes
-------------
- pv= rotated → re-fetch sales.colliers.com to grab the new one
- Bot wall (status 403 or HTML body) → fall back to Playwright via the
  existing brokerage.py colliers_mode branch
- HTML shape drift → the regex extractors below are intentionally loose
  (named-group, multi-pattern) to absorb small markup tweaks
"""
from __future__ import annotations

import asyncio
import hashlib
import html as html_lib
import logging
import re
from typing import Any, AsyncGenerator

import httpx

from .base import BaseScraper

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Endpoint config
# ---------------------------------------------------------------------------

_SALES_HOME = "https://sales.colliers.com/"
_RCM_BASE = "https://my.rcm1.com"
_RCM_LISTINGS = f"{_RCM_BASE}/api/AjaxEngine/GetListingsHtml"
_RCM_CONFIG = f"{_RCM_BASE}/api/Handler/ListingEngine/Config"

# Engine pv known at time of recon. Used as a fallback if we can't extract a
# fresh one from sales.colliers.com (e.g. the home page itself starts 403'ing).
# Verified 2026-06-09: EngineId=462, ProjectId=72691, Name="Colliers SalesTracker".
_FALLBACK_PV = "BX0EQVWsJMGzGR6ZiWBDEnJAH-tErDnvHaBoKDFAOy4"

# RCM paginates by Start (1-indexed) + PageSize. Empirically PageSize=2000
# returns all 1,634 active listings in a single response. We still loop
# defensively in case the total grows.
_PAGE_SIZE = 2000

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


# ---------------------------------------------------------------------------
# HTML card parser
# ---------------------------------------------------------------------------

# Each card is one <li class="...item">...</li>. We split on the opening <li>
# tag rather than parse with bs4 to avoid adding a dependency.
_CARD_SPLIT_RE = re.compile(r'<li\s+class="[^"]*\bitem\b[^"]*">', re.I)

# Within a card:
_HEADLINE_RE = re.compile(
    r'<div class="headline">\s*(?:<a[^>]*>)?\s*([^<]+?)\s*(?:</a>)?\s*</div>',
    re.I,
)
_CITY_RE = re.compile(
    r'<div class="city">\s*(?:<a[^>]*>)?\s*([^<]+?)\s*(?:</a>)?\s*</div>',
    re.I,
)
_STATUS_RE = re.compile(r'<div class="status">\s*([^<]+?)\s*</div>', re.I)
_PRICE_RE = re.compile(r'<div class="price">\s*([^<]*?)\s*</div>', re.I)
_ASSET_RE = re.compile(r'<div class="asset">\s*([^<]+?)\s*</div>', re.I)
_SQFT_RE = re.compile(r'<div class="sq-ft">\s*([^<]+?)\s*</div>', re.I)
_DETAIL_URL_RE = re.compile(
    r'href="(https://my\.rcm1\.com/handler/landing\.aspx\?pv=[^"]+)"',
    re.I,
)
_BROKER_NAME_RE = re.compile(
    r'<div class="name">.*?<a[^>]*href="mailto:([^"?]+)"[^>]*>'
    r'(?:<i[^>]*>.*?</i>)?\s*([^<]+?)\s*</a>',
    re.I | re.S,
)
_BROKER_PHONE_RE = re.compile(
    r'<div class="phone">.*?<a[^>]*href="tel:([^"]+)"[^>]*>'
    r'(?:<i[^>]*>.*?</i>)?\s*([^<]+?)\s*</a>',
    re.I | re.S,
)
# Some cards just hard-code the name in <div class="name"> with no mailto.
_BROKER_NAME_PLAIN_RE = re.compile(
    r'<div class="name">\s*([^<]+?)\s*</div>',
    re.I,
)


def _clean(s: str | None) -> str | None:
    if s is None:
        return None
    # RCM uses U+201A (single low-9 quotation mark) instead of comma in
    # "City‚  ST". Replace before any downstream regex sees it.
    s = s.replace("‚", ",").replace("‘", "'").replace("’", "'")
    s = html_lib.unescape(s).strip()
    s = re.sub(r"\s+", " ", s)
    return s or None


def _parse_price(s: str | None) -> float | None:
    if not s:
        return None
    m = re.search(r"\$([\d,]+(?:\.\d+)?)", s)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _parse_sf(s: str | None) -> float | None:
    if not s:
        return None
    m = re.search(r"([\d,]+(?:\.\d+)?)", s)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _parse_card(card_html: str) -> dict | None:
    """Parse one <li class="item"> fragment into a normalized dict."""
    headline = _clean(_HEADLINE_RE.search(card_html).group(1)) if _HEADLINE_RE.search(card_html) else None
    city_state = _clean(_CITY_RE.search(card_html).group(1)) if _CITY_RE.search(card_html) else None
    status = _clean(_STATUS_RE.search(card_html).group(1)) if _STATUS_RE.search(card_html) else None
    price = _parse_price(_PRICE_RE.search(card_html).group(1)) if _PRICE_RE.search(card_html) else None
    asset = _clean(_ASSET_RE.search(card_html).group(1)) if _ASSET_RE.search(card_html) else None
    sf = _parse_sf(_SQFT_RE.search(card_html).group(1)) if _SQFT_RE.search(card_html) else None
    detail_url = _DETAIL_URL_RE.search(card_html).group(1) if _DETAIL_URL_RE.search(card_html) else None

    broker_email: str | None = None
    broker_name: str | None = None
    broker_phone: str | None = None
    m = _BROKER_NAME_RE.search(card_html)
    if m:
        broker_email = _clean(m.group(1))
        broker_name = _clean(m.group(2))
    else:
        m = _BROKER_NAME_PLAIN_RE.search(card_html)
        if m:
            broker_name = _clean(m.group(1))
    m = _BROKER_PHONE_RE.search(card_html)
    if m:
        broker_phone = _clean(m.group(2)) or _clean(m.group(1))

    if not headline and not city_state:
        return None  # garbage card

    # Compose a usable address. RCM cards don't include a street address on the
    # card — only "City, ST". The headline is sometimes a street ("951 W Watkins
    # St"), so when it looks like one, prepend it.
    address = city_state or ""
    if headline and re.match(r"\s*\d+\s+\w", headline) and city_state:
        address = f"{headline}, {city_state}"
    elif not address:
        address = headline or ""

    return {
        "headline": headline,
        "address": address,
        "city_state": city_state,
        "status": status,
        "asking_price_total": price,
        "asset_type": asset,
        "total_sf": sf,
        "listing_url": detail_url,
        "broker_name": broker_name,
        "broker_email": broker_email,
        "broker_phone": broker_phone,
    }


def _is_industrial(asset_type: str | None) -> bool:
    return bool(asset_type) and "industrial" in asset_type.lower()


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------

class ColliersScraper(BaseScraper):
    """Direct-API scraper for Colliers SalesTracker (sales.colliers.com).

    Subclasses BaseScraper for the SOURCE convention + stop_event hook, but
    skips the Playwright browser setup — we use httpx instead.
    """

    SOURCE = "colliers"

    def __init__(self, stop_event=None):
        # Skip BaseScraper.__init__ since we don't launch a browser
        self._stop_event = stop_event
        self._client: httpx.AsyncClient | None = None
        self._pv: str | None = None

    # --- async context manager (mirrors BaseScraper interface) ------------

    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={
                "User-Agent": _UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        return self

    async def __aexit__(self, *_):
        if self._client:
            await self._client.aclose()

    def _should_stop(self) -> bool:
        return self._stop_event is not None and self._stop_event.is_set()

    # --- engine pv lookup --------------------------------------------------

    async def _fetch_pv(self) -> str:
        """Extract the current pv= engine token from sales.colliers.com.

        Falls back to the hard-coded value if the home page returns a non-200
        or doesn't contain a pv. The fallback covers the case where Colliers
        starts blocking the SPA load — direct API calls still work because
        my.rcm1.com is on a separate domain.
        """
        # The pv lives in the home HTML as `key: "BX0EQ..."` inside the AjaxEngine
        # bootstrap config. It also appears as `pv=...` in style-sheet URLs once
        # the JS runs — but a raw httpx fetch only sees the pre-JS markup, so we
        # match the `key:` form first.
        _PV_PATTERNS = [
            r'key\s*:\s*"([A-Za-z0-9_\-]{20,})"',  # bootstrap config
            r"pv=([A-Za-z0-9_\-]{20,})",            # post-JS DOM (Playwright)
        ]
        try:
            r = await self._client.get(_SALES_HOME)
            if r.status_code == 200:
                for pat in _PV_PATTERNS:
                    m = re.search(pat, r.text)
                    if m:
                        pv = m.group(1)
                        logger.info("[colliers] using pv=%s... from sales.colliers.com", pv[:10])
                        return pv
                logger.warning("[colliers] sales.colliers.com loaded but no pv key found; using fallback")
            else:
                logger.warning("[colliers] sales.colliers.com returned %d; using fallback pv", r.status_code)
        except Exception as exc:
            logger.warning("[colliers] sales.colliers.com fetch failed (%s); using fallback pv", exc)
        return _FALLBACK_PV

    # --- listings fetch ----------------------------------------------------

    async def _fetch_listings(self, pv: str, start: int, page_size: int) -> dict:
        """Hit the AjaxEngine endpoint and return the parsed JSON."""
        url = f"{_RCM_LISTINGS}?&pv={pv}"
        body = f"FilterProjectUserAttr=0&PageSize={page_size}&Start={start}"
        r = await self._client.post(
            url,
            content=body,
            headers={
                "Accept": "*/*",
                "Origin": "https://sales.colliers.com",
                "Referer": "https://sales.colliers.com/",
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
        )
        r.raise_for_status()
        return r.json()

    # --- main entry --------------------------------------------------------

    async def scrape(
        self,
        markets: list[str],
        market_rents: dict[str, float],
        known_urls: set[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Yield normalized listing dicts.

        Honors:
          - self._stop_event for graceful stop
          - known_urls (set of already-cached listing URLs) — skipped
          - markets — substring match against the address (empty list = no filter)
        """
        # Filter helpers from brokerage.py — single source of truth for the
        # SF window and US-address logic across all scrapers.
        from .brokerage import _passes_sf_filter, _is_us_address

        if not self._client:
            raise RuntimeError("ColliersScraper used outside `async with` block")

        market_patterns = [
            re.compile(re.escape(m), re.I) for m in (markets or [])
        ]
        known_urls = known_urls or set()

        pv = self._pv = await self._fetch_pv()

        # Page through, but with PageSize=2000 a single request usually covers it
        start = 1
        seen_total = None
        emitted = 0
        scanned = 0

        while True:
            if self._should_stop():
                logger.info("[colliers] stop requested before fetch (start=%d)", start)
                return

            try:
                payload = await self._fetch_listings(pv, start, _PAGE_SIZE)
            except Exception as exc:
                logger.warning("[colliers] listings fetch failed at start=%d: %s", start, exc)
                return

            if not payload.get("success"):
                logger.warning("[colliers] non-success payload: %s", str(payload)[:200])
                return

            total = payload.get("total") or 0
            num_returned = payload.get("numProjects") or 0
            html = payload.get("html") or ""

            if seen_total is None:
                seen_total = total
                logger.info(
                    "[colliers] total=%d totalAvail=%d — fetching with PageSize=%d",
                    total, payload.get("totalAvail") or 0, _PAGE_SIZE,
                )

            # Split the HTML into cards
            cards = _CARD_SPLIT_RE.split(html)
            # First chunk is the opening <ul> markup before the first card — drop it
            cards = cards[1:] if cards else []
            logger.info("[colliers] start=%d numProjects=%d cards=%d", start, num_returned, len(cards))

            for card_html in cards:
                if self._should_stop():
                    logger.info("[colliers] stop requested during emission")
                    return

                scanned += 1
                parsed = _parse_card(card_html)
                if not parsed:
                    continue

                # Asset type filter — only Industrial cards
                if not _is_industrial(parsed["asset_type"]):
                    continue

                # US address filter
                if not _is_us_address(parsed["address"]):
                    logger.debug("[colliers] skip non-US: %s", parsed["address"])
                    continue

                # Market substring filter (if user passed any)
                if market_patterns and not any(p.search(parsed["address"]) for p in market_patterns):
                    continue

                # SF filter (early — same window the other scrapers use)
                sf = parsed["total_sf"]
                if not _passes_sf_filter(sf):
                    logger.debug("[colliers] skip SF out of range (%s): %s", sf, parsed["address"])
                    continue

                # On-market only. Colliers SalesTracker also lists CLOSED deals
                # (Sold) as comps; this is a for-sale sourcing tool, so drop them.
                status = (parsed.get("status") or "").strip().lower()
                if status in ("sold", "closed"):
                    logger.debug("[colliers] skip %s: %s", status, parsed["address"])
                    continue

                # Dedup by URL. ~40% of teaser cards have no public landing
                # page URL (price is "Call broker" / no public listing yet) —
                # those would re-emit every run if we left listing_url empty.
                # Synthesize a stable surrogate from (headline, city_state,
                # broker_email) so the cache can dedup them too.
                listing_url = parsed["listing_url"]
                if not listing_url:
                    seed = "|".join(filter(None, [
                        parsed["headline"] or "",
                        parsed["city_state"] or "",
                        parsed["broker_email"] or "",
                    ]))
                    if seed:
                        h = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
                        listing_url = f"https://sales.colliers.com/#teaser/{h}"
                if listing_url and listing_url in known_urls:
                    logger.debug("[colliers] skip cached: %s", listing_url)
                    continue

                # Compute $/SF if we have both
                price_total = parsed["asking_price_total"]
                price_psf = None
                if price_total and sf and sf > 0:
                    price_psf = round(price_total / sf, 2)

                yield {
                    "source":             "colliers",
                    "listing_url":        listing_url,
                    "building_type":      "Industrial",
                    "address":            parsed["address"],
                    "total_sf":           sf,
                    "asking_price_psf":   price_psf,
                    # Detail-page-only fields stay None — phase 2 can enrich
                    # by hitting landing.aspx for the cards we keep.
                    "clear_height":       None,
                    "loading_docks":      None,
                    "grade_doors":        None,
                    "zoning":             None,
                    "power":              None,
                    "sprinklered":        None,
                    "office_pct":         None,
                    "parking_ratio":      None,
                    "truck_court_depth":  None,
                    "occupancy_pct":      None,
                    "walt":               None,
                    # Bonus fields beyond the shared schema — the outreach
                    # layer will read these. Storage layer ignores unknown
                    # keys today, so this is safe to add.
                    "broker_name":        parsed["broker_name"],
                    "broker_email":       parsed["broker_email"],
                    "broker_phone":       parsed["broker_phone"],
                    "asset_subtype":      parsed["asset_type"],
                    "status":             parsed["status"],
                    "asking_price_total": price_total,
                }
                emitted += 1

            # Pagination
            if num_returned == 0 or scanned >= total:
                break
            start += num_returned
            # Tiny politeness delay between pages
            await asyncio.sleep(0.5)

        logger.info("[colliers] done — scanned=%d emitted=%d", scanned, emitted)
