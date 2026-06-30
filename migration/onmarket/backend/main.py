"""
FastAPI backend for Easybay Sourcing Tool.
In production the built React app is served from ./static.
"""
from __future__ import annotations
import asyncio
import io
import json
import logging
import os
import sys
import threading
from datetime import datetime

import pandas as pd
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from scorer import score_dataframe, score_listing
from excel_generator import generate_excel
from email_service import send_report
from database import init_db, start_job, finish_job, get_job_status, get_listings, upsert_listing, clear_listings, prune_stale_listings, get_source_counts, get_cached_source_counts, set_broker_cell
from geocoder import geocode_sync
from pipedrive import create_deal as _pipedrive_create_deal

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

init_db()

app = FastAPI(title="Easybay Sourcing Tool", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Existing upload-and-score endpoints (unchanged)
# ---------------------------------------------------------------------------

def _read_upload(file: UploadFile) -> pd.DataFrame:
    content = file.file.read()
    filename = file.filename or ""
    if filename.endswith(".csv"):
        return pd.read_csv(io.BytesIO(content))
    return pd.read_excel(io.BytesIO(content), engine="openpyxl")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/template")
def download_template():
    path = os.path.join(os.path.dirname(__file__), "Leads_Template.xlsx")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Template not found.")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Leads_Template.xlsx"'},
    )


@app.post("/demo/score")
async def score_demo():
    """Run the scorer against the bundled Test_Leads_v2.xlsx so the UI has
    one-click demo data. Returns the same shape as /score."""
    test_path = os.path.join(os.path.dirname(__file__), "..", "Test_Leads_v2.xlsx")
    test_path = os.path.normpath(test_path)
    if not os.path.isfile(test_path):
        # Fall back to the template if the test file isn't shipped
        test_path = os.path.join(os.path.dirname(__file__), "Leads_Template.xlsx")
    if not os.path.isfile(test_path):
        raise HTTPException(status_code=404, detail="No demo file available.")
    try:
        df = pd.read_excel(test_path, engine="openpyxl")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read demo file: {exc}")
    scored = score_dataframe(df)
    counts = scored["Score_Category"].value_counts().to_dict()
    summary = {
        "total":      len(scored),
        "actionable": counts.get("Actionable", 0),
        "tentative":  counts.get("Tentative", 0),
        "passed":     counts.get("Pass", 0),
    }
    records = json.loads(scored.to_json(orient="records"))
    return {
        "summary": summary,
        "rows": records,
        "analyst_name": "Demo",
        "demo": True,
        "source_file": os.path.basename(test_path),
    }


@app.post("/score")
async def score_upload(file: UploadFile = File(...), analyst_name: str = Form("")):
    try:
        df = _read_upload(file)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}")
    if df.empty:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    scored = score_dataframe(df)
    counts = scored["Score_Category"].value_counts().to_dict()
    summary = {
        "total":      len(scored),
        "actionable": counts.get("Actionable", 0),
        "tentative":  counts.get("Tentative", 0),
        "passed":     counts.get("Pass", 0),
    }
    records = json.loads(scored.to_json(orient="records"))
    return {"summary": summary, "rows": records, "analyst_name": analyst_name}


@app.post("/download")
async def download_excel(file: UploadFile = File(...), analyst_name: str = Form("")):
    try:
        df = _read_upload(file)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}")
    scored = score_dataframe(df)
    excel_bytes, filename = generate_excel(scored, analyst_name=analyst_name)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/send-email")
async def send_email(
    file: UploadFile = File(...),
    recipient_emails: str = Form(...),
    sender_email: str = Form(""),
    analyst_name: str = Form(""),
):
    recipients = [e.strip() for e in recipient_emails.split(",") if e.strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="At least one recipient email is required.")
    try:
        df = _read_upload(file)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}")
    scored = score_dataframe(df)
    excel_bytes, filename = generate_excel(scored, analyst_name=analyst_name)
    try:
        result = send_report(
            scored_df=scored,
            excel_bytes=excel_bytes,
            excel_filename=filename,
            recipient_emails=recipients,
            sender_email=sender_email or None,
            analyst_name=analyst_name,
        )
    except EnvironmentError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Email delivery failed: {exc}")
    counts = scored["Score_Category"].value_counts().to_dict()
    return {
        "message": f"Report sent to {', '.join(recipients)}",
        "summary": {
            "total":      len(scored),
            "actionable": counts.get("Actionable", 0),
            "tentative":  counts.get("Tentative", 0),
            "passed":     counts.get("Pass", 0),
        },
        "email_result": result,
    }


# ---------------------------------------------------------------------------
# Pipedrive import
# ---------------------------------------------------------------------------

@app.post("/pipedrive/import")
async def pipedrive_import(payload: dict):
    rows = payload.get("rows", [])
    analyst_name = payload.get("analyst_name", "")
    if not rows:
        raise HTTPException(status_code=400, detail="No rows provided.")

    # Buy-box guardrail: only push brokers whose listing is in a target market
    # (Charlotte / Raleigh / Charleston / Columbus / Miami / Boca / West Palm).
    # This enforces "only for these markets" regardless of which scraper sourced
    # the listing, and prevents the out-of-market leak (memory note: 53 of 54
    # uploaded brokers were out-of-market). Override with restrict_to_markets=false.
    skipped_out_of_market: list[str] = []
    if payload.get("restrict_to_markets", True):
        from scrapers.markets import is_in_target_market
        in_market = []
        for r in rows:
            if is_in_target_market(r):
                in_market.append(r)
            else:
                skipped_out_of_market.append(r.get("address") or r.get("listing_url") or "Unknown")
        rows = in_market
        if skipped_out_of_market:
            logger.info("[pipedrive] skipped %d out-of-market row(s)", len(skipped_out_of_market))
        if not rows:
            return {
                "imported": 0,
                "failed": 0,
                "results": [],
                "skipped_out_of_market": skipped_out_of_market,
            }

    # Best-effort: render broker landing pages to find a labeled mobile number
    # for the rows being sent. Only the selected rows are fetched (cheap), and
    # any failure just leaves broker_cell empty — the listed phone still flows
    # through. Disable with BROKER_BIO_FETCH=0.
    if os.getenv("BROKER_BIO_FETCH", "1") != "0":
        try:
            from scrapers.broker_bio import fetch_broker_cells
            cells = await fetch_broker_cells(rows)
            for row in rows:
                cell = cells.get(row.get("listing_url"))
                if cell:
                    row["broker_cell"] = cell
                    try:
                        set_broker_cell(row["listing_url"], cell)
                    except Exception:  # noqa: BLE001 — persistence is best-effort
                        pass
            if cells:
                logger.info("[pipedrive] enriched %d broker cell(s)", len(cells))
        except Exception as exc:  # noqa: BLE001 — never block the import
            logger.warning("[pipedrive] broker-cell enrichment failed: %s", exc)

    results = []
    for row in rows:
        try:
            deal = _pipedrive_create_deal(row, analyst_name=analyst_name)
            results.append({"success": True, "deal_id": deal.get("id"), "title": deal.get("title")})
        except Exception as exc:
            logger.warning("Pipedrive import error: %s", exc)
            results.append({"success": False, "error": str(exc), "title": row.get("address", "Unknown")})
    imported = sum(1 for r in results if r["success"])
    return {
        "imported": imported,
        "failed": len(results) - imported,
        "results": results,
        "skipped_out_of_market": skipped_out_of_market,
    }


# ---------------------------------------------------------------------------
# Live nationwide scrape
# ---------------------------------------------------------------------------

_scrape_lock = threading.Lock()
_stop_event  = threading.Event()   # set() to request a graceful stop


def _run_scrape(job_id: int, enabled_sites: list[str] | None = None, force_refresh: bool = False):
    """Background thread: runs the Playwright scraper and stores results."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    async def _do():
        from scrapers.brokerage import BrokerageScraper
        scraper = BrokerageScraper(enabled_sites=enabled_sites or None, stop_event=_stop_event)
        count = 0
        # max_age_hours=0 forces re-fetch of every listing (full refresh mode)
        max_age_hours = 0.0 if force_refresh else 336.0  # 14 days
        # Snapshot the start time so we can prune stale listings after a full refresh
        run_started_at = datetime.utcnow().isoformat()
        stopped_early = False
        try:
            # markets=[] means nationwide — no geographic filtering
            async for listing in scraper.scrape(markets=[], market_rents={}, max_age_hours=max_age_hours):
                # Check for stop request before processing each listing
                if _stop_event.is_set():
                    logger.info("[scrape] stop requested — halting after %d listings", count)
                    stopped_early = True
                    break

                # Physical-only scoring (no market rent → no financial calc)
                try:
                    scores = score_listing(listing)
                    listing["score_category"] = scores.get("Score_Category", "Unscored")
                    listing["scoring_reason"] = scores.get("Scoring_Reason", "")
                except Exception as exc:
                    logger.warning("Scoring error: %s", exc)
                    listing["score_category"] = "Unscored"
                    listing["scoring_reason"] = ""

                # Geocode for map pins (cached after first run)
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

        if stopped_early:
            finish_job(job_id, count, status="stopped")
            logger.info("[scrape] stopped by user — %d listings stored", count)
            return

        # After a forced full-refresh, remove listings that were NOT touched during
        # this run — they no longer appear on any brokerage site (sold / removed).
        if force_refresh:
            pruned = prune_stale_listings(scraped_since=run_started_at)
            if pruned:
                logger.info("[scrape] pruned %d stale/off-market listings", pruned)

        finish_job(job_id, count)
        logger.info("[scrape] complete — %d listings stored", count)

    try:
        loop.run_until_complete(_do())
    finally:
        loop.close()


@app.post("/live/scrape")
async def start_scrape(payload: dict = None):
    payload = payload or {}
    sites         = payload.get("sites") or []     # empty = all brokerages
    force_refresh = bool(payload.get("force_refresh", False))
    with _scrape_lock:
        status = get_job_status()
        if status and status.get("status") == "running":
            return {"status": "already_running"}
        _stop_event.clear()   # reset any previous stop signal
        job_id = start_job()

    t = threading.Thread(
        target=_run_scrape,
        args=(job_id, sites if sites else None, force_refresh),
        daemon=True,
    )
    t.start()
    return {"status": "started", "job_id": job_id, "sites": sites or "all", "force_refresh": force_refresh}


@app.post("/live/stop")
def stop_scrape():
    """Request a graceful stop of the running scrape."""
    _stop_event.set()
    return {"status": "stopping"}


@app.delete("/live/listings")
def delete_listings():
    """Clear all cached listings from the database."""
    clear_listings()
    return {"status": "cleared"}


@app.get("/live/status")
def live_status():
    status = get_job_status()
    result = status if status else {"status": "idle"}
    result["source_counts"] = get_source_counts()
    # Per-source count of listings still flagged as restored-from-backup.
    # UI shows a 📦 badge on chips where this is > 0.
    result["cached_source_counts"] = get_cached_source_counts()
    return result


@app.get("/live/listings")
def live_listings(score_category: str | None = Query(default=None)):
    rows = get_listings(score_category)
    return {"listings": rows, "total": len(rows)}


# ---------------------------------------------------------------------------
# Serve React static files (production)
# ---------------------------------------------------------------------------
_static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(_static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        return FileResponse(os.path.join(_static_dir, "index.html"))
