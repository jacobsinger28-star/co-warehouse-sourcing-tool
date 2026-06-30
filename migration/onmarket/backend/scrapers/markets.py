"""
Target buy-box markets — the single source of truth for the markets SimiCap
actually sources in.

The on-market scrapers cover the whole US, but the team only wants brokers/
listings in these seven Southeast + Columbus markets. This module defines them
once, with:

  * a lat/long bounding box per market — used by the Crexi scraper to fetch only
    in-market inventory server-side (Crexi's /assets/search filters by
    latitude/longitude bounds), and
  * the city names + state per market — used by the Pipedrive in-market guardrail
    to keep out-of-market brokers from being pushed to the CRM.

Boxes are intentionally metro-wide (they include the industrial submarkets /
suburbs around each core city), then `is_in_target_market` confirms by lat/long
when geocoded coordinates are present, falling back to a city/state string match.
"""
from __future__ import annotations

import re

# Each market: bbox = (lat_min, lat_max, lng_min, lng_max); cities = lowercase
# city names in the metro (for the string-match guardrail fallback).
TARGET_MARKETS: list[dict] = [
    {
        "name": "Charlotte",
        "state": "NC",
        "bbox": (35.00, 35.55, -81.10, -80.60),
        "cities": [
            "charlotte", "huntersville", "matthews", "mint hill", "pineville",
            "stallings", "indian trail", "harrisburg", "concord", "monroe",
            "cornelius", "davidson", "fort mill", "rock hill", "gastonia",
            "belmont", "mooresville", "kannapolis",
        ],
    },
    {
        "name": "Raleigh",
        "state": "NC",
        "bbox": (35.60, 36.10, -79.10, -78.40),
        "cities": [
            "raleigh", "durham", "cary", "morrisville", "apex", "garner",
            "wake forest", "knightdale", "clayton", "holly springs",
            "fuquay-varina", "fuquay varina", "research triangle", "rtp",
            "chapel hill",
        ],
    },
    {
        "name": "Charleston",
        "state": "SC",
        "bbox": (32.65, 33.10, -80.30, -79.70),
        "cities": [
            "charleston", "north charleston", "mount pleasant", "summerville",
            "goose creek", "hanahan", "ladson", "moncks corner", "ridgeville",
            "hollywood", "johns island", "james island",
        ],
    },
    {
        "name": "Columbus",
        "state": "OH",
        "bbox": (39.75, 40.25, -83.25, -82.75),
        "cities": [
            "columbus", "dublin", "westerville", "gahanna", "reynoldsburg",
            "grove city", "hilliard", "groveport", "obetz", "whitehall",
            "new albany", "worthington", "pickerington", "canal winchester",
            "lockbourne", "west jefferson", "etna", "pataskala",
        ],
    },
    {
        "name": "Miami",
        "state": "FL",
        "bbox": (25.55, 26.00, -80.50, -80.10),
        "cities": [
            "miami", "miami gardens", "hialeah", "doral", "medley",
            "miami lakes", "opa-locka", "opa locka", "miami springs",
            "north miami", "hialeah gardens", "miramar", "hollywood",
            "pembroke pines", "homestead", "cutler bay", "kendall", "sweetwater",
        ],
    },
    {
        "name": "Boca Raton",
        "state": "FL",
        "bbox": (26.28, 26.45, -80.22, -80.05),
        "cities": [
            "boca raton", "deerfield beach", "delray beach", "highland beach",
        ],
    },
    {
        "name": "West Palm Beach",
        "state": "FL",
        "bbox": (26.55, 26.90, -80.20, -80.00),
        "cities": [
            "west palm beach", "palm beach", "riviera beach", "lake worth",
            "palm beach gardens", "jupiter", "lake park", "mangonia park",
            "north palm beach", "greenacres", "wellington",
        ],
    },
]

# US state abbreviation that may follow a city in an address ("Charlotte, NC").
_STATE_RE = re.compile(r",\s*([A-Z]{2})(?=[,\s\d]|$)")


def match_markets(markets: list[str] | None) -> list[dict]:
    """Map user-supplied market strings (e.g. "Charlotte, NC") to the configured
    TARGET_MARKETS. An empty/None list means *all* target markets — Crexi is a
    market-scoped source, so a nationwide ("Run All") request still scans only
    the buy-box markets here.
    """
    if not markets:
        return list(TARGET_MARKETS)
    wanted = [m.strip().lower() for m in markets if m and m.strip()]
    if not wanted:
        return list(TARGET_MARKETS)
    out: list[dict] = []
    for mk in TARGET_MARKETS:
        name = mk["name"].lower()
        if any(name in w or w in name or w.startswith(name) for w in wanted):
            out.append(mk)
    return out or list(TARGET_MARKETS)


def _in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float]) -> bool:
    lat_min, lat_max, lng_min, lng_max = bbox
    return lat_min <= lat <= lat_max and lng_min <= lng <= lng_max


def market_for_coords(lat: float | None, lng: float | None) -> dict | None:
    """Return the target market whose bbox contains (lat, lng), or None."""
    if lat is None or lng is None:
        return None
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    for mk in TARGET_MARKETS:
        if _in_bbox(lat_f, lng_f, mk["bbox"]):
            return mk
    return None


def market_for_address(address: str | None) -> dict | None:
    """Best-effort: return the target market matching an address string by
    city + state. Requires the state to match too, so "Charleston, WV" or a
    same-named city in the wrong state is not admitted."""
    if not address:
        return None
    low = address.lower()
    state_m = _STATE_RE.search(address)
    state = state_m.group(1).upper() if state_m else None
    for mk in TARGET_MARKETS:
        if state and state != mk["state"]:
            continue
        for city in mk["cities"]:
            # word-ish boundary so "miami" doesn't match "miamiville"
            if re.search(rf"(?<![a-z]){re.escape(city)}(?![a-z])", low):
                return mk
    return None


def is_in_target_market(row: dict) -> bool:
    """True if a listing/broker row belongs to one of the buy-box markets.

    Prefers geocoded lat/lng (most reliable, matches the Crexi bbox logic), then
    falls back to an address city/state match. A row with NO usable location
    signal returns False — the guardrail should not push a broker we can't place
    in a target market.
    """
    if market_for_coords(row.get("lat"), row.get("lng")) is not None:
        return True
    return market_for_address(row.get("address")) is not None
