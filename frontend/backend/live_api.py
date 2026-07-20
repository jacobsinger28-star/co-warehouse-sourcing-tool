"""
Live-scrape service for the sourcing console — the EasyBay engine, revived.

Runs the Playwright brokerage scrapers (CBRE / JLL / Cushman / Colliers /
Newmark / NAI / Crexi) as a background job and stores scored, geocoded listings
in SQLite (DATA_DIR volume on Railway). This process binds to localhost only;
the Node server (server.mjs) fronts it and enforces auth on every /live/* call.

Endpoints (all proxied through Node):
  POST /live/scrape    {sites?: [..], force_refresh?: bool} — start a job
  POST /live/stop      — graceful stop
  GET  /live/status    — latest job row + per-source listing counts
  GET  /live/rows      — listings transformed to the console's prop/broker shape
"""
from __future__ import annotations
import asyncio
import logging
import re
import sys
import threading
from datetime import datetime

from fastapi import FastAPI

from scorer import score_listing
from database import (
    init_db, start_job, finish_job, get_job_status, get_listings,
    upsert_listing, prune_stale_listings, get_source_counts,
    get_cached_source_counts, _conn,
)
from geocoder import geocode_sync
from scrapers.markets import market_for_coords, market_for_address

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

init_db()
app = FastAPI(title="Sourcing Console Live Scraper", version="1.0.0")

_scrape_lock = threading.Lock()
_stop_event = threading.Event()
# Per-site progress of the current/last run — the scraper mutates it, /live/status
# reads it (cross-thread dict reads are fine for display purposes).
_site_progress: dict = {}


def _run_scrape(
    job_id: int,
    enabled_sites: list[str] | None = None,
    force_refresh: bool = False,
    markets: list[str] | None = None,
):
    """Background thread: runs the Playwright scraper and stores results."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    async def _do():
        global _site_progress
        from scrapers.brokerage import BrokerageScraper
        scraper = BrokerageScraper(enabled_sites=enabled_sites or None, stop_event=_stop_event)
        # site_progress is mutated in place by the scraper — this reference stays
        # live for the whole run and /live/status reads through it.
        _site_progress = scraper.site_progress
        count = 0
        max_age_hours = 0.0 if force_refresh else 336.0  # 14 days
        run_started_at = datetime.utcnow().isoformat()
        stopped_early = False
        # markets=[] means nationwide for the crawl-based sites (the console
        # applies its own metro filter); Crexi always scopes to the target
        # metros (all of them when the list is empty), scanning them in
        # parallel. Sites themselves also run in parallel.
        gen = scraper.scrape(
            markets=markets or [], market_rents={}, max_age_hours=max_age_hours
        )
        try:
            async for listing in gen:
                if _stop_event.is_set():
                    logger.info("[scrape] stop requested — halting after %d listings", count)
                    stopped_early = True
                    break
                try:
                    scores = score_listing(listing)
                    listing["score_category"] = scores.get("Score_Category", "Unscored")
                    listing["scoring_reason"] = scores.get("Scoring_Reason", "")
                except Exception as exc:
                    logger.warning("Scoring error: %s", exc)
                    listing["score_category"] = "Unscored"
                    listing["scoring_reason"] = ""
                address = listing.get("address") or ""
                lat, lng = geocode_sync(address)
                listing["lat"] = lat
                listing["lng"] = lng
                upsert_listing(listing)
                count += 1
                logger.info("[scrape] stored listing #%d: %s", count, address)
        except Exception as exc:
            logger.error("[scrape] fatal error: %s", exc)
            finish_job(job_id, count, str(exc))
            return
        finally:
            # Breaking out of `async for` leaves the generator SUSPENDED — its
            # site/market tasks keep running and get destroyed pending at
            # loop.close(). Closing it here (in this healthy, non-cancelled task)
            # runs the scraper's finally blocks, which cancel and reap every
            # child task before we tear the loop down.
            await gen.aclose()

        # stopped_early = consumer saw the stop between items; the scraper's own
        # drain may also have cancelled its tasks and ended the generator without
        # us breaking — either way, if a stop was requested, record it as stopped
        # (never "completed") and skip pruning (a partial run must not prune).
        if stopped_early or _stop_event.is_set():
            finish_job(job_id, count, status="stopped")
            return
        if force_refresh:
            # Prune ONLY sources whose site completed the refresh — a site that
            # errored (bot wall, selector rot) keeps its existing inventory.
            ok_sources = [s for s, p in scraper.site_progress.items() if p.get("status") == "done"]
            failed = [s for s, p in scraper.site_progress.items() if p.get("status") == "error"]
            if failed:
                logger.warning("[scrape] not pruning failed site(s): %s", ", ".join(failed))
            pruned = prune_stale_listings(scraped_since=run_started_at, sources=ok_sources)
            if pruned:
                logger.info("[scrape] pruned %d stale/off-market listings", pruned)
        finish_job(job_id, count)
        logger.info("[scrape] complete — %d listings stored", count)

    try:
        loop.run_until_complete(_do())
    finally:
        loop.close()


@app.get("/live/health")
def health():
    return {"status": "ok"}


@app.post("/live/scrape")
async def start_scrape(payload: dict = None):
    payload = payload or {}
    sites = payload.get("sites") or []          # empty = all brokerages
    markets = [str(m) for m in (payload.get("markets") or []) if m]  # empty = all target metros
    force_refresh = bool(payload.get("force_refresh", False))
    with _scrape_lock:
        status = get_job_status()
        if status and status.get("status") == "running":
            return {"status": "already_running"}
        _stop_event.clear()
        job_id = start_job()
    t = threading.Thread(
        target=_run_scrape,
        args=(job_id, sites if sites else None, force_refresh, markets),
        daemon=True,
    )
    t.start()
    return {"status": "started", "job_id": job_id, "sites": sites or "all",
            "markets": markets or "all", "force_refresh": force_refresh}


@app.post("/live/stop")
def stop_scrape():
    _stop_event.set()
    return {"status": "stopping"}


@app.post("/live/import")
def live_import(payload: dict):
    """Bulk-load listings (e.g. recovered pre-override EasyBay records). Rows are
    upserted by listing_url; mark_cached=true flags them restored-from-backup so
    the UI can badge them and a future force-refresh prunes any that died."""
    rows = payload.get("listings") or []
    mark_cached = bool(payload.get("mark_cached"))
    urls, n = [], 0
    for r in rows[:1000]:
        if not isinstance(r, dict) or not r.get("listing_url") or not r.get("address"):
            continue
        upsert_listing(r)
        urls.append(r["listing_url"])
        n += 1
    if mark_cached and urls:
        with _conn() as c:
            c.executemany("UPDATE listings SET cached=1 WHERE listing_url=?", [(u,) for u in urls])
    return {"imported": n, "marked_cached": mark_cached}


@app.get("/live/status")
def live_status():
    status = get_job_status()
    result = status if status else {"status": "idle"}
    result["source_counts"] = get_source_counts()
    result["cached_source_counts"] = get_cached_source_counts()
    # Per-site progress of the current (or last) run: status/found/markets/error.
    result["sites"] = _site_progress
    return result


# ── console-shaped rows (mirrors tools/build_real_data.py::load_onmarket) ────

SOURCE_FIRM = {"colliers": "Colliers", "cushman": "Cushman & Wakefield",
               "jll": "JLL", "newmark": "Newmark", "crexi": "Crexi",
               "cbre": "CBRE", "nai": "NAI Global"}
CAT_NOMINAL = {"Actionable": 78, "Tentative": 58, "Pass": 32}


def _parse_city_state(address: str) -> tuple[str, str]:
    parts = [p.strip() for p in (address or "").split(",")]
    if len(parts) < 2:
        return "", ""
    m = re.match(r"^([A-Z]{2})\b", parts[-1])
    city = parts[-2] if m else parts[-1]
    if not re.search(r"[A-Za-z]", city):
        city = ""
    return city, (m.group(1) if m else "")


@app.get("/live/rows")
def live_rows():
    """Listings + brokers in the exact shape the console's dataset expects."""
    props, brokers = [], {}
    for r in get_listings(None):
        lat, lng = r.get("lat"), r.get("lng")
        broker = (r.get("broker_name") or "").strip()
        firm = SOURCE_FIRM.get((r.get("source") or "").lower(), (r.get("source") or "").title())
        if broker:
            key = broker.lower()
            if key not in brokers:
                brokers[key] = {"id": f"bk-{len(brokers) + 1}", "name": broker, "firm": firm,
                                "phone": r.get("broker_phone") or "—", "cell": r.get("broker_cell") or "—",
                                "email": r.get("broker_email") or "—", "mkts": "—", "spec": "Industrial",
                                "listings": 0, "source": firm, "synced": False}
            brokers[key]["listings"] += 1
        if lat is None or lng is None:
            continue
        city, st = _parse_city_state(r.get("address") or "")
        # Resolve the METRO the listing belongs to (bbox first, then address) so
        # suburb listings ("Doral", "Smyrna", "Morrisville"…) surface under their
        # market in the console — its market filter matches metro names exactly.
        metro = market_for_coords(lat, lng) or market_for_address(r.get("address"))
        mkt = metro["name"] if metro else city
        st = metro["state"] if metro else st
        street = (r.get("address") or "").split(",")[0].strip()
        cat = r.get("score_category") or "Tentative"
        reason = (r.get("scoring_reason") or "").strip()
        props.append({
            "id": f"on-{r['id']}", "channel": "on", "addr": street, "mkt": mkt, "st": st,
            "sf": int(r.get("total_sf") or 0), "cat": cat, "score": CAT_NOMINAL.get(cat, 50),
            "signal": (reason[:60] + "…") if len(reason) > 61 else (reason or "Listed"),
            "broker": broker or "—", "firm": firm,
            "ask": round(r["asking_price_psf"], 2) if r.get("asking_price_psf") else None,
            "clear": int(r["clear_height"]) if r.get("clear_height") else None,
            "year": None, "contact": "Broker contact" if broker else "Listing only",
            "daysOn": None, "lat": round(float(lat), 6), "lng": round(float(lng), 6),
            "listing_url": r.get("listing_url"),
        })
    return {"props": props, "brokers": list(brokers.values()), "total": len(props)}
