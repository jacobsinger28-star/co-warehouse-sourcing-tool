"""CBRE direct-API scraper (scrapers/cbre.py). Network mocked.

Guards the revival: CBRE moved its HTML URLs (old Playwright path 404'd → 0
listings); this scraper reads the JSON API. Tests cover address assembly, the
sqft-vs-acre size rule, coordinate-based metro scoping, and that broker contacts
(CBRE's edge, like Colliers) travel with the listing.
"""
import asyncio
import unittest

from scrapers import cbre as C


def _doc(pk, line2, city, region, postcode, lat, lon, size, units, email=None):
    return {
        "Common.PrimaryKey": pk,
        "Common.ActualAddress": {
            "Common.Line1": " ", "Common.Line2": line2,
            "Common.Locallity": city, "Common.Region": region, "Common.PostCode": postcode,
        },
        "Common.Coordinate": {"lat": lat, "lon": lon},
        "Common.TotalSize": [{"Common.Size": size, "Common.Units": units}] if size else [],
        "Common.Agents": [{"Common.AgentName": "Jane Broker", "Common.EmailAddress": email,
                           "Common.TelephoneNumber": "615 555 1000"}] if email else [],
        "Common.UsageType": "Industrial",
    }


# nashville building, nashville land (acres), and an out-of-metro (NYC) building
_DOCS = [
    _doc("US-1", "100 Industrial Way", "Nashville", "TN", "37210", 36.16, -86.78, 120000.0, "sqft", "jane@cbre.com"),
    _doc("US-2", "200 Land Rd", "Nashville", "TN", "37211", 36.10, -86.75, 8.4, "acre", "land@cbre.com"),
    _doc("US-3", "1 Broadway", "New York", "NY", "10004", 40.71, -74.01, 90000.0, "sqft", "ny@cbre.com"),
]


def _run(docs, markets):
    async def go():
        sc = C.CbreScraper()
        sc._client = object()  # bypass the httpx context manager

        async def fake_query(usage):
            return docs if usage == "Industrial" else []

        sc._query = fake_query
        return [l async for l in sc.scrape(markets, {}, known_urls=set())]

    return asyncio.run(go())


class TestCbreHelpers(unittest.TestCase):
    def test_address_assembly(self):
        a = C._address({"Common.Line1": " ", "Common.Line2": "17 Presidential Way",
                        "Common.Locallity": "Woburn", "Common.Region": "MA", "Common.PostCode": "01801"})
        self.assertEqual(a, "17 Presidential Way, Woburn, MA 01801")

    def test_address_falls_back_to_line1(self):
        a = C._address({"Common.Line1": "42 Main St", "Common.Line2": "",
                        "Common.Locallity": "Dublin", "Common.Region": "OH", "Common.PostCode": "43017"})
        self.assertEqual(a, "42 Main St, Dublin, OH 43017")

    def test_address_incomplete_is_none(self):
        self.assertIsNone(C._address({"Common.Line2": "5 Rd"}))  # no city/region

    def test_building_sf_sqft_only(self):
        self.assertEqual(C._building_sf({"Common.TotalSize": [{"Common.Size": 95000.0, "Common.Units": "sqft"}]}), 95000.0)
        # acres = land → None (not a building measurement)
        self.assertIsNone(C._building_sf({"Common.TotalSize": [{"Common.Size": 8.4, "Common.Units": "acre"}]}))
        self.assertIsNone(C._building_sf({"Common.TotalSize": []}))


class TestCbreScrape(unittest.TestCase):
    def test_in_metro_building_emitted(self):
        got = _run(_DOCS, ["Nashville"])
        addrs = [l["address"] for l in got]
        self.assertIn("100 Industrial Way, Nashville, TN 37210", addrs)

    def test_out_of_metro_dropped(self):
        got = _run(_DOCS, ["Nashville"])
        self.assertTrue(all("Broadway" not in l["address"] for l in got))  # NYC dropped

    def test_coords_and_broker_carried(self):
        got = _run(_DOCS, ["Nashville"])
        b = next(l for l in got if "100 Industrial Way" in l["address"])
        self.assertEqual((b["lat"], b["lng"]), (36.16, -86.78))
        self.assertEqual(b["broker_email"], "jane@cbre.com")
        self.assertEqual(b["source"], "cbre")

    def test_land_kept_as_unknown_sf(self):
        # acre listing in-metro is kept (unknown SF), consistent w/ other scrapers
        got = _run(_DOCS, ["Nashville"])
        land = [l for l in got if "200 Land Rd" in l["address"]]
        self.assertEqual(len(land), 1)
        self.assertIsNone(land[0]["total_sf"])

    def test_empty_markets_scopes_to_all_target_metros(self):
        # like Crexi: no markets still means the buy-box metros (NYC stays out)
        got = _run(_DOCS, [])
        self.assertTrue(all("Broadway" not in l["address"] for l in got))
        self.assertTrue(any("Nashville" in l["address"] for l in got))


if __name__ == "__main__":
    unittest.main()
