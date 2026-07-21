"""
CBRE scraper — direct API (no browser), the revived edition.

Why the rewrite
---------------
The old CBRE path drove Playwright over cbre.com/properties/properties-for-sale/*
and scroll-collected card links. CBRE moved those URLs (they now 404) and the
old ones matched nothing — CBRE silently returned 0. But cbre.com's search SPA
is backed by a public JSON API with no auth:

  GET https://www.cbre.com/listings-api/propertylistings/query
      ?Site=us-comm&CurrencyCode=USD&Unit=sqft
      &Common.Aspects=isSale            # for-sale only
      &Common.UsageType=Industrial      # ~1,230 industrial-for-sale nationally
      &PageSize=20000&Page=1

Response: {Found, DocumentCount, Documents:[[listing,…]], Aggregations, Took}.
Each listing carries the full address, EXACT lat/lon (so no geocoding needed),
building size (Common.TotalSize, with units — only 'sqft' is a real building
SF), and the listing agent's name/email/phone (Crexi gates contacts; CBRE gives
them, like Colliers). So this scraper is pure httpx — fast, robust, headless.

Scoping mirrors Crexi: because CBRE hands us coordinates, we place each listing
in a buy-box metro by lat/lon (scrapers.markets.market_for_coords) and keep only
the target metros. An empty markets list still scopes to all target metros.
"""
from __future__ import annotations

import logging
import re
from typing import AsyncGenerator

import httpx

from .base import BaseScraper
from .markets import match_markets, market_for_coords, market_for_address

logger = logging.getLogger(__name__)

_QUERY = "https://www.cbre.com/listings-api/propertylistings/query"
_DETAIL = "https://www.cbre.com/properties/properties-for-lease/commercial-space/details"
# Industrial + flex are both in the buy-box; each is one request.
_USAGE_TYPES = ["Industrial", "FlexIndustrial"]
_PAGE_SIZE = 20000  # one page covers the whole national industrial-for-sale set

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_HEADERS = {"User-Agent": _UA, "Accept": "application/json", "Referer": "https://www.cbre.com/"}


def _clean(s) -> str | None:
    if s is None:
        return None
    s = " ".join(str(s).split()).strip()
    return s or None


def _slug(*parts) -> str:
    s = "-".join(p for p in parts if p)
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "listing"


def _address(addr: dict) -> str | None:
    """Assemble 'street, city, ST zip'. Line2 is the street; Line1 is sometimes
    a building name or a blank, sometimes the street when Line2 is missing."""
    line2 = _clean(addr.get("Common.Line2"))
    line1 = _clean(addr.get("Common.Line1"))
    street = line2 or line1
    city = _clean(addr.get("Common.Locallity"))
    region = _clean(addr.get("Common.Region"))
    postcode = _clean(addr.get("Common.PostCode"))
    if not street or not city or not region:
        return None
    tail = f"{region} {postcode}".strip() if postcode else region
    return f"{street}, {city}, {tail}"


def _building_sf(doc: dict) -> float | None:
    """Total size, but ONLY when it's a building measurement (sqft). Listings
    measured in acres are land — return None (unknown) so the SF filter treats
    them as it does any other scraper's unknowns rather than as a tiny building."""
    for sz in doc.get("Common.TotalSize") or []:
        units = (sz.get("Common.Units") or "").lower()
        val = sz.get("Common.Size")
        if units == "sqft" and isinstance(val, (int, float)) and val > 0:
            return float(val)
    return None


def _agent(doc: dict) -> dict:
    ag = (doc.get("Common.Agents") or [{}])[0]
    return {
        "name": _clean(ag.get("Common.AgentName")),
        "email": _clean(ag.get("Common.EmailAddress")),
        "phone": _clean(ag.get("Common.TelephoneNumber")),
    }


class CbreScraper(BaseScraper):
    """Direct-API scraper for CBRE, scoped to the buy-box metros by coordinate.

    Subclasses BaseScraper for the SOURCE + stop_event hook but, like
    CrexiScraper/ColliersScraper, uses httpx — no Playwright browser.
    """

    SOURCE = "cbre"

    def __init__(self, stop_event=None):
        self._stop_event = stop_event
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=45.0, follow_redirects=True, headers=_HEADERS)
        return self

    async def __aexit__(self, *_):
        if self._client:
            await self._client.aclose()

    def _should_stop(self) -> bool:
        return self._stop_event is not None and self._stop_event.is_set()

    async def _query(self, usage_type: str) -> list[dict]:
        params = {
            "Site": "us-comm",
            "CurrencyCode": "USD",
            "Unit": "sqft",
            "Common.Aspects": "isSale",
            "Common.UsageType": usage_type,
            "PageSize": _PAGE_SIZE,
            "Page": 1,
        }
        r = await self._client.get(_QUERY, params=params)
        r.raise_for_status()
        data = r.json()
        docs = data.get("Documents") or []
        return docs[0] if docs and isinstance(docs[0], list) else []

    async def scrape(
        self,
        markets: list[str],
        market_rents: dict[str, float],
        known_urls: set[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        from .brokerage import _passes_sf_filter, _is_us_address

        if not self._client:
            raise RuntimeError("CbreScraper used outside `async with` block")

        known_urls = known_urls or set()
        wanted = {m["name"] for m in match_markets(markets)}
        seen: set[str] = set()
        emitted = 0

        for usage in _USAGE_TYPES:
            if self._should_stop():
                return
            try:
                docs = await self._query(usage)
            except Exception as exc:  # noqa: BLE001 — one bad usage query shouldn't kill the source
                logger.warning("[cbre] %s query failed: %s", usage, exc)
                continue
            logger.info("[cbre] %s: %d for-sale listings nationwide", usage, len(docs))

            for doc in docs:
                if self._should_stop():
                    return

                address = _address(doc.get("Common.ActualAddress") or {})
                if not address or not _is_us_address(address):
                    continue

                # Place in a buy-box metro by exact coordinate (address fallback).
                coord = doc.get("Common.Coordinate") or {}
                lat, lng = coord.get("lat"), coord.get("lon")
                metro = market_for_coords(lat, lng) or market_for_address(address)
                if not metro or metro["name"] not in wanted:
                    continue

                sf = _building_sf(doc)
                if not _passes_sf_filter(sf):
                    continue

                pk = _clean(doc.get("Common.PrimaryKey"))
                if not pk:
                    continue
                listing_url = f"{_DETAIL}/{pk}/{_slug(address)}"
                if listing_url in seen or listing_url in known_urls:
                    continue
                seen.add(listing_url)

                ag = _agent(doc)
                yield {
                    "source":            "cbre",
                    "listing_url":       listing_url,
                    "building_type":     "Industrial",
                    "address":           address,
                    "total_sf":          sf,
                    "asking_price_psf":  None,
                    "clear_height":      None,
                    "loading_docks":     None,
                    "grade_doors":       None,
                    "zoning":            None,
                    "power":             None,
                    "sprinklered":       None,
                    "office_pct":        None,
                    "parking_ratio":     None,
                    "truck_court_depth": None,
                    "occupancy_pct":     None,
                    "walt":              None,
                    "broker_name":       ag["name"],
                    "broker_email":      ag["email"],
                    "broker_phone":      ag["phone"],
                    "asset_subtype":     doc.get("Common.UsageType") or "Industrial",
                    "status":            "Available",
                    # Exact coords ride along so the pipeline can skip geocoding.
                    "lat":               round(float(lat), 6) if isinstance(lat, (int, float)) else None,
                    "lng":               round(float(lng), 6) if isinstance(lng, (int, float)) else None,
                    "raw_data":          {"site": "cbre", "cbre_id": pk, "market": metro["name"]},
                }
                emitted += 1

        logger.info("[cbre] done — %d in-market listing(s)", emitted)
