"""Concurrency contract of BrokerageScraper.scrape() (scrapers/brokerage.py).

These are the regression tests for the parallel-site rework: normal completion
collects everything, a failing site doesn't sink the run, and — the important
one — Stop tears the run down promptly WITHOUT hanging or leaking tasks. That
last case guards the teardown deadlock where a cancelled site task blocked
forever on a full queue trying to post its completion sentinel.

The real per-site scrapers (Playwright/httpx) are replaced with a fake async
generator, so there is no browser and no network. All sites are marked
`crexi_mode` (API-mode) so scrape() never launches Chromium.
"""
import asyncio
import threading
import unittest

from scrapers.brokerage import BrokerageScraper


def _build(n_sites, items_per_site, stop_event=None, item_delay=0.0, raiser=None):
    """A scraper whose sites are fakes. `raiser` = a site name that throws
    partway through (to test per-site isolation)."""
    sc = BrokerageScraper(stop_event=stop_event)
    sc._sites = [{"name": f"fake{i}", "crexi_mode": True} for i in range(n_sites)]

    async def fake_site_listings(site, market_patterns_or_page, *rest):
        name = site["name"]
        for j in range(items_per_site):
            if sc._should_stop():
                return
            await asyncio.sleep(item_delay)  # 0 still yields control
            if raiser and name == raiser and j == 2:
                raise RuntimeError(f"{name} boom")
            yield {
                "listing_url": f"{name}-{j}",
                "address": f"{j} Main St, Nashville, TN 37210",
                "raw_data": {"market": "Nashville"},
            }

    sc._site_listings = fake_site_listings
    return sc


def _pending_leaks(before):
    return [
        t
        for t in (set(asyncio.all_tasks()) - before)
        if not t.done() and t is not asyncio.current_task()
    ]


class TestScrapeEngine(unittest.TestCase):
    def test_normal_completion_collects_all(self):
        async def run():
            sc = _build(3, 20)
            got = [x async for x in sc.scrape([], {}, max_age_hours=0)]
            return got, sc

        got, sc = asyncio.run(run())
        self.assertEqual(len(got), 60)
        self.assertEqual(len({g["listing_url"] for g in got}), 60)  # no dupes/loss
        # per-site progress recorded
        self.assertTrue(all(p["status"] == "done" for p in sc.site_progress.values()))
        self.assertEqual(sum(p["found"] for p in sc.site_progress.values()), 60)

    def test_failing_site_isolated(self):
        async def run():
            sc = _build(3, 10, raiser="fake1")
            got = [x async for x in sc.scrape([], {}, max_age_hours=0)]
            return got, sc

        got, sc = asyncio.run(run())
        # fake1 raised at j==2 (after yielding 2); fake0 + fake2 give 10 each
        self.assertEqual(len(got), 22)
        self.assertEqual(sc.site_progress["fake1"]["status"], "error")
        self.assertEqual(sc.site_progress["fake0"]["status"], "done")

    def test_stop_teardown_no_deadlock_no_leak(self):
        """Fast producers + a slow consumer fill the bounded queue; then the
        consumer stops. Teardown must finish quickly and reap every task."""

        async def run():
            ev = threading.Event()
            sc = _build(3, 5000, stop_event=ev, item_delay=0.0)
            before = set(asyncio.all_tasks())
            gen = sc.scrape([], {}, max_age_hours=0)
            got = []

            async def consume():
                try:
                    async for x in gen:
                        got.append(x)
                        if len(got) >= 10:
                            ev.set()
                            break
                        await asyncio.sleep(0.02)  # slow consumer → queue fills
                finally:
                    await gen.aclose()  # the teardown that used to deadlock

            # A regressed deadlock hangs aclose() → wait_for raises → test fails.
            await asyncio.wait_for(consume(), timeout=5.0)
            await asyncio.sleep(0.05)  # let cancelled tasks finalize
            return got, _pending_leaks(before)

        got, leaked = asyncio.run(run())
        self.assertGreaterEqual(len(got), 10)
        self.assertEqual(leaked, [], f"leaked tasks: {leaked}")

    def test_stop_before_consuming(self):
        """Stop set immediately — the run should end fast with no leaks."""

        async def run():
            ev = threading.Event()
            ev.set()
            sc = _build(3, 1000, stop_event=ev)
            before = set(asyncio.all_tasks())
            gen = sc.scrape([], {}, max_age_hours=0)

            async def consume():
                try:
                    async for _ in gen:
                        pass
                finally:
                    await gen.aclose()

            await asyncio.wait_for(consume(), timeout=5.0)
            await asyncio.sleep(0.05)
            return _pending_leaks(before)

        leaked = asyncio.run(run())
        self.assertEqual(leaked, [], f"leaked tasks: {leaked}")


if __name__ == "__main__":
    unittest.main()
