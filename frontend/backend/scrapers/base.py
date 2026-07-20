"""Base scraper: async Playwright setup with stealth and shared helpers."""
from __future__ import annotations

import asyncio
import logging
import random
from typing import Any, AsyncGenerator

logger = logging.getLogger(__name__)

# Human-like delay range (seconds)
_DELAY_MIN = 1.5
_DELAY_MAX = 4.0


class BaseScraper:
    SOURCE: str = "unknown"

    # Stealth JS injected before every page load to mask headless indicators
    _STEALTH_INIT = """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };
        try {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(p) {
                if (p === 37445) return 'Intel Inc.';
                if (p === 37446) return 'Intel Iris OpenGL Engine';
                return getParameter.call(this, p);
            };
        } catch(e) {}
    """

    def __init__(self, headless: bool = True):
        self.headless = headless
        self._browser = None
        self._context = None

    async def __aenter__(self):
        from playwright.async_api import async_playwright
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        self._context = await self._browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/Los_Angeles",
            extra_http_headers={
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;"
                    "q=0.9,image/avif,image/webp,*/*;q=0.8"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "sec-ch-ua": (
                    '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"'
                ),
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "Upgrade-Insecure-Requests": "1",
            },
        )
        await self._context.add_init_script(self._STEALTH_INIT)
        return self

    async def __aexit__(self, *_):
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    async def new_page(self):
        page = await self._context.new_page()
        await page.add_init_script(self._STEALTH_INIT)
        return page

    async def new_bare_page(self):
        """Return (page, context) for a context with no extra_http_headers.

        Some sites reject requests when browser-hint headers like sec-ch-ua are
        present. Caller must close the returned context when done.
        """
        ctx = await self._browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/Los_Angeles",
        )
        await ctx.add_init_script(self._STEALTH_INIT)
        page = await ctx.new_page()
        return page, ctx

    @staticmethod
    async def _human_delay(min_s: float = _DELAY_MIN, max_s: float = _DELAY_MAX):
        await asyncio.sleep(random.uniform(min_s, max_s))

    @staticmethod
    def _safe_float(val: Any) -> float | None:
        if val is None:
            return None
        import re
        try:
            cleaned = re.sub(r"[,$%\s]", "", str(val))
            return float(cleaned) if cleaned else None
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _sf_from_text(text: str) -> float | None:
        """Parse '45,000 SF' or '45000 sq ft' into a float."""
        import re
        m = re.search(r"([\d,]+)\s*(?:sf|sq\.?\s*ft)", text, re.IGNORECASE)
        if m:
            return float(m.group(1).replace(",", ""))
        return None

    @staticmethod
    def _psf_from_text(text: str) -> float | None:
        """Parse '$85/SF' or '$85 PSF' into a float."""
        import re
        m = re.search(r"\$?([\d,.]+)\s*(?:/sf|psf)", text, re.IGNORECASE)
        if m:
            return float(m.group(1).replace(",", ""))
        return None

    async def scrape(self, markets: list[str], market_rents: dict[str, float]) -> AsyncGenerator[dict, None]:
        """Yield normalized listing dicts. Override in subclasses."""
        raise NotImplementedError
        yield {}  # noqa: unreachable — makes this an async generator
