"""Nominatim geocoding with SQLite cache. Respects the 1 req/sec rate limit."""
import os
import sqlite3
import time
from pathlib import Path

import requests

# Same DATA_DIR convention as database.py — keep the geocode cache on the
# persistent volume so addresses don't need re-geocoding after a redeploy.
_DATA_DIR = Path(os.getenv("DATA_DIR") or Path(__file__).parent)
_DATA_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DB = _DATA_DIR / "geo_cache.db"
_URL = "https://nominatim.openstreetmap.org/search"
_UA = "co-warehouse-sourcing-tool/1.0"

_last_req: float = 0.0


def _init():
    with sqlite3.connect(CACHE_DB) as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS geo_cache (
                address TEXT PRIMARY KEY,
                lat     REAL,
                lng     REAL
            )"""
        )


_init()


def geocode_sync(address: str) -> tuple[float | None, float | None]:
    """Return (lat, lng) for an address string, or (None, None) on failure.

    Results are cached in geo_cache.db so repeat runs are instant.
    """
    global _last_req
    if not address or len(address.strip()) < 5:
        return None, None

    # Cache hit
    with sqlite3.connect(CACHE_DB) as c:
        row = c.execute(
            "SELECT lat, lng FROM geo_cache WHERE address=?", (address,)
        ).fetchone()
        if row:
            return row[0], row[1]

    # Rate limit: Nominatim requires ≤ 1 req/sec
    wait = 1.0 - (time.monotonic() - _last_req)
    if wait > 0:
        time.sleep(wait)

    try:
        resp = requests.get(
            _URL,
            params={"q": address, "format": "json", "limit": 1, "countrycodes": "us"},
            headers={"User-Agent": _UA},
            timeout=6,
        )
        _last_req = time.monotonic()
        data = resp.json()
        if data:
            lat = float(data[0]["lat"])
            lng = float(data[0]["lon"])
            with sqlite3.connect(CACHE_DB) as c:
                c.execute(
                    "INSERT OR REPLACE INTO geo_cache VALUES (?, ?, ?)",
                    (address, lat, lng),
                )
            return lat, lng
    except Exception:
        pass

    _last_req = time.monotonic()
    return None, None
