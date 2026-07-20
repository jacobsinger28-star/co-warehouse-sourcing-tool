"""Geocoding with a persistent SQLite cache.

Primary: the US Census batch geocoder (free, no API key, no per-request rate
limit — one HTTP request resolves thousands of addresses). Fallback: Nominatim
one-at-a-time (1 req/sec) for the tail the Census misses (newer/private roads).
Addresses that are not real street points (highways, no street number) stay
unresolved by design — the console is map-first and drops them.
"""
import csv
import io
import os
import re
import sqlite3
import time
from pathlib import Path

import requests

# Same DATA_DIR convention as database.py — keep the geocode cache on the
# persistent volume so addresses don't need re-geocoding after a redeploy.
_DATA_DIR = Path(os.getenv("DATA_DIR") or Path(__file__).parent)
_DATA_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DB = _DATA_DIR / "geo_cache.db"

_CENSUS_BATCH = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
_CENSUS_CHUNK = 5000          # Census allows 10k/request; stay well under
_NOMINATIM = "https://nominatim.openstreetmap.org/search"
_UA = "co-warehouse-sourcing-tool/1.0"

_last_nominatim: float = 0.0


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


def _cache_get(address: str):
    with sqlite3.connect(CACHE_DB) as c:
        return c.execute(
            "SELECT lat, lng FROM geo_cache WHERE address=?", (address,)
        ).fetchone()


def _cache_put(address: str, lat: float, lng: float):
    with sqlite3.connect(CACHE_DB) as c:
        c.execute("INSERT OR REPLACE INTO geo_cache VALUES (?, ?, ?)", (address, lat, lng))


def geocode_cached(address: str) -> tuple[float | None, float | None]:
    """Cache-only lookup — NO network. Used in the scrape hot loop so storing a
    listing never blocks; uncached addresses are resolved in a later batch."""
    if not address or len(address.strip()) < 5:
        return None, None
    row = _cache_get(address)
    return (row[0], row[1]) if row else (None, None)


# "550 Expy Park Dr, Nashville, Davidson County, TN 37210" → street, city, ST, ZIP
def _split_address(address: str) -> tuple[str, str, str, str]:
    parts = [p.strip() for p in address.split(",")]
    street = parts[0] if parts else ""
    city = parts[1] if len(parts) > 1 else ""
    if city.lower().endswith("county"):
        city = ""
    st, zp = "", ""
    if parts:
        m = re.search(r"\b([A-Z]{2})\b\s*(\d{5})?", parts[-1])
        if m:
            st, zp = m.group(1), (m.group(2) or "")
    return street, city, st, zp


def _census_batch(addresses: list[str]) -> dict[str, tuple[float, float]]:
    """One Census batch request. Returns {address: (lat, lng)} for matches."""
    buf = io.StringIO()
    w = csv.writer(buf)
    for i, a in enumerate(addresses):
        street, city, st, zp = _split_address(a)
        if not street:
            continue
        w.writerow([i, street, city, st, zp])
    if not buf.getvalue():
        return {}
    boundary = "----cwsourcinggeocode"
    payload = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"benchmark\"\r\n\r\n"
        f"Public_AR_Current\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"addressFile\"; "
        f"filename=\"a.csv\"\r\nContent-Type: text/csv\r\n\r\n{buf.getvalue()}\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    resp = requests.post(
        _CENSUS_BATCH,
        data=payload,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        timeout=180,
    )
    hits: dict[str, tuple[float, float]] = {}
    for rec in csv.reader(io.StringIO(resp.text)):
        # id, input, Match/No_Match/Tie, Exact/Non_Exact, matched addr, "lon,lat", ...
        if len(rec) >= 6 and rec[2] == "Match" and rec[5]:
            try:
                idx = int(rec[0])
                lon, lat = rec[5].split(",")
                hits[addresses[idx]] = (round(float(lat), 6), round(float(lon), 6))
            except (ValueError, IndexError):
                continue
    return hits


def _nominatim_one(address: str) -> tuple[float, float] | None:
    """Single Nominatim lookup, respecting the 1 req/sec limit."""
    global _last_nominatim
    wait = 1.0 - (time.monotonic() - _last_nominatim)
    if wait > 0:
        time.sleep(wait)
    try:
        resp = requests.get(
            _NOMINATIM,
            params={"q": address, "format": "json", "limit": 1, "countrycodes": "us"},
            headers={"User-Agent": _UA},
            timeout=6,
        )
        _last_nominatim = time.monotonic()
        data = resp.json()
        if data:
            return round(float(data[0]["lat"]), 6), round(float(data[0]["lon"]), 6)
    except Exception:  # noqa: BLE001 — geocode failure is non-fatal
        pass
    _last_nominatim = time.monotonic()
    return None


def geocode_batch(
    addresses: list[str],
    stop_check=None,
    nominatim_cap: int = 80,
) -> dict[str, tuple[float, float]]:
    """Resolve many addresses at once. Returns {address: (lat, lng)} for every
    address resolved (from cache, Census, or the bounded Nominatim fallback);
    unresolved addresses are simply absent. Successful lookups are cached.

    stop_check: optional callable → True to abort early (user pressed Stop).
    nominatim_cap: max Nominatim fallbacks this call (bounds the 1 req/sec tail).
    """
    uniq = list(dict.fromkeys(a for a in addresses if a and len(a.strip()) >= 5))
    result: dict[str, tuple[float, float]] = {}
    todo: list[str] = []
    for a in uniq:
        row = _cache_get(a)
        if row:
            result[a] = (row[0], row[1])
        else:
            todo.append(a)
    if not todo:
        return result

    # Census batch (chunked) — the fast, free bulk path.
    for i in range(0, len(todo), _CENSUS_CHUNK):
        if stop_check and stop_check():
            return result
        for addr, (lat, lng) in _census_batch(todo[i:i + _CENSUS_CHUNK]).items():
            result[addr] = (lat, lng)
            _cache_put(addr, lat, lng)

    # Nominatim fallback for the tail Census couldn't place (bounded + stop-aware).
    n = 0
    for a in todo:
        if a in result:
            continue
        if n >= nominatim_cap or (stop_check and stop_check()):
            break
        n += 1
        latlng = _nominatim_one(a)
        if latlng:
            result[a] = latlng
            _cache_put(a, *latlng)
    return result


def geocode_sync(address: str) -> tuple[float | None, float | None]:
    """Single-address geocode (cache → Census one-line? no — cache → Nominatim).
    Kept for callers that need a one-off; the scrape path uses geocode_batch."""
    if not address or len(address.strip()) < 5:
        return None, None
    row = _cache_get(address)
    if row:
        return row[0], row[1]
    latlng = _nominatim_one(address)
    if latlng:
        _cache_put(address, *latlng)
        return latlng
    return None, None
