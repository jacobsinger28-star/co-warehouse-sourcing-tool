"""
Crexi scraper — direct API approach (the free on-market source for the buy-box).

Why Crexi
---------
The buy-box markets (Charlotte, Raleigh, Charleston, Columbus, Miami, Boca Raton,
West Palm Beach) are barely covered by Colliers SalesTracker. Crexi
(crexi.com) carries hundreds of on-market industrial-for-sale listings across
exactly these Southeast + Columbus markets, and — like Colliers/RCM — exposes a
no-auth JSON API, so we can pull it server-side with httpx (no browser at
runtime).

Endpoints (decoded from crexi.com's Angular bundle; no auth required)
--------------------------------------------------------------------
- SEARCH  POST https://api.crexi.com/assets/search
    body: {types, count, offset, latitudeMin/Max, longitudeMin/Max,
           includeUnpriced:true, sortOrder, sortDirection, mlScenario}
    `includeUnpriced` is REQUIRED. Pagination is `count` (page size) + `offset`.
    Market scoping is a lat/long bounding box (see scrapers.markets). The default
    scope is for-sale. Response: {data:[...], totalCount}.
- BROKERS GET  https://api.crexi.com/assets/{id}/brokers
    array of {firstName,lastName,brokerage:{name,location},publicProfileId,...}
- DETAIL  GET  https://api.crexi.com/assets/{id}
    has marketingDescription + subtypes → regex-enriched physical specs.

Broker-contact limitation
-------------------------
Crexi gates broker email/phone behind a lead form — the API returns them as
null. So this scraper captures the broker's NAME + BROKERAGE (+ a clickable
Crexi profile/listing URL), not a phone/email. That's still an actionable lead
(the team contacts via the brokerage / Crexi). Cell/email enrichment is a
separate, later step (Apollo / skip-trace).

See the `crexi-api` reference note for the full schema recon.
"""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator

import httpx

from .base import BaseScraper
from .markets import match_markets

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Endpoint config
# ---------------------------------------------------------------------------

_API_BASE = "https://api.crexi.com"
_SEARCH = f"{_API_BASE}/assets/search"
_SITE = "https://www.crexi.com"

# Crexi caps the page at ~60 regardless of higher values; 60 is the site default.
_PAGE_SIZE = 60
# Defensive page cap per market (a single metro box holds well under this).
_MAX_PAGES = 25
# Concurrent detail+broker fetches ACROSS the whole run (shared semaphore), so
# scanning markets in parallel can't multiply request pressure. Each kept
# candidate needs 1-2 GETs.
_ENRICH_CONCURRENCY = 6
# Metro bounding boxes scanned concurrently. Each market still pages politely
# (0.4s between pages) and shares the enrichment semaphore above.
_MARKET_CONCURRENCY = 4

# Statuses we never want to surface — this is a for-sale sourcing tool, so drop
# closed/withdrawn inventory. Anything else (On-Market, Under Contract, Auction)
# is kept.
_DEAD_STATUSES = {"sold", "closed", "off-market", "off market", "inactive", "withdrawn"}

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_HEADERS = {
    "User-Agent": _UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": _SITE,
    "Referer": f"{_SITE}/",
    "Content-Type": "application/json",
}


def _clean(s) -> str | None:
    if s is None:
        return None
    s = " ".join(str(s).split()).strip()
    return s or None


def _broker_full_name(b: dict) -> str | None:
    name = " ".join(filter(None, [_clean(b.get("firstName")), _clean(b.get("lastName"))]))
    return name or None


def _detail_sf(d: dict) -> float | None:
    """Building square footage from the asset detail. The search summary often
    omits SF; the detail carries it structurally in summaryDetails (key
    'SquareFootage', a number or [min,max]) or as the 'Square Footage' string in
    `details`. Returns the largest figure (a range's top ≈ building size).
    Returns None for land/development listings that have no building SF — those
    fall through `_passes_sf_filter` as unknown, same as the other scrapers."""
    import re as _re
    for item in d.get("summaryDetails") or []:
        if item.get("key") == "SquareFootage":
            v = item.get("value")
            nums: list[float] = []
            if isinstance(v, list):
                nums = [float(x) for x in v if isinstance(x, (int, float))]
            elif isinstance(v, (int, float)):
                nums = [float(v)]
            if nums:
                return max(nums)
    s = (d.get("details") or {}).get("Square Footage")
    if s:
        nums = [float(x.replace(",", "")) for x in _re.findall(r"[\d,]+", str(s)) if x.strip(",")]
        if nums:
            return max(nums)
    return None


class CrexiScraper(BaseScraper):
    """Direct-API scraper for Crexi, scoped to the buy-box target markets.

    Subclasses BaseScraper for the SOURCE convention + stop_event hook, but skips
    the Playwright browser setup — it uses httpx (mirrors ColliersScraper).
    """

    SOURCE = "crexi"

    def __init__(self, stop_event=None):
        # Skip BaseScraper.__init__ — no browser needed.
        self._stop_event = stop_event
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=_HEADERS)
        return self

    async def __aexit__(self, *_):
        if self._client:
            await self._client.aclose()

    def _should_stop(self) -> bool:
        return self._stop_event is not None and self._stop_event.is_set()

    # --- API calls ---------------------------------------------------------

    async def _search(self, bbox, offset: int) -> dict:
        lat_min, lat_max, lng_min, lng_max = bbox
        body = {
            "types": ["industrial"],
            "count": _PAGE_SIZE,
            "offset": offset,
            "includeUnpriced": True,
            "latitudeMin": lat_min,
            "latitudeMax": lat_max,
            "longitudeMin": lng_min,
            "longitudeMax": lng_max,
            "sortOrder": "Rank",
            "sortDirection": "Descending",
            "mlScenario": "search-properties",
        }
        r = await self._client.post(_SEARCH, json=body)
        r.raise_for_status()
        return r.json()

    async def _fetch_brokers(self, asset_id) -> list[dict]:
        try:
            r = await self._client.get(f"{_API_BASE}/assets/{asset_id}/brokers")
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else []
        except Exception as exc:  # noqa: BLE001 — broker fetch is best-effort
            logger.debug("[crexi] broker fetch failed for %s: %s", asset_id, exc)
            return []

    async def _fetch_detail_specs(self, asset_id) -> dict:
        """Best-effort building SF + physical specs from the asset detail.
        SF comes from the structured fields; the other specs are regex-pulled
        from the marketing copy via the shared brokerage helpers."""
        try:
            r = await self._client.get(f"{_API_BASE}/assets/{asset_id}")
            r.raise_for_status()
            d = r.json()
        except Exception as exc:  # noqa: BLE001
            logger.debug("[crexi] detail fetch failed for %s: %s", asset_id, exc)
            return {}

        out: dict = {}
        sf = _detail_sf(d)
        if sf is not None:
            out["total_sf"] = sf

        text = " ".join(
            filter(None, [
                _clean(d.get("marketingDescription")),
                _clean(d.get("description")),
                " ".join(d.get("subtypes") or []),
            ])
        )
        if not text:
            return out

        from .brokerage import (
            _re_clear_height, _re_docks, _re_grade_doors, _re_zoning, _re_power,
            _re_sprinkler, _re_office_pct, _re_parking, _re_truck_court,
            _re_occupancy, _re_walt,
        )
        specs = {
            "clear_height":      _re_clear_height(text),
            "loading_docks":     _re_docks(text),
            "grade_doors":       _re_grade_doors(text),
            "zoning":            _re_zoning(text),
            "power":             _re_power(text),
            "sprinklered":       _re_sprinkler(text),
            "office_pct":        _re_office_pct(text),
            "parking_ratio":     _re_parking(text),
            "truck_court_depth": _re_truck_court(text),
            "occupancy_pct":     _re_occupancy(text),
            "walt":              _re_walt(text),
        }
        # Drop None values so they don't overwrite anything downstream.
        out.update({k: v for k, v in specs.items() if v is not None})
        return out

    # --- per-listing enrichment -------------------------------------------

    async def _enrich_asset(
        self, a: dict, mk: dict, listing_url: str, address: str, search_sf,
    ) -> dict | None:
        """Detail + broker enrichment for one kept candidate. Fetches the asset
        detail first (building SF the search omits, + regex-able specs), applies
        the buy-box SF gate, then fetches brokers. Returns the normalized listing
        dict, or None if it fails the (backfilled) SF gate."""
        from .brokerage import _passes_sf_filter

        asset_id = a.get("id")

        specs = await self._fetch_detail_specs(asset_id)
        final_sf = float(search_sf) if search_sf else specs.get("total_sf")
        if not _passes_sf_filter(final_sf):
            return None

        price_total = a.get("askingPrice")
        price_psf = None
        if price_total and final_sf and final_sf > 0:
            price_psf = round(float(price_total) / float(final_sf), 2)

        brokers = await self._fetch_brokers(asset_id)
        primary = brokers[0] if brokers else {}
        broker_name = _broker_full_name(primary)
        brokerage_name = _clean((primary.get("brokerage") or {}).get("name")) \
            or _clean(a.get("brokerageName"))
        profile_id = _clean(primary.get("publicProfileId"))
        profile_url = f"{_SITE}/profile/{profile_id}" if profile_id else None
        all_brokers = [n for n in (_broker_full_name(b) for b in brokers) if n]

        return {
            "source":            "crexi",
            "listing_url":       listing_url,
            "building_type":     "Industrial",
            "address":           address,
            "total_sf":          final_sf,
            "asking_price_psf":  price_psf,
            "asking_price_total": price_total,
            # Physical specs: regex-enriched where the detail copy had them, else
            # None (same default shape as the other scrapers).
            "clear_height":      specs.get("clear_height"),
            "loading_docks":     specs.get("loading_docks"),
            "grade_doors":       specs.get("grade_doors"),
            "zoning":            specs.get("zoning"),
            "power":             specs.get("power"),
            "sprinklered":       specs.get("sprinklered"),
            "office_pct":        specs.get("office_pct"),
            "parking_ratio":     specs.get("parking_ratio"),
            "truck_court_depth": specs.get("truck_court_depth"),
            "occupancy_pct":     specs.get("occupancy_pct"),
            "walt":              specs.get("walt"),
            # Broker: name only — Crexi gates email/phone (see module docstring).
            # pass-through in case the API ever returns them.
            "broker_name":       broker_name,
            "broker_email":      _clean(primary.get("email")),
            "broker_phone":      _clean(primary.get("phone")),
            "status":            a.get("status"),
            "asset_subtype":     ", ".join(a.get("types") or []) or "Industrial",
            # Stashed in raw_data (persisted as JSON; no schema change). The
            # Pipedrive importer reads brokerage/profile from here.
            "raw_data": {
                "site": "crexi",
                "crexi_id": asset_id,
                "market": mk["name"],
                "broker_brokerage": brokerage_name,
                "broker_profile_url": profile_url,
                "all_broker_names": all_brokers,
                "status": a.get("status"),
            },
        }

    # --- main entry --------------------------------------------------------

    async def scrape(
        self,
        markets: list[str],
        market_rents: dict[str, float],
        known_urls: set[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Yield normalized industrial-for-sale listing dicts for the buy-box
        markets. Honors self._stop_event and known_urls (cached listings skip the
        per-listing broker/detail fetches)."""
        from .brokerage import _passes_sf_filter, _is_us_address

        if not self._client:
            raise RuntimeError("CrexiScraper used outside `async with` block")

        known_urls = known_urls or set()
        target = match_markets(markets)
        logger.info("[crexi] scanning %d target market(s) (%d at a time): %s",
                    len(target), min(_MARKET_CONCURRENCY, len(target)),
                    ", ".join(m["name"] for m in target))

        # Shared across all market tasks. Everything runs on one event loop, so
        # plain set/int mutation between awaits is safe.
        seen_in_run: set[str] = set()
        enrich_sem = asyncio.Semaphore(_ENRICH_CONCURRENCY)
        market_sem = asyncio.Semaphore(_MARKET_CONCURRENCY)
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        _DONE = object()  # per-market completion marker

        async def _scan_market(mk: dict) -> None:
            market_emitted = 0
            try:
                async with market_sem:
                    offset = 0
                    market_total = None
                    for _ in range(_MAX_PAGES):
                        if self._should_stop():
                            return
                        try:
                            payload = await self._search(mk["bbox"], offset)
                        except Exception as exc:
                            logger.warning("[crexi] %s search failed at offset=%d: %s",
                                           mk["name"], offset, exc)
                            return
                        data = payload.get("data") or []
                        total = payload.get("totalCount") or 0
                        if market_total is None:
                            market_total = total
                            logger.info("[crexi] %s: %d industrial-for-sale listings in box",
                                        mk["name"], total)
                        if not data:
                            return

                        # Cheap filters first → candidate list, then enrich concurrently.
                        candidates: list[tuple] = []
                        for a in data:
                            status = (a.get("status") or "").strip().lower()
                            if status in _DEAD_STATUSES:
                                continue
                            sf = a.get("squareFootage")
                            if not _passes_sf_filter(sf):
                                continue
                            locs = a.get("locations") or []
                            loc = locs[0] if locs else {}
                            address = _clean(loc.get("fullAddress")) or _clean(a.get("name"))
                            if not address or not _is_us_address(address):
                                continue
                            asset_id = a.get("id")
                            slug = a.get("urlSlug") or ""
                            listing_url = f"{_SITE}/properties/{asset_id}/{slug}".rstrip("/")
                            if listing_url in seen_in_run:
                                continue
                            seen_in_run.add(listing_url)
                            if listing_url in known_urls:
                                continue
                            candidates.append((a, address, sf, listing_url))

                        async def _do(a, address, sf, url):
                            async with enrich_sem:
                                try:
                                    return await self._enrich_asset(a, mk, url, address, sf)
                                except Exception as exc:  # noqa: BLE001 — isolate per-listing
                                    logger.debug("[crexi] enrich failed %s: %s", url, exc)
                                    return None

                        results = (
                            await asyncio.gather(*[_do(*c) for c in candidates])
                            if candidates else []
                        )
                        for r in results:
                            if r:
                                await queue.put(r)
                                market_emitted += 1

                        offset += len(data)
                        if market_total is not None and offset >= market_total:
                            return
                        await asyncio.sleep(0.4)  # politeness between pages
            finally:
                logger.info("[crexi] %s — emitted %d new listing(s)", mk["name"], market_emitted)
                await queue.put(_DONE)

        tasks = [asyncio.create_task(_scan_market(mk)) for mk in target]
        emitted = 0
        markets_done = 0
        try:
            while markets_done < len(tasks):
                item = await queue.get()
                if item is _DONE:
                    markets_done += 1
                    continue
                yield item
                emitted += 1
        finally:
            # Consumer stopped early (stop_event / generator closed) — reap tasks.
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

        logger.info("[crexi] done — %d new listing(s) across %d market(s)", emitted, len(target))
