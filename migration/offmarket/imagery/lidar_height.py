#!/usr/bin/env python3
"""
lidar_height.py — estimate each universe parcel's warehouse ROOF height from free
USGS 3DEP LiDAR and write it to properties.clear_height_est.

Why this exists
---------------
Clear/ceiling height is the one industrial metric that is NOT in any public assessor
or parcel feed. The CAMA layer carries FinishedArea / YearBuilt / StructureType but no
height field at all (verified against the live schema — see DATA_NOTES.md). The only
free, off-market-compatible source is the classified LiDAR point cloud. We compute a
normalized surface (building points minus local ground) over each parcel footprint and
store the typical (median) roof height, in FEET.

What the number means (read this before trusting it)
----------------------------------------------------
It is the exterior ROOF / eave height above grade, NOT interior clear height. Interior
clear is typically ~2-4 ft less (roof deck + joist/structure depth), and rooftop units
can sit above it. Treat it as an upper-bound triage proxy and always confirm true clear
height on the call. Stored with clear_height_source='lidar'.

Survey vintage: the point cloud is the 2022 flight. A building completed (or still under
construction) after that survey can read implausibly low — e.g. a brand-new high-cube
warehouse showing ~9 ft is almost certainly post-2022 construction, not a real 9 ft box.
Cross-check year_built before trusting a low reading on a recent build.

Data source (no key, no quota, public)
--------------------------------------
USGS public Entwine Point Tiles (EPT), Davidson County 2022 QL1 (8 pts/m²):
  https://usgs-lidar-public.s3.amazonaws.com/TN_DavidsonCo_1_2022/
EPT is laszip-compressed (read with laspy[lazrs]) with a JSON octree hierarchy. We walk
only the octree nodes overlapping each parcel, down to a parcel-sized depth, so a parcel
costs a handful of small node downloads (~6s), never the 56-billion-point whole. Ground
is taken from the cloud's own class-2 points, so there is no cross-source datum mismatch.

    python imagery/lidar_height.py                  # universe parcels missing a lidar est
    python imagery/lidar_height.py --refresh        # recompute even where already set
    python imagery/lidar_height.py --apn 08202007800 [--apn ...]   # specific parcels
    python imagery/lidar_height.py --limit 10       # sample N smallest parcels (fastest)
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import laspy  # noqa: E402
import shapely  # noqa: E402
from shapely.geometry import shape  # noqa: E402
from shapely.ops import transform  # noqa: E402

from lib.db import JobRun, cursor  # noqa: E402

EPT_BASE = "https://usgs-lidar-public.s3.amazonaws.com/TN_DavidsonCo_1_2022"
LIDAR_SOURCE = "lidar"                # value written to clear_height_source
LIDAR_VINTAGE = "2022 QL1"            # for human-facing captions

WEB_MERCATOR_R = 6378137.0           # EPSG:3857 sphere radius (matches EPT horizontal SRS)
M_TO_FT = 3.28084
CELL_M = 15.0                        # ground-normalization grid cell (Web-Mercator metres)
MIN_BUILDING_PTS = 50               # below this we can't trust an estimate -> leave NULL
HEIGHT_MIN_M, HEIGHT_MAX_M = 1.5, 46.0   # plausible building heights (~5-150 ft)
DEPTH_CAP = 13                      # never descend deeper than this octree level

CLASS_GROUND = 2
CLASS_BUILDING = 6


# --------------------------------------------------------------------------- #
# Pure geometry / math helpers (no I/O — unit-tested in tests/test_lidar.py)   #
# --------------------------------------------------------------------------- #
def lonlat_to_3857(lon: float, lat: float, _z: float | None = None) -> tuple[float, float]:
    """WGS84 lon/lat -> EPSG:3857 metres (the EPT's horizontal SRS). Spherical Mercator."""
    x = math.radians(lon) * WEB_MERCATOR_R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * WEB_MERCATOR_R
    return x, y


def target_depth(cube_size: float, extent: float, cap: int = DEPTH_CAP) -> int:
    """Shallowest octree depth whose node is no larger than the parcel's extent.

    One level past 'node covers the parcel' gives a few small nodes and enough point
    density for a robust percentile without pulling the dense deepest tiers.
    """
    d = 0
    while cube_size / (2 ** d) > extent and d < cap:
        d += 1
    return min(d + 1, cap)


def node_overlaps(cube_bounds: list[float], d: int, x: int, y: int,
                  bbox: tuple[float, float, float, float]) -> bool:
    """Does octree node (d,x,y,*) overlap the parcel bbox in X/Y? (Z spans freely.)"""
    cb = cube_bounds
    s = (cb[3] - cb[0]) / (2 ** d)
    nx, ny = cb[0] + x * s, cb[1] + y * s
    minx, miny, maxx, maxy = bbox
    return not (nx + s < minx or nx > maxx or ny + s < miny or ny > maxy)


def normalized_building_heights(
    X: np.ndarray, Y: np.ndarray, Z: np.ndarray, C: np.ndarray,
    origin: tuple[float, float], cell: float = CELL_M,
) -> np.ndarray:
    """Height of each class-6 building point above LOCAL ground, in metres.

    Local ground is the median Z of class-2 points per `cell`-metre grid square; building
    cells with no ground beneath them (interior roof) borrow the nearest ground cell, so
    sloped/large parcels don't pick up a global-median bias. Implausible heights are
    dropped. Returns an empty array if there isn't enough classified building to trust.
    """
    ox, oy = origin
    cx = ((X - ox) // cell).astype(np.int64)
    cy = ((Y - oy) // cell).astype(np.int64)

    g = C == CLASS_GROUND
    b = C == CLASS_BUILDING
    if int(b.sum()) < MIN_BUILDING_PTS or not g.any():
        return np.empty(0)

    # Ground median per grid cell.
    gkeys = np.stack([cx[g], cy[g]], axis=1)
    guniq, ginv = np.unique(gkeys, axis=0, return_inverse=True)
    gmed = np.array([np.median(Z[g][ginv == i]) for i in range(len(guniq))])

    # For each distinct building cell, use its own ground if present else nearest cell.
    bkeys = np.stack([cx[b], cy[b]], axis=1)
    buniq, binv = np.unique(bkeys, axis=0, return_inverse=True)
    d2 = (((buniq[:, None, 0] - guniq[None, :, 0]).astype(np.float32)) ** 2
          + ((buniq[:, None, 1] - guniq[None, :, 1]).astype(np.float32)) ** 2)
    ground_for_bcell = gmed[d2.argmin(axis=1)]

    heights = Z[b] - ground_for_bcell[binv]
    return heights[(heights > HEIGHT_MIN_M) & (heights < HEIGHT_MAX_M)]


def summarize(heights_m: np.ndarray) -> dict | None:
    """Roof-height percentiles in feet, or None if the sample is too thin."""
    if heights_m.size < MIN_BUILDING_PTS:
        return None
    pct = lambda q: round(float(np.percentile(heights_m, q)) * M_TO_FT, 1)
    return {"roof_ft": pct(50), "p75_ft": pct(75), "p95_ft": pct(95), "n": int(heights_m.size)}


# --------------------------------------------------------------------------- #
# EPT I/O                                                                      #
# --------------------------------------------------------------------------- #
class Ept:
    """Thin EPT reader: one pooled session, octree metadata fetched once."""

    def __init__(self) -> None:
        self.s = requests.Session()
        self.meta = self._get(f"{EPT_BASE}/ept.json")
        self.cube = self.meta["bounds"]               # [xmin,ymin,zmin,xmax,ymax,zmax], a cube

    def _get(self, url: str):
        r = self.s.get(url, timeout=60)
        r.raise_for_status()
        return r.json()

    def _overlap_nodes(self, bbox, maxd) -> list[tuple[int, int, int, int]]:
        """Octree node keys overlapping bbox, descending the hierarchy no deeper than maxd."""
        cb, found = self.cube, []

        def walk(hier):
            for key, cnt in hier.items():
                d, x, y, z = map(int, key.split("-"))
                if d > maxd or not node_overlaps(cb, d, x, y, bbox):
                    continue
                if cnt == -1:                          # hierarchy continues in a sub-file
                    if d < maxd:
                        walk(self._get(f"{EPT_BASE}/ept-hierarchy/{key}.json"))
                else:
                    found.append((d, x, y, z))

        walk(self._get(f"{EPT_BASE}/ept-hierarchy/0-0-0-0.json"))
        return found

    def points_in(self, poly_3857) -> tuple[np.ndarray, ...]:
        """Fetch and decode all LiDAR points inside the parcel polygon (XYZ + class)."""
        minx, miny, maxx, maxy = poly_3857.bounds
        extent = max(maxx - minx, maxy - miny)
        maxd = target_depth(self.cube[3] - self.cube[0], extent)
        nodes = self._overlap_nodes((minx, miny, maxx, maxy), maxd)

        xs, ys, zs, cs = [], [], [], []
        for d, x, y, z in nodes:
            r = self.s.get(f"{EPT_BASE}/ept-data/{d}-{x}-{y}-{z}.laz", timeout=120)
            if r.status_code != 200:
                continue
            las = laspy.read(io.BytesIO(r.content))
            xs.append(np.asarray(las.x)); ys.append(np.asarray(las.y))
            zs.append(np.asarray(las.z)); cs.append(np.asarray(las.classification))
        if not xs:
            return (np.empty(0),) * 4
        X, Y, Z, C = (np.concatenate(a) for a in (xs, ys, zs, cs))
        # Coarse bbox cut first (cheap), then exact polygon clip.
        m = (X >= minx) & (X <= maxx) & (Y >= miny) & (Y <= maxy)
        X, Y, Z, C = X[m], Y[m], Z[m], C[m]
        inside = shapely.contains_xy(poly_3857, X, Y)
        return X[inside], Y[inside], Z[inside], C[inside]


def estimate_parcel(ept: Ept, geom_4326) -> dict | None:
    """Full pipeline for one parcel polygon (in WGS84): -> roof-height summary or None."""
    poly = transform(lonlat_to_3857, geom_4326)
    X, Y, Z, C = ept.points_in(poly)
    if Z.size == 0:
        return None
    heights = normalized_building_heights(X, Y, Z, C, origin=(poly.bounds[0], poly.bounds[1]))
    return summarize(heights)


# --------------------------------------------------------------------------- #
# DB glue                                                                      #
# --------------------------------------------------------------------------- #
def fetch_targets(apns: list[str] | None, refresh: bool, limit: int | None) -> list[dict]:
    """Universe parcels needing a LiDAR height. Smallest-area first (cheapest to process)."""
    where = ["p.in_universe", "p.geom IS NOT NULL"]
    params: list = []
    if apns:
        where.append("p.apn = ANY(%s)")
        params.append(apns)
    elif not refresh:
        where.append("(pr.clear_height_source IS DISTINCT FROM %s)")
        params.append(LIDAR_SOURCE)
    sql = (
        "SELECT p.apn, ST_AsGeoJSON(p.geom) AS gj, p.situs_address "
        "FROM parcels p JOIN properties pr USING (apn) "
        f"WHERE {' AND '.join(where)} ORDER BY ST_Area(p.geom) ASC"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def write_height(apn: str, roof_ft: float) -> None:
    with cursor() as cur:
        cur.execute(
            "UPDATE properties SET clear_height_est=%s, clear_height_source=%s WHERE apn=%s",
            (roof_ft, LIDAR_SOURCE, apn),
        )


# --------------------------------------------------------------------------- #
# Main                                                                         #
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apn", action="append", help="specific APN(s); repeatable")
    ap.add_argument("--refresh", action="store_true", help="recompute even where already set")
    ap.add_argument("--limit", type=int, help="process at most N (smallest) parcels")
    args = ap.parse_args()

    targets = fetch_targets(args.apn, args.refresh, args.limit)
    print(f"lidar_height: {len(targets)} parcel(s) to estimate "
          f"(source='{LIDAR_SOURCE}', {LIDAR_VINTAGE}) ...")
    if not targets:
        print("  nothing to do (all set; use --refresh to recompute)")
        return 0

    ept = Ept()
    estimated = no_building = 0
    with JobRun("lidar_height") as job:
        for t in targets:
            try:
                summ = estimate_parcel(ept, shape(json.loads(t["gj"])))
            except Exception as e:  # noqa: BLE001 — per-parcel network/decode hiccup, keep going
                job.fail(e, ref=t["apn"])
                continue
            if summ is None:
                no_building += 1
                job.ok()
                continue
            write_height(t["apn"], summ["roof_ft"])
            estimated += 1
            job.ok()
            print(f"  {t['apn']}  {(t['situs_address'] or '')[:30]:30}  "
                  f"roof ~{summ['roof_ft']:.0f} ft  (p95 {summ['p95_ft']:.0f}, n={summ['n']})")

    print(f"  done: {estimated} heights written, {no_building} without classified building, "
          f"{job.fail_count} errored")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
