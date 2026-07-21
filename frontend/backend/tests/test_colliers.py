"""Colliers market scoping (scrapers/colliers.py).

Colliers is a NATIONAL feed filtered client-side. The scoping must be
metro-aware: a Nashville deal listed in a suburb ("Lebanon, TN") has to survive
a markets=["Nashville"] run — the old bare-name substring match dropped all such
suburb listings, which is most of Colliers' target-market industrial inventory
(and Colliers is the source that carries broker contacts). Network is mocked.
"""
import asyncio
import re
import unittest

from scrapers import colliers as C


def _card(asset_type, address, sf, broker_email=None):
    return {
        "asset_type": asset_type,
        "address": address,
        "total_sf": sf,
        "status": "Available",
        "listing_url": f"https://sales.colliers.com/x/{abs(hash(address)) % 99999}",
        "headline": "Deal",
        "city_state": address.split(",", 1)[-1].strip(),
        "broker_name": "A Broker" if broker_email else None,
        "broker_email": broker_email,
        "broker_phone": None,
        "asking_price_total": None,
    }


# c0 = Nashville suburb, c1 = non-target, c2 = Columbus
_CARDS = {
    "c0": _card("Industrial - Warehouse / Distribution", "6850 Eastgate Blvd, Lebanon, TN 37090", 120000, "alex@colliers.com"),
    "c1": _card("Industrial - Flex", "100 Main St, Denver, CO 80202", 120000),
    "c2": _card("Industrial - Warehouse / Distribution", "200 Industrial Pkwy, Gahanna, OH 43230", 120000, "nolan@colliers.com"),
}


def _run(markets):
    """Drive ColliersScraper.scrape over the synthetic cards; return emitted."""
    async def go():
        sc = C.ColliersScraper()
        sc._client = object()  # bypass the httpx context manager

        async def fake_pv():
            return "tok"

        async def fake_listings(pv, start, page_size):
            return {"success": True, "total": 3, "totalAvail": 3,
                    "numProjects": 3, "html": "PRE|c0|c1|c2"}

        sc._fetch_pv = fake_pv
        sc._fetch_listings = fake_listings
        out = []
        async for l in sc.scrape(markets, {}, known_urls=set()):
            out.append(l)
        return out

    orig_split, orig_parse = C._CARD_SPLIT_RE, C._parse_card
    C._CARD_SPLIT_RE = re.compile(r"\|")
    C._parse_card = lambda ch: _CARDS.get(ch)
    try:
        return asyncio.run(go())
    finally:
        C._CARD_SPLIT_RE, C._parse_card = orig_split, orig_parse


class TestColliersScoping(unittest.TestCase):
    def test_suburb_kept_when_metro_scoped(self):
        got = _run(["Nashville"])
        addrs = [l["address"] for l in got]
        self.assertEqual(len(got), 1)
        self.assertIn("Lebanon, TN", addrs[0])  # the suburb survived

    def test_non_target_dropped(self):
        got = _run(["Nashville"])
        self.assertNotIn("Denver", got[0]["address"])
        self.assertTrue(all("Gahanna" not in l["address"] for l in got))

    def test_broker_contact_carried(self):
        # Colliers' edge over Crexi: broker email travels with the listing
        got = _run(["Nashville"])
        self.assertEqual(got[0]["broker_email"], "alex@colliers.com")

    def test_multiple_metros(self):
        got = _run(["Nashville", "Columbus"])
        addrs = " ".join(l["address"] for l in got)
        self.assertIn("Lebanon", addrs)
        self.assertIn("Gahanna", addrs)  # Columbus suburb
        self.assertEqual(len(got), 2)

    def test_empty_markets_no_scoping(self):
        # no markets = keep all US industrial (the console filters downstream)
        got = _run([])
        self.assertEqual(len(got), 3)


if __name__ == "__main__":
    unittest.main()
