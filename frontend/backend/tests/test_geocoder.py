"""Geocoder: address parsing, cache, and the Census-batch + Nominatim-fallback
orchestration (geocoder.py). Network is mocked — no real HTTP.

conftest points DATA_DIR at a temp dir, so the cache SQLite here is disposable.
"""
import csv
import io
import sqlite3
import unittest

import geocoder


def _clear_cache():
    with sqlite3.connect(geocoder.CACHE_DB) as c:
        c.execute("DELETE FROM geo_cache")


class TestSplitAddress(unittest.TestCase):
    def test_crexi_format_with_county(self):
        # the messy Crexi shape: street, city, County, ST ZIP — county is dropped
        s, c, st, z = geocoder._split_address(
            "550 Expy Park Dr, Nashville, Davidson County, TN 37210"
        )
        self.assertEqual((s, c, st, z), ("550 Expy Park Dr", "Nashville", "TN", "37210"))

    def test_no_zip(self):
        s, c, st, z = geocoder._split_address("7615 Old Mount Holly Road, Charlotte, NC")
        self.assertEqual((s, c, st, z), ("7615 Old Mount Holly Road", "Charlotte", "NC", ""))

    def test_city_is_county_dropped(self):
        # when parts[1] itself is a "X County" token, city comes back empty
        _, c, st, _ = geocoder._split_address("1 Main St, Wake County, NC 27601")
        self.assertEqual(c, "")
        self.assertEqual(st, "NC")

    def test_street_only(self):
        s, c, st, z = geocoder._split_address("123 Nowhere Rd")
        self.assertEqual(s, "123 Nowhere Rd")
        self.assertEqual((c, st, z), ("", "", ""))


class TestCache(unittest.TestCase):
    def setUp(self):
        _clear_cache()

    def test_cached_miss_then_hit(self):
        addr = "100 Test St, Nashville, TN 37210"
        self.assertEqual(geocoder.geocode_cached(addr), (None, None))
        geocoder._cache_put(addr, 36.1, -86.7)
        self.assertEqual(geocoder.geocode_cached(addr), (36.1, -86.7))

    def test_too_short_is_none(self):
        self.assertEqual(geocoder.geocode_cached("x"), (None, None))
        self.assertEqual(geocoder.geocode_cached(""), (None, None))


class TestCensusBatchParsing(unittest.TestCase):
    """_census_batch builds a request CSV and parses the Census response CSV."""

    def setUp(self):
        _clear_cache()
        self._orig_post = geocoder.requests.post

    def tearDown(self):
        geocoder.requests.post = self._orig_post

    def _fake_response(self, rows):
        buf = io.StringIO()
        w = csv.writer(buf)
        for r in rows:
            w.writerow(r)
        text = buf.getvalue()

        class _Resp:
            pass

        resp = _Resp()
        resp.text = text
        return resp

    def test_parses_matches_only(self):
        addrs = [
            "100 A St, Nashville, TN 37210",
            "200 B St, Nashville, TN 37211",
            "300 C St, Nashville, TN 37212",
        ]
        # Census response: id, input, Match/No_Match, Exact, matched, "lon,lat"
        rows = [
            [0, addrs[0], "Match", "Exact", "100 A ST", "-86.78,36.16"],
            [1, addrs[1], "No_Match", "", "", ""],
            [2, addrs[2], "Match", "Non_Exact", "300 C ST", "-86.80,36.20"],
        ]
        geocoder.requests.post = lambda *a, **k: self._fake_response(rows)
        got = geocoder._census_batch(addrs)
        # note: result is keyed by address, and stored as (lat, lng)
        self.assertEqual(got[addrs[0]], (36.16, -86.78))
        self.assertEqual(got[addrs[2]], (36.2, -86.8))
        self.assertNotIn(addrs[1], got)  # No_Match dropped


class TestGeocodeBatch(unittest.TestCase):
    """The orchestration: cache → Census → bounded Nominatim fallback."""

    def setUp(self):
        _clear_cache()
        self._census = geocoder._census_batch
        self._nom = geocoder._nominatim_one

    def tearDown(self):
        geocoder._census_batch = self._census
        geocoder._nominatim_one = self._nom

    def test_cache_hits_skip_network(self):
        geocoder._cache_put("cached, TN 37210", 1.0, 2.0)

        def _boom(*a, **k):
            raise AssertionError("network should not be called for cached addrs")

        geocoder._census_batch = _boom
        geocoder._nominatim_one = _boom
        got = geocoder.geocode_batch(["cached, TN 37210"])
        self.assertEqual(got["cached, TN 37210"], (1.0, 2.0))

    def test_census_then_cached(self):
        geocoder._census_batch = lambda addrs: {addrs[0]: (10.0, 20.0)}
        geocoder._nominatim_one = lambda a: None
        a = "1 First St, Nashville, TN 37210"
        got = geocoder.geocode_batch([a])
        self.assertEqual(got[a], (10.0, 20.0))
        # and it was written to cache for next time
        self.assertEqual(geocoder.geocode_cached(a), (10.0, 20.0))

    def test_nominatim_fallback_for_census_misses(self):
        geocoder._census_batch = lambda addrs: {}  # census resolves nothing
        geocoder._nominatim_one = lambda a: (5.5, 6.6)
        a = "999 Tail St, Charlotte, NC 28206"
        got = geocoder.geocode_batch([a])
        self.assertEqual(got[a], (5.5, 6.6))

    def test_fallback_is_bounded(self):
        geocoder._census_batch = lambda addrs: {}
        calls = {"n": 0}

        def _nom(a):
            calls["n"] += 1
            return (0.0, 0.0)

        geocoder._nominatim_one = _nom
        addrs = [f"{i} Cap St, Charlotte, NC 2820{i%10}" for i in range(20)]
        geocoder.geocode_batch(addrs, nominatim_cap=5)
        self.assertEqual(calls["n"], 5)  # capped, not 20

    def test_stop_check_aborts_before_network(self):
        def _boom(*a, **k):
            raise AssertionError("stopped run must not hit the network")

        geocoder._census_batch = _boom
        geocoder._nominatim_one = _boom
        got = geocoder.geocode_batch(
            ["1 Stop St, Nashville, TN 37210"], stop_check=lambda: True
        )
        self.assertEqual(got, {})  # nothing resolved, no network

    def test_dedup(self):
        seen = []
        geocoder._census_batch = lambda addrs: (seen.append(list(addrs)) or {})
        geocoder._nominatim_one = lambda a: None
        a = "1 Dup St, Nashville, TN 37210"
        geocoder.geocode_batch([a, a, a])
        # the duplicate address is only sent to Census once
        self.assertEqual(seen[0].count(a), 1)


if __name__ == "__main__":
    unittest.main()
