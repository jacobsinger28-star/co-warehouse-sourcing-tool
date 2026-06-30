#!/usr/bin/env python3
"""Unit tests for the pure geo math in sample_points.py (stdlib unittest)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sample_points as sp  # noqa: E402


class TestHaversine(unittest.TestCase):
    def test_zero(self):
        self.assertAlmostEqual(sp.haversine_m(40.0, -83.0, 40.0, -83.0), 0.0, places=6)

    def test_one_degree_lat(self):
        # 1° of latitude ≈ 111 km; allow a little slack for the spherical model.
        d = sp.haversine_m(40.0, -83.0, 41.0, -83.0)
        self.assertTrue(110_000 < d < 112_000, d)


class TestBearing(unittest.TestCase):
    def test_due_north(self):
        self.assertAlmostEqual(sp.bearing_deg(40.0, -83.0, 41.0, -83.0), 0.0, places=1)

    def test_due_east(self):
        b = sp.bearing_deg(40.0, -83.0, 40.0, -82.0)
        self.assertTrue(89.0 < b < 91.0, b)  # ~90° heading east

    def test_range(self):
        b = sp.bearing_deg(40.0, -83.0, 39.0, -84.0)  # heading SW
        self.assertTrue(0.0 <= b < 360.0)
        self.assertTrue(180.0 < b < 270.0, b)


class TestInterpolate(unittest.TestCase):
    def test_single_point(self):
        out = sp.interpolate_along([(40.0, -83.0)], 30)
        self.assertEqual(len(out), 1)

    def test_spacing(self):
        # A ~111 m north segment sampled every 30 m → start + ~3 interior ≈ 4 points.
        a, b = (40.0, -83.0), (40.001, -83.0)  # ~111 m apart
        out = sp.interpolate_along([a, b], 30)
        self.assertGreaterEqual(len(out), 4)
        # First sample is the start vertex.
        self.assertAlmostEqual(out[0][0], 40.0, places=6)
        # Consecutive samples are ~30 m apart.
        d = sp.haversine_m(out[0][0], out[0][1], out[1][0], out[1][1])
        self.assertTrue(25 < d < 35, d)

    def test_carry_across_segments(self):
        # Two short collinear segments should sample as if one continuous line (no reset at the vertex).
        pts = [(40.0, -83.0), (40.0002, -83.0), (40.0004, -83.0)]  # ~22 m + ~22 m
        out = sp.interpolate_along(pts, 30)
        # ~44 m total at 30 m spacing → start + one more ≈ 2 points (not 3 from a per-segment reset).
        self.assertEqual(len(out), 2)


class TestStopsFromWays(unittest.TestCase):
    def test_two_sides_per_point(self):
        ways = [{"name": "Test St", "geometry": [(40.0, -83.0), (40.001, -83.0)]}]
        rows = sp.stops_from_ways(ways, 30, "t")
        self.assertEqual(len(rows) % 2, 0)
        sides = {r["side"] for r in rows}
        self.assertEqual(sides, {"left", "right"})
        # Headings are perpendicular to a due-north road → ~90 and ~270.
        headings = sorted({round(float(r["heading"])) for r in rows})
        self.assertIn(90, headings)
        self.assertIn(270, headings)


if __name__ == "__main__":
    unittest.main()
