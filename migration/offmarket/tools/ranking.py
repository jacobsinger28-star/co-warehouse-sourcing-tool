"""
Shared cross-market ranking helpers (HEALTH_AUDIT §A1 fix).

Imported by BOTH tools/make_dashboard.py and tools/make_map.py so the per-market
"reachable ceiling" and the normalized rank stay in lockstep (the dashboard<->map
parity rule). Pure functions — no DB, no I/O beyond reading weights.yaml.

The problem these fix: the blended leaderboard ranked every city by RAW score, and the
score bar/colour judged every parcel against the UNION of components that earn points in
ANY market. A data-poor market (Charleston: no tax / year_built / violations / permits
feeds) can never reach those points, so its best parcels sank — not because they were
worse deals. The fix: judge each parcel against ONLY the points its own market's feeds can
earn, and rank by that normalized fit.
"""
from __future__ import annotations

import math

from lib.config import load_weights


def comp_max() -> dict:
    """Per-component point ceiling, straight from weights.yaml."""
    return {k: c.get("weight", 0) for k, c in load_weights()["components"].items()}


def live_components(shaped_rows: list, cmax: dict) -> list:
    """Component keys that earn > 0 points for at least one SCORED row in this market.
    A component with no data feed in the market never fires, so it is 'dormant' here."""
    live = set()
    for r in shaped_rows:
        if r.get("score") is None:
            continue
        for k, v in (r.get("comp") or {}).items():
            if k in cmax and (v or 0) > 0:
                live.add(k)
    return sorted(live)


def market_ceiling(shaped_rows: list, cmax: dict) -> int:
    """Reachable points in this market = sum of weights of its live components. Falls back
    to the full point scale if nothing is live (degenerate/empty market), never 0."""
    live = live_components(shaped_rows, cmax)
    return sum(cmax[k] for k in live) or sum(cmax.values()) or 1


def fit(score, ceiling) -> float | None:
    """Normalized 0..1 fit = score / market ceiling. None when unscored or no ceiling.
    Used for the DISPLAYED '% fit'; the leaderboard RANK uses blend() (see below)."""
    if score is None or not ceiling:
        return None
    return score / ceiling


def blend(score, ceiling) -> float | None:
    """Balanced RANK metric = sqrt(fit * score) = score / sqrt(ceiling). Rewards BOTH
    completeness (% fit) and absolute evidence (raw points), so a feed-poor market is
    neither buried (raw-only ranking) nor floods the top (fit-only ranking). On real data,
    pure-fit put all of Charleston's soft-signal parcels at #1-#12 ahead of Nashville's
    distressed ones; the blend resurfaces Charleston fairly (~#7) without that flood.
    None when unscored or no ceiling."""
    if score is None or not ceiling or ceiling <= 0:
        return None
    return score / math.sqrt(ceiling)


def fit_sort_key(row: dict):
    """Sort key for the unified leaderboard: BLENDED fit-and-evidence DESC, then SF DESC.
    Unscored rows sort last. row must carry 'score', 'ceil', and 'sf'."""
    b = blend(row.get("score"), row.get("ceil"))
    return (-(b if b is not None else -1), -(row.get("sf") or 0))
