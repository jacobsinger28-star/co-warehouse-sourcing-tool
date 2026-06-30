"""
Active-market selection + per-market config loader.

The pipeline is re-pointable across metros: each market is one file under markets/.
The active market is chosen by the MARKET env var (default 'nashville'). Everything
market-specific — data-source URLs, land-use codes, gates (center/radius), field
mappings, DB schema, buy-box geometry — lives in markets/<market>.yaml, never in
Python. See markets/nashville.yaml (the reference), markets/columbus.yaml, and the
DATA_NOTES*.md discovery docs.
"""
from __future__ import annotations

import functools
import os
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
MARKETS_DIR = REPO_ROOT / "markets"
DEFAULT_MARKET = "nashville"


def active_market() -> str:
    """The market this process operates on (MARKET env var, default 'nashville')."""
    return (os.environ.get("MARKET") or DEFAULT_MARKET).strip().lower()


@functools.lru_cache(maxsize=None)
def load_market(name: str | None = None) -> dict:
    """Parse markets/<name>.yaml (default: the active market). Cached per name."""
    name = (name or active_market()).strip().lower()
    path = MARKETS_DIR / f"{name}.yaml"
    if not path.exists():
        available = sorted(p.stem for p in MARKETS_DIR.glob("*.yaml"))
        raise FileNotFoundError(
            f"unknown market '{name}': {path} not found. Available: {available}")
    with open(path) as fh:
        cfg = yaml.safe_load(fh)
    _validate(cfg, name)
    return cfg


def _validate(cfg: dict, name: str) -> None:
    """Fail loudly on a malformed market file rather than silently mis-pointing."""
    for key in ("market", "db_schema", "sources", "gates", "land_use"):
        assert key in cfg, f"markets/{name}.yaml missing required key '{key}'"
    assert "parcels" in cfg["sources"], f"markets/{name}.yaml sources missing 'parcels'"
    assert cfg["land_use"].get("industrial_codes"), \
        f"markets/{name}.yaml land_use missing 'industrial_codes'"
    for g in ("min_building_sf", "icbd_center_lat", "icbd_center_lon"):
        assert g in cfg["gates"], f"markets/{name}.yaml gates missing '{g}'"


# --- convenience accessors (operate on the active market unless `name` given) ---
def db_schema(name: str | None = None) -> str:
    return load_market(name).get("db_schema", "public")


def sources(name: str | None = None) -> dict:
    return dict(load_market(name)["sources"])


def gates(name: str | None = None) -> dict:
    return dict(load_market(name).get("gates") or {})


def industrial_codes(name: str | None = None) -> dict:
    """{code: description} of the market's industrial land-use codes.

    Accepts either a {code: desc} map or a bare list in the YAML. Returned as a dict
    so callers can use both membership (`x in codes`) and iteration (`for c in codes`)
    exactly as they did with the old hardcoded constant.
    """
    codes = load_market(name)["land_use"]["industrial_codes"]
    if isinstance(codes, dict):
        return {str(k): (v or "") for k, v in codes.items()}
    return {str(c): "" for c in codes}


def excluded_structure_types(name: str | None = None) -> list:
    return list(load_market(name)["land_use"].get("excluded_structure_types") or [])


def home_state(name: str | None = None) -> str | None:
    """The market's in-state code (e.g. 'TN', 'OH', 'NC'). A mailing state other than
    this flags an owner is_out_of_state. None => out-of-state can't be inferred."""
    s = load_market(name).get("home_state")
    return s.strip().upper() if s else None


def buybox_path(name: str | None = None) -> Path:
    rel = load_market(name).get("buybox_geojson", "imports/submarkets.geojson")
    return REPO_ROOT / rel
