"""Broker-bio fetch — best-effort extraction of a broker's *mobile* number.

The Colliers/RCM listing card exposes a single, unlabeled phone per broker
(usually their direct/office line). A broker's separately-labeled mobile, when
they publish one, only appears on the JS-rendered RCM landing page. This module
renders that page with Playwright and pulls a Mobile/Cell-labeled number out of
the rendered text.

It is intentionally *best-effort*:
  * Lazy Playwright import, so the backend imports fine where Chromium isn't
    installed (local dev) — the deploy image has it pre-installed.
  * Any failure (no browser, timeout, no mobile published) returns None. The
    caller then falls back to the listed phone, so enabling this can only ever
    *add* cell numbers — never block a Pipedrive import.
"""
from __future__ import annotations

import asyncio
import logging
import re

logger = logging.getLogger(__name__)

# Only RCM-backed landing pages carry a renderable broker contact card.
_RCM_HOST_RE = re.compile(r"rcm1\.com", re.I)

# US phone core: optional +1, area code (paren optional), 3-4 split on any of
# space / dot / dash. Kept loose on purpose — broker cards format wildly.
_PHONE = r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}"

# Tried in order; first match wins. All require an explicit mobile/cell cue so
# we never mistake the office/direct line for a cell.
_CELL_PATTERNS = [
    re.compile(rf"(?:mobile|cell)(?:\s*(?:phone|no\.?|#))?\s*[:#\-]?\s*({_PHONE})", re.I),
    re.compile(rf"\(\s*(?:m|c|mobile|cell)\s*\)\s*({_PHONE})", re.I),
    re.compile(rf"\b[MC]\s*[:.\-]\s*({_PHONE})", re.I),
]

# How long to wait for the SPA's contact card to render, per page.
_PAGE_TIMEOUT_MS = 20_000


def _normalize(num: str | None) -> str | None:
    """Return num only if it carries a plausible 10/11-digit US number."""
    if not num:
        return None
    digits = re.sub(r"\D", "", num)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return num.strip() if len(digits) == 10 else None


def _extract_cell(text: str) -> str | None:
    for pat in _CELL_PATTERNS:
        m = pat.search(text)
        if m:
            cell = _normalize(m.group(1))
            if cell:
                return cell
    return None


async def _fetch_one(page, url: str) -> str | None:
    try:
        await page.goto(url, wait_until="networkidle", timeout=_PAGE_TIMEOUT_MS)
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.debug("[broker_bio] goto failed %s: %s", url, exc)
        return None
    try:
        text = await page.inner_text("body")
    except Exception:  # noqa: BLE001
        return None
    return _extract_cell(text or "")


async def fetch_broker_cells(rows: list[dict]) -> dict[str, str]:
    """Render the RCM landing page for each eligible row and return
    {listing_url: cell} for the rows where a mobile number was found.

    Eligible = an RCM landing URL and no broker_cell already known. Rows that
    aren't RCM-backed, or already have a cell, are skipped. Returns {} if
    Playwright/Chromium is unavailable.
    """
    targets = [
        r["listing_url"]
        for r in rows
        if r.get("listing_url")
        and not r.get("broker_cell")
        and _RCM_HOST_RE.search(str(r["listing_url"]))
    ]
    if not targets:
        return {}

    try:
        from playwright.async_api import async_playwright
    except Exception as exc:  # noqa: BLE001 — Chromium not installed (local dev)
        logger.info("[broker_bio] Playwright unavailable, skipping cell fetch: %s", exc)
        return {}

    found: dict[str, str] = {}
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()
            for url in targets:
                cell = await _fetch_one(page, url)
                if cell:
                    found[url] = cell
                    logger.info("[broker_bio] found cell for %s", url)
            await browser.close()
    except Exception as exc:  # noqa: BLE001 — never let enrichment break import
        logger.warning("[broker_bio] fetch aborted: %s", exc)

    return found


def fetch_broker_cells_sync(rows: list[dict]) -> dict[str, str]:
    """Sync wrapper for callers outside an event loop."""
    try:
        return asyncio.run(fetch_broker_cells(rows))
    except RuntimeError as exc:  # already in a loop — caller should await instead
        logger.warning("[broker_bio] sync wrapper called inside a loop: %s", exc)
        return {}
