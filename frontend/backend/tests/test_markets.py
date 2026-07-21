"""Target-market matching + listing→metro resolution (scrapers/markets.py).

Pure logic, no network. These guard the two ways a listing gets placed in a
buy-box metro: the Crexi bbox scoping (market_for_coords) and the address
city/state fallback (market_for_address) that /live/rows uses so suburb
listings surface under their metro instead of a raw county string.
"""
import unittest

from scrapers.markets import (
    TARGET_MARKETS,
    match_markets,
    market_for_coords,
    market_for_address,
    is_in_target_market,
)


def _named(m):
    return m["name"] if m else None


class TestMatchMarkets(unittest.TestCase):
    def test_empty_or_none_returns_all(self):
        self.assertEqual(len(match_markets([])), len(TARGET_MARKETS))
        self.assertEqual(len(match_markets(None)), len(TARGET_MARKETS))
        # blank/whitespace entries are treated as "no selection" → all
        self.assertEqual(len(match_markets(["", "  "])), len(TARGET_MARKETS))

    def test_names_present(self):
        names = {m["name"] for m in TARGET_MARKETS}
        # the three added this cycle must actually be scannable
        for added in ("Nashville", "Orlando", "Cleveland"):
            self.assertIn(added, names)

    def test_single_market_scopes_to_it(self):
        got = match_markets(["Nashville"])
        self.assertEqual([m["name"] for m in got], ["Nashville"])

    def test_case_insensitive_and_substring(self):
        self.assertEqual(_named(match_markets(["nashville"])[0]), "Nashville")
        # "West Palm Beach, FL" should still match the "West Palm Beach" metro
        got = [m["name"] for m in match_markets(["West Palm Beach, FL"])]
        self.assertIn("West Palm Beach", got)

    def test_unmatched_falls_back_to_all(self):
        # a market we don't cover shouldn't return an empty scan (documented
        # behavior: unknown → all buy-box metros, never nothing)
        self.assertEqual(len(match_markets(["Atlanta"])), len(TARGET_MARKETS))

    def test_multiple(self):
        got = {m["name"] for m in match_markets(["Nashville", "Orlando"])}
        self.assertEqual(got, {"Nashville", "Orlando"})


class TestMarketForCoords(unittest.TestCase):
    def test_in_box(self):
        # downtown Nashville
        self.assertEqual(_named(market_for_coords(36.16, -86.78)), "Nashville")
        # uptown Charlotte
        self.assertEqual(_named(market_for_coords(35.22, -80.84)), "Charlotte")

    def test_outside_all_boxes(self):
        self.assertIsNone(market_for_coords(0.0, 0.0))
        self.assertIsNone(market_for_coords(40.71, -74.0))  # NYC

    def test_none_coords(self):
        self.assertIsNone(market_for_coords(None, None))
        self.assertIsNone(market_for_coords(36.16, None))

    def test_bad_types(self):
        self.assertIsNone(market_for_coords("abc", "def"))

    def test_every_market_box_self_resolves(self):
        # the midpoint of each metro's bbox must resolve back to that metro,
        # i.e. no two boxes overlap at their centers
        for mk in TARGET_MARKETS:
            lat = (mk["bbox"][0] + mk["bbox"][1]) / 2
            lng = (mk["bbox"][2] + mk["bbox"][3]) / 2
            self.assertEqual(_named(market_for_coords(lat, lng)), mk["name"], mk["name"])


class TestMarketForAddress(unittest.TestCase):
    def test_suburb_maps_to_metro(self):
        # Smyrna is a Nashville-metro city → should resolve to Nashville
        self.assertEqual(
            _named(market_for_address("100 Industrial Blvd, Smyrna, TN 37167")),
            "Nashville",
        )
        # Doral → Miami
        self.assertEqual(
            _named(market_for_address("8500 NW 25th St, Doral, FL 33122")),
            "Miami",
        )

    def test_requires_matching_state(self):
        # Charleston, WV must NOT match Charleston, SC
        self.assertIsNone(market_for_address("1 Main St, Charleston, WV 25301"))
        # Charleston, SC does
        self.assertEqual(
            _named(market_for_address("1 Main St, Charleston, SC 29401")), "Charleston"
        )

    def test_word_boundary(self):
        # a city that merely contains a metro name as a substring shouldn't match
        self.assertIsNone(market_for_address("1 Main St, Miamiville, OH 45147"))

    def test_none_and_empty(self):
        self.assertIsNone(market_for_address(None))
        self.assertIsNone(market_for_address(""))


class TestIsInTargetMarket(unittest.TestCase):
    def test_coords_first(self):
        self.assertTrue(is_in_target_market({"lat": 36.16, "lng": -86.78}))

    def test_address_fallback(self):
        self.assertTrue(
            is_in_target_market({"address": "5 Warehouse Way, Smyrna, TN 37167"})
        )

    def test_no_signal_is_false(self):
        self.assertFalse(is_in_target_market({}))
        self.assertFalse(is_in_target_market({"address": "somewhere unknown"}))


if __name__ == "__main__":
    unittest.main()
