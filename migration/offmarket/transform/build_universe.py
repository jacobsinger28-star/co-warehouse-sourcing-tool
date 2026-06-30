#!/usr/bin/env python3
"""
build_universe.py — apply the hard gates and produce the scored universe.

  1. Submarket gate: ST_Contains(buy-box polygon, point-on-surface of parcel).
  2. distance_miles_icbd (weights.yaml proximity component input).
  3. sf_confidence: building_sf claimed larger than the parcel's land -> 'mismatch'.
  4. Gate every parcel through scoring.rules.evaluate_gates — the SAME function
     score.py uses, so the universe and the scores cannot disagree — and persist
     in_universe / manual_review / gate_reason.

Deviation from the brief, documented: the brief's QA #4 compares building_sf to
"GIS footprint area". Nashville publishes no building-footprint layer, so the
cross-check uses parcel land area: a (mostly single-story) warehouse claiming more
building SF than its entire parcel is the silent-garbage case worth flagging.

    python transform/build_universe.py
"""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shapely.geometry import shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

from lib.config import icbd_center, load_submarkets, load_weights  # noqa: E402
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import industrial_codes  # noqa: E402
from scoring.rules import evaluate_gates  # noqa: E402


# --- staleness gate (migration 003), extracted PURE so it is unit-testable (ledger #4) ---
# Upserts never delete: a parcel that drops out of the industrial band (or is retired) keeps
# its old last_seen_at while the latest pull re-stamps everything it returned. So anything
# stamped before the most recent pull was NOT in it -> age it out. The 1-hour tolerance
# absorbs intra-pull timestamp jitter.
STALENESS_TOLERANCE = timedelta(hours=1)


def fresh_cutoff(seen_timestamps):
    """The cutoff below which a parcel's last_seen_at means it missed the latest pull.
    None when nothing carries a timestamp (gate disabled — never age anything out)."""
    seen = [t for t in seen_timestamps if t is not None]
    return (max(seen) - STALENESS_TOLERANCE) if seen else None


def is_stale(last_seen_at, cutoff) -> bool:
    """True iff this parcel should be excluded as not-in-latest-pull. Fail-safe: a None
    cutoff (no timestamps) or a None last_seen_at never ages a parcel out."""
    return cutoff is not None and last_seen_at is not None and last_seen_at < cutoff


def buybox_wkt() -> str:
    """Union of all Polygon/MultiPolygon features in imports/submarkets.geojson."""
    gj = load_submarkets()
    polys = [
        shape(f["geometry"])
        for f in gj.get("features", [])
        if f.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon")
    ]
    if not polys:
        raise RuntimeError("submarkets.geojson contains no polygon features")
    return unary_union(polys).wkt


def apply_spatial(job: JobRun) -> None:
    cfg = load_weights()
    lat, lon = icbd_center(cfg)
    wkt = buybox_wkt()
    with cursor() as cur:
        # Submarket membership. ST_PointOnSurface, not ST_Centroid: a centroid can
        # fall outside an L-shaped parcel; point-on-surface is guaranteed interior.
        cur.execute(
            """
            UPDATE parcels
            SET in_target_submarket = ST_Contains(
                ST_SetSRID(ST_GeomFromText(%s), 4326), ST_PointOnSurface(geom))
            WHERE geom IS NOT NULL
            """,
            (wkt,),
        )
        n_sub = cur.rowcount

        # Distance to ICBD center (drives proximity_score).
        cur.execute(
            """
            UPDATE properties p
            SET distance_miles_icbd = ROUND((ST_Distance(
                  ST_PointOnSurface(c.geom)::geography,
                  ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                ) / 1609.34)::numeric, 2)
            FROM parcels c
            WHERE c.apn = p.apn AND c.geom IS NOT NULL
            """,
            (lon, lat),
        )
        n_dist = cur.rowcount

        # SF sanity: claimed building SF larger than the entire parcel. Preserve a 'proxy'
        # marker (markets whose building_sf is a footprint estimate, not assessor GBA — e.g.
        # Columbus's fallback rows) so the dashboard can still flag approximate SF; Nashville
        # and Charlotte never set 'proxy', so they're unaffected.
        cur.execute(
            """
            UPDATE properties
            SET sf_confidence = CASE
                WHEN building_sf IS NOT NULL AND footprint_sf IS NOT NULL
                     AND building_sf > footprint_sf THEN 'mismatch'
                WHEN sf_confidence = 'proxy' THEN 'proxy'
                ELSE 'ok' END
            """
        )
    job.ok(n_sub)
    print(f"  submarket flags: {n_sub} parcels, distance set on {n_dist} properties")


def apply_gates(job: JobRun) -> dict[str, int]:
    """Run every parcel through evaluate_gates and persist the outcome."""
    cfg = load_weights()
    gates = cfg["gates"]
    ind_codes = industrial_codes()          # active market's industrial land-use set
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            """
            SELECT p.apn, p.land_use_code, p.in_target_submarket, p.last_seen_at,
                   pr.building_sf, pr.distance_miles_icbd
            FROM parcels p JOIN properties pr USING (apn)
            """
        )
        rows = cur.fetchall()

    # Staleness gate (migration 003) — pure helpers fresh_cutoff()/is_stale() above.
    cutoff = fresh_cutoff([r["last_seen_at"] for r in rows])

    updates, tally = [], {}
    for r in rows:
        ls = r["last_seen_at"]
        if is_stale(ls, cutoff):
            status, reason = "excluded", "not in latest parcel pull (reclassified/retired)"
        else:
            facts = {
                "building_sf": float(r["building_sf"]) if r["building_sf"] is not None else None,
                "land_use_industrial": r["land_use_code"] in ind_codes,
                "in_target_submarket": bool(r["in_target_submarket"]),
                "distance_miles_icbd": (
                    float(r["distance_miles_icbd"]) if r["distance_miles_icbd"] is not None else None
                ),
            }
            status, reason = evaluate_gates(facts, gates)
        tally[status] = tally.get(status, 0) + 1
        updates.append((r["apn"], status == "scored", status == "manual_review", reason))

    import psycopg2.extras

    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            UPDATE parcels AS p
            SET in_universe = v.in_universe, manual_review = v.manual_review,
                gate_reason = v.gate_reason
            FROM (VALUES %s) AS v(apn, in_universe, manual_review, gate_reason)
            WHERE p.apn = v.apn
            """,
            updates,
            page_size=1000,
        )
    job.ok(len(updates))
    return tally


class EmptyUniverseError(RuntimeError):
    """A market gated down to ZERO scored rows. Raised so the pipeline fails loudly
    instead of shipping a market that silently vanishes from the dashboard. This is the
    exact silent-failure mode TEST_ARCHITECTURE.md Layer 3 / HEALTH_AUDIT §B2 were
    written to stop — the old code only `print`ed a warning and still exited 0."""


def check_universe(tally: dict[str, int]) -> int:
    """Pure invariant on the gate tally (no I/O, so it is unit-testable).

    Returns the scored-universe count; raises EmptyUniverseError when it is 0. Being
    outside the 150-1200 sanity band is only a soft warning — that band is
    Nashville-tuned and a legitimately small or large market should still ship."""
    universe = tally.get("scored", 0)
    if universe == 0:
        raise EmptyUniverseError(
            "universe gated to 0 scored rows — refusing to ship a market that would "
            "silently disappear from the dashboard. Check the land-use filter, the "
            "gates, and that the parcel pull actually returned rows.")
    # Brief QA #1: outside ~150-1,200 means the land-use filter is likely wrong.
    if not 150 <= universe <= 1200:
        print(f"  !! WARNING: universe={universe} outside expected 150-1200 range "
              f"— review land-use filter / gates before trusting output")
    return universe


def qa(tally: dict[str, int]) -> None:
    print(f"  gate outcomes: {tally}")
    check_universe(tally)   # raises EmptyUniverseError on 0; warns outside the band
    with cursor(dict_rows=True, commit=False) as cur:
        # Bucket reasons by category — raw gate_reason embeds the SF value, which
        # is right for the parcel record but makes this rollup unreadable.
        cur.execute(
            """
            SELECT CASE
                     WHEN gate_reason LIKE 'building_sf%below%' THEN 'building_sf below 60k floor'
                     WHEN gate_reason LIKE 'building_sf%grey zone%' THEN 'building_sf 60-75k grey zone'
                     ELSE gate_reason
                   END AS reason, count(*) AS ct
            FROM parcels GROUP BY 1 ORDER BY ct DESC
            """
        )
        for r in cur.fetchall():
            print(f"    {r['ct']:>5}  {r['reason']}")
        cur.execute(
            "SELECT count(*) AS ct FROM properties WHERE sf_confidence='mismatch'")
        print(f"  sf_confidence='mismatch': {cur.fetchone()['ct']}")


def main() -> int:
    print("build_universe: spatial gates + universe flags ...")
    with JobRun("build_universe") as job:
        apply_spatial(job)
        tally = apply_gates(job)
        qa(tally)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
