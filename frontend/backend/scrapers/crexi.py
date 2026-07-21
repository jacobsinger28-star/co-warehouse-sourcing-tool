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
    array of {firstName,lastName,brokerage:{name,location,website},
              publicProfileId,licenses,licenseDetails:[{brokerageLicensePhone}],...}
- DETAIL  GET  https://api.crexi.com/assets/{id}
    has marketingDescription + subtypes → regex-enriched physical specs.

Broker contact — what Crexi gives, and how we backfill it
---------------------------------------------------------
Crexi gates a broker's *direct* email/cell behind a lead form: the ``/brokers``
payload carries NO ``email``/``phone`` field at all (so the old
``primary.get("phone")`` was always None). But two contact signals Crexi does
NOT gate are sitting right in that same payload, and we now capture them:

  * PHONE  — ``licenseDetails[].brokerageLicensePhone`` (the brokerage's line from
    state-license records) → ``broker_phone``. Present on a minority of listings.
  * WEBSITE + office address + license — from ``brokerage.website`` /
    ``brokerage.location`` / ``licenses`` → stashed in ``raw_data``. A website is
    present on ~90% of listings.

Then, when website enrichment is on (env ``CREXI_WEBSITE_ENRICH``, default on),
scrapers.broker_contact fetches the brokerage site (once per domain per run) for
a real office phone — backfilling ``broker_phone`` where the license phone was
absent — and for the broker's email: a *verified* address (one actually published
on the firm's site) goes to ``broker_email``; a pattern-derived guess goes to
``raw_data.broker_email_guess`` (never the verified field — see the team's
"never write a bare guess to the CRM" rule). Direct cell/personal email remains a
separate, later step (Apollo / skip-trace).

See the `crexi-api` reference note for the full schema recon.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import AsyncGenerator

import httpx

from .base import BaseScraper
from .broker_contact import BrokerContactEnricher, format_phone as _fmt_phone
from .markets import match_markets

logger = logging.getLogger(__name__)

# Fetch the brokerage's website for an office phone + email pattern. Best-effort
# and per-domain cached; set CREXI_WEBSITE_ENRICH=0 to skip it (name/license-phone
# capture from the API stays on regardless).
_WEBSITE_ENRICH = os.environ.get("CREXI_WEBSITE_ENRICH", "1").strip().lower() \
    not in ("0", "false", "no", "off")

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


def _broker_license_phone(b: dict) -> str | None:
    """The brokerage's state-license phone for one broker, if published."""
    for ld in b.get("licenseDetails") or []:
        ph = _fmt_phone(ld.get("brokerageLicensePhone"))
        if ph:
            return ph
    return None


def _license_phone(brokers: list[dict]) -> str | None:
    """First state-license brokerage phone across all brokers on the listing.
    (Co-brokers on the same listing share the firm's line, so any hit is valid.)"""
    for b in brokers:
        ph = _broker_license_phone(b)
        if ph:
            return ph
    return None


def _primary_license(b: dict) -> tuple[str | None, str | None]:
    """(license number, state code) for a broker — from ``licenses`` /
    ``licenseDetails``."""
    lic = None
    lics = b.get("licenses") or []
    if lics:
        lic = _clean(str(lics[0]))
    state = None
    for ld in b.get("licenseDetails") or []:
        if not lic:
            lic = _clean(str(ld.get("number") or "")) or None
        state = _clean(ld.get("licenseStateCode") or ld.get("brokerageStateCode"))
        if state:
            break
    return lic, state


def _brokerage_office_address(brokerage: dict) -> str | None:
    """Format a brokerage's office location as 'Street, City, ST ZIP'."""
    loc = (brokerage or {}).get("location") or {}
    street = _clean(loc.get("address"))
    city = _clean(loc.get("city"))
    state = _clean(((loc.get("state") or {}) or {}).get("code"))
    zip_ = _clean(loc.get("zip"))
    tail = " ".join(filter(None, [state, zip_]))
    parts = [p for p in (street, city, tail) if p]
    return ", ".join(parts) or None


def _broker_summary(b: dict) -> dict:
    """Compact, per-broker contact record for raw_data.all_brokers — everything
    the API hands us about one broker on the listing."""
    brokerage = b.get("brokerage") or {}
    profile_id = _clean(b.get("publicProfileId"))
    lic, state = _primary_license(b)
    return {
        "name":          _broker_full_name(b),
        "brokerage":     _clean(brokerage.get("name")),
        "website":       _clean(brokerage.get("website")),
        "office_address": _brokerage_office_address(brokerage),
        "license_phone": _broker_license_phone(b),
        "license":       lic,
        "license_state": state,
        "profile_url":   f"{_SITE}/profile/{profile_id}" if profile_id else None,
        "broker_id":     b.get("id"),
    }


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

    def __init__(self, stop_event=None, enrich_websites: bool | None = None):
        # Skip BaseScraper.__init__ — no browser needed.
        self._stop_event = stop_event
        self._client: httpx.AsyncClient | None = None
        # Website enrichment (office phone + email pattern). Defaults to the env
        # flag; callers/tests can force it on/off explicitly.
        self._enrich_websites = _WEBSITE_ENRICH if enrich_websites is None else enrich_websites
        self._enricher: BrokerContactEnricher | None = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=_HEADERS)
        if self._enrich_websites:
            self._enricher = BrokerContactEnricher(stop_event=self._stop_event)
            await self._enricher.__aenter__()
        return self

    async def __aexit__(self, *exc):
        if self._enricher:
            await self._enricher.__aexit__(*exc)
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
        brokerage = primary.get("brokerage") or {}
        broker_name = _broker_full_name(primary)
        brokerage_name = _clean(brokerage.get("name")) or _clean(a.get("brokerageName"))
        website = _clean(brokerage.get("website"))
        profile_id = _clean(primary.get("publicProfileId"))
        profile_url = f"{_SITE}/profile/{profile_id}" if profile_id else None
        license_no, license_state = _primary_license(primary)
        office_address = _brokerage_office_address(brokerage)
        all_brokers = [_broker_summary(b) for b in brokers if _broker_full_name(b)]

        # Phone from state-license records (any broker on the listing). This is a
        # real, callable office line — Crexi's own API never returns broker phone.
        broker_phone = _license_phone(brokers)

        # Website enrichment (best-effort, per-domain cached): an office phone to
        # backfill where the license phone is missing, plus a verified/guessed
        # email. Never raises into the listing.
        broker_email = None
        email_guess = None
        email_pattern = None
        brokerage_email = None
        office_phone = None
        if self._enricher and website and not self._should_stop():
            try:
                contact = await self._enricher.enrich_broker(primary)
            except Exception as exc:  # noqa: BLE001 — enrichment must never break a listing
                logger.debug("[crexi] contact enrich failed for %s: %s", listing_url, exc)
                contact = {}
            office_phone = contact.get("office_phone")
            broker_phone = broker_phone or office_phone  # prefer the license line
            broker_email = contact.get("email_verified")  # published on the firm's site
            email_guess = contact.get("email_guess")      # pattern-derived; unverified
            email_pattern = contact.get("pattern")
            brokerage_email = contact.get("brokerage_email")

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
            # Broker: NAME always; PHONE from the state license or the firm site;
            # EMAIL only when verified on the firm's site (a guess lives in
            # raw_data.broker_email_guess). See the module docstring.
            "broker_name":       broker_name,
            "broker_email":      broker_email,
            "broker_phone":      broker_phone,
            "status":            a.get("status"),
            "asset_subtype":     ", ".join(a.get("types") or []) or "Industrial",
            # Stashed in raw_data (persisted as JSON; no schema change). The
            # console + Pipedrive importer read brokerage/contact from here.
            "raw_data": {
                "site": "crexi",
                "crexi_id": asset_id,
                "market": mk["name"],
                "broker_brokerage": brokerage_name,
                "broker_brokerage_website": website,
                "broker_office_address": office_address,
                "broker_office_phone": office_phone,
                "broker_license": license_no,
                "broker_license_state": license_state,
                "broker_id": primary.get("id"),
                "broker_public_profile_id": profile_id,
                "broker_profile_url": profile_url,
                # Email the team should VERIFY (open the firm page) before CRM use.
                "broker_email_guess": email_guess,
                "broker_email_pattern": email_pattern,
                "brokerage_email": brokerage_email,
                # Richer per-broker records (name may repeat across a co-listing).
                "all_brokers": all_brokers,
                "all_broker_names": [b["name"] for b in all_brokers],
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
                # Best-effort nudge; the reader below tracks task.done(), not this.
                # A blocking put() here deadlocks at teardown once the reader stops.
                try:
                    queue.put_nowait(_DONE)
                except asyncio.QueueFull:
                    pass

        tasks = [asyncio.create_task(_scan_market(mk)) for mk in target]
        emitted = 0
        try:
            while True:
                if self._should_stop():
                    break
                # Done when every market task finished AND the queue is drained —
                # robust to a dropped _DONE (put_nowait can drop one when full).
                if all(t.done() for t in tasks) and queue.empty():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.2)
                except asyncio.TimeoutError:
                    continue
                if item is _DONE:
                    continue
                yield item
                emitted += 1
        finally:
            # Consumer stopped early (stop_event / generator closed) — reap tasks.
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

        logger.info("[crexi] done — %d new listing(s) across %d market(s)", emitted, len(target))
