"""
Config loaders. Single source of truth for repo paths + founder-editable config.

No scoring weight is hardcoded in Python — every weight lives in weights.yaml. The
*confirmed* industrial land-use filter is the numeric LUCode set in lib/sources.py
(INDUSTRIAL_LUCODES), established by Day-1 discovery; imports/land_use_codes.yaml is
the original pre-discovery handoff reference (zoning + text descriptions) and is
SUPERSEDED — Davidson County uses numeric LUCodes, matched on code not text (see
DATA_NOTES.md). Edit the code set in lib/sources.py after the founder confirms it
(FOUNDER_INPUTS.md #2).

Multi-market: weights.yaml holds the market-AGNOSTIC scoring weights; the market-
specific gates (center lat/lon, radius, SF thresholds) and the buy-box geometry come
from the ACTIVE market config (markets/<MARKET>.yaml via lib.market) and are overlaid
here. So `load_weights()` and `load_submarkets()` follow the MARKET env var.
"""
from __future__ import annotations

import functools
import json
import os
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent

WEIGHTS_PATH = REPO_ROOT / "weights.yaml"
SUBMARKETS_PATH = REPO_ROOT / "imports" / "submarkets.geojson"
IMPORTS_DIR = Path(os.environ.get("IMPORTS_DIR", REPO_ROOT / "imports"))


@functools.lru_cache(maxsize=None)
def _read_weights_file(path: str | None = None) -> dict:
    p = Path(path) if path else WEIGHTS_PATH
    with open(p) as fh:
        cfg = yaml.safe_load(fh)
    _validate_weights(cfg)
    return cfg


def load_weights(path: str | None = None) -> dict:
    """Parse weights.yaml (file read cached). For the DEFAULT file, overlay the
    ACTIVE market's gates (center/radius/SF thresholds, same keys) so one scoring
    config serves any market. Pass an explicit `path` in tests to load verbatim
    with NO market overlay."""
    cfg = _read_weights_file(path)
    if path is not None:
        return cfg
    from lib.market import gates as _market_gates
    merged = dict(cfg)                       # shallow copy; don't mutate the cached dict
    merged["gates"] = {**cfg.get("gates", {}), **_market_gates()}
    return merged


def _validate_weights(cfg: dict) -> None:
    """Fail loudly on a malformed weights file rather than silently miscoring."""
    assert "gates" in cfg, "weights.yaml missing 'gates'"
    assert "components" in cfg, "weights.yaml missing 'components'"
    gates = cfg["gates"]
    for required in ("min_building_sf", "icbd_center_lat", "icbd_center_lon"):
        assert required in gates, f"weights.yaml gates missing '{required}'"
    # Component weights sum to ~111 (105 base + condition_distress 6). The min(_, 100) clamp
    # always applies, so a sum >100 just means more ways to reach the cap; this range check
    # only catches a wildly mis-edited file.
    total = sum(c.get("weight", 0) for c in cfg["components"].values())
    assert 90 <= total <= 120, f"component weights sum to {total}, expected ~111"


def load_submarkets() -> dict:
    """The ACTIVE market's buy-box GeoJSON (markets/<MARKET>.yaml -> buybox_geojson)."""
    from lib.market import buybox_path
    with open(buybox_path()) as fh:
        return json.load(fh)


def icbd_center(cfg: dict | None = None) -> tuple[float, float]:
    """(lat, lon) scoring origin. weights.yaml is authoritative over the GeoJSON."""
    cfg = cfg or load_weights()
    g = cfg["gates"]
    return float(g["icbd_center_lat"]), float(g["icbd_center_lon"])
