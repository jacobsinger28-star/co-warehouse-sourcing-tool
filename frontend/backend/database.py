"""SQLite storage for live-scraped listings and scrape job status."""
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

# Data directory — point DATA_DIR at a mounted persistent volume (e.g. /data on
# Railway) so the database survives container redeploys/restarts. Defaults to
# this folder for local dev.
DATA_DIR = Path(os.getenv("DATA_DIR") or Path(__file__).parent)
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "live_listings.db"

_SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS listings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source            TEXT,
    listing_url       TEXT UNIQUE,
    address           TEXT,
    total_sf          REAL,
    building_type     TEXT,
    clear_height      REAL,
    office_pct        REAL,
    zoning            TEXT,
    power             TEXT,
    loading_docks     REAL,
    grade_doors       REAL,
    sprinklered       TEXT,
    parking_ratio     REAL,
    truck_court_depth REAL,
    occupancy_pct     REAL,
    walt              REAL,
    asking_price_psf  REAL,
    -- Listing broker contact (captured by the Colliers/RCM scraper).
    -- broker_phone is the number published on the listing card (usually a
    -- direct/office line). broker_cell is a separately-labeled mobile number
    -- found by the optional broker-bio fetch — null when none is published.
    broker_name       TEXT,
    broker_email      TEXT,
    broker_phone      TEXT,
    broker_cell       TEXT,
    score_category    TEXT,
    scoring_reason    TEXT,
    lat               REAL,
    lng               REAL,
    scraped_at        TEXT,
    -- first_seen: when this listing_url first entered the DB. Set on insert,
    -- NEVER updated by re-scrapes — the console uses it to badge listings that
    -- are genuinely new since the last "Keep Sourcing" run (scraped_at can't:
    -- a force refresh touches every row).
    first_seen        TEXT,
    raw_data          TEXT,
    -- cached=1 means restored from backup (not confirmed fresh in current run).
    -- Auto-flips to 0 the next time a scrape upserts this listing_url.
    -- prune_stale_listings ignores rows where cached=1.
    cached            INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scrape_jobs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at     TEXT,
    finished_at    TEXT,
    status         TEXT DEFAULT 'running',
    listings_found INTEGER DEFAULT 0,
    error          TEXT
);
"""

# Columns written on every upsert
_FIELDS = [
    "source", "listing_url", "address", "total_sf", "building_type",
    "clear_height", "office_pct", "zoning", "power", "loading_docks",
    "grade_doors", "sprinklered", "parking_ratio", "truck_court_depth",
    "occupancy_pct", "walt", "asking_price_psf",
    "broker_name", "broker_email", "broker_phone", "broker_cell",
    "score_category", "scoring_reason", "lat", "lng",
]

# Columns to add if the DB was created before this version
_MIGRATIONS = [
    "ALTER TABLE listings ADD COLUMN grade_doors REAL",
    "ALTER TABLE listings ADD COLUMN occupancy_pct REAL",
    "ALTER TABLE listings ADD COLUMN walt REAL",
    "ALTER TABLE listings ADD COLUMN cached INTEGER DEFAULT 0",
    "ALTER TABLE listings ADD COLUMN broker_name TEXT",
    "ALTER TABLE listings ADD COLUMN broker_email TEXT",
    "ALTER TABLE listings ADD COLUMN broker_phone TEXT",
    "ALTER TABLE listings ADD COLUMN broker_cell TEXT",
    "ALTER TABLE listings ADD COLUMN first_seen TEXT",
]


def _conn():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.execute("PRAGMA journal_mode=WAL")
    c.row_factory = sqlite3.Row
    return c


def _migrate(c: sqlite3.Connection):
    """Add new columns to an existing database without breaking old data."""
    existing = {row[1] for row in c.execute("PRAGMA table_info(listings)")}
    for stmt in _MIGRATIONS:
        # Extract column name from "ALTER TABLE listings ADD COLUMN <name> <type>"
        col = stmt.split()[-2]
        if col not in existing:
            try:
                c.execute(stmt)
            except Exception:
                pass  # already exists or table not yet created


def init_db():
    with _conn() as c:
        c.executescript(_SCHEMA)
        _migrate(c)
        # Backfill rows that predate the first_seen column so they don't all
        # get badged "new" — treat them as first seen when last scraped.
        c.execute("UPDATE listings SET first_seen = scraped_at WHERE first_seen IS NULL")


def upsert_listing(listing: dict):
    row = {f: listing.get(f) for f in _FIELDS}
    row["scraped_at"] = datetime.utcnow().isoformat()
    row["first_seen"] = row["scraped_at"]
    row["raw_data"] = json.dumps(listing.get("raw_data") or {})
    cols = ", ".join(_FIELDS)
    placeholders = ", ".join(f":{f}" for f in _FIELDS)
    with _conn() as c:
        c.execute(
            f"""
            INSERT INTO listings ({cols}, scraped_at, first_seen, raw_data)
            VALUES ({placeholders}, :scraped_at, :first_seen, :raw_data)
            ON CONFLICT(listing_url) DO UPDATE SET
                total_sf          = excluded.total_sf,
                clear_height      = excluded.clear_height,
                office_pct        = excluded.office_pct,
                loading_docks     = excluded.loading_docks,
                grade_doors       = excluded.grade_doors,
                sprinklered       = excluded.sprinklered,
                parking_ratio     = excluded.parking_ratio,
                truck_court_depth = excluded.truck_court_depth,
                occupancy_pct     = excluded.occupancy_pct,
                walt              = excluded.walt,
                asking_price_psf  = excluded.asking_price_psf,
                broker_name       = excluded.broker_name,
                broker_email      = excluded.broker_email,
                broker_phone      = excluded.broker_phone,
                -- broker_cell is enriched at Pipedrive-import time, not during
                -- the scrape, so a re-scrape (which carries no cell) must not
                -- wipe a previously found mobile number.
                broker_cell       = COALESCE(excluded.broker_cell, broker_cell),
                score_category    = excluded.score_category,
                scoring_reason    = excluded.scoring_reason,
                lat               = excluded.lat,
                lng               = excluded.lng,
                scraped_at        = excluded.scraped_at,
                -- a re-scrape must not make an old listing look new
                first_seen        = COALESCE(first_seen, excluded.first_seen),
                -- Auto-clear cached flag: a fresh scrape confirms this listing
                -- is still live, so it stops being "restored from backup".
                cached            = 0
            """,
            row,
        )


def get_known_urls(max_age_hours: float | None = None) -> set[str]:
    """
    Return the set of listing URLs already in the cache.

    If max_age_hours is given, only URLs scraped within that many hours
    are considered "fresh" (i.e. returned in the skip-set).  URLs older
    than the threshold are NOT returned, so the scraper will re-fetch and
    refresh them.
    """
    with _conn() as c:
        if max_age_hours is not None:
            from datetime import timedelta
            cutoff = (datetime.utcnow() - timedelta(hours=max_age_hours)).isoformat()
            rows = c.execute(
                "SELECT listing_url FROM listings WHERE scraped_at >= ?", (cutoff,)
            ).fetchall()
        else:
            rows = c.execute("SELECT listing_url FROM listings").fetchall()
    return {row[0] for row in rows}


def prune_stale_listings(scraped_since: str, sources: list[str] | None = None) -> int:
    """
    Delete listings whose scraped_at is older than `scraped_since` (ISO timestamp).
    Used after a forced full-refresh: anything not touched during the run is
    no longer appearing on brokerage sites (sold / removed).

    `sources` restricts the prune to those source names. Pass the sites that
    actually COMPLETED the refresh — a site that errored out (bot wall, selector
    rot) must not get its whole inventory wiped just because it yielded nothing.
    None/empty = prune nothing (fail-safe; the old prune-everything behavior
    required every site to have succeeded).

    Cached listings (restored from backup) are NEVER pruned — they need to be
    confirmed fresh by a real scrape before they become subject to pruning.

    Returns the number of rows deleted.
    """
    if not sources:
        return 0
    ph = ",".join("?" for _ in sources)
    with _conn() as c:
        cur = c.execute(
            f"DELETE FROM listings WHERE scraped_at < ? AND cached = 0 AND source IN ({ph})",
            (scraped_since, *sources),
        )
        return cur.rowcount


def set_broker_cell(listing_url: str, cell: str):
    """Persist a broker mobile number found by the broker-bio fetch, so future
    Pipedrive imports of the same listing skip the (expensive) render."""
    with _conn() as c:
        c.execute(
            "UPDATE listings SET broker_cell = ? WHERE listing_url = ?",
            (cell, listing_url),
        )


def set_coords(listing_url: str, lat: float, lng: float):
    """Backfill lat/lng after a listing is stored — the scrape stores rows
    immediately (cache-only coords) and a later batch geocode fills the rest."""
    with _conn() as c:
        c.execute(
            "UPDATE listings SET lat = ?, lng = ? WHERE listing_url = ?",
            (lat, lng, listing_url),
        )


def get_source_counts() -> dict[str, int]:
    """Return {source: count} for all listings in the DB."""
    with _conn() as c:
        rows = c.execute(
            "SELECT source, COUNT(*) as n FROM listings GROUP BY source ORDER BY n DESC"
        ).fetchall()
    return {row[0]: row[1] for row in rows}


def get_cached_source_counts() -> dict[str, int]:
    """Return {source: cached_count} — how many listings per source are still
    flagged as restored-from-backup (cached=1). UI uses this to show a badge."""
    with _conn() as c:
        rows = c.execute(
            "SELECT source, COUNT(*) as n FROM listings WHERE cached = 1 "
            "GROUP BY source"
        ).fetchall()
    return {row[0]: row[1] for row in rows}


def clear_listings():
    """Delete all scraped listings (keeps job history)."""
    with _conn() as c:
        c.execute("DELETE FROM listings")


def get_listings(score_category: str | None = None) -> list[dict]:
    with _conn() as c:
        if score_category:
            rows = c.execute(
                "SELECT * FROM listings WHERE score_category=? ORDER BY scraped_at DESC",
                (score_category,),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM listings ORDER BY scraped_at DESC"
            ).fetchall()
    return [dict(r) for r in rows]


def start_job() -> int:
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO scrape_jobs (started_at, status) VALUES (?, 'running')",
            (datetime.utcnow().isoformat(),),
        )
        return cur.lastrowid


def finish_job(
    job_id: int,
    listings_found: int,
    error: str | None = None,
    status: str | None = None,
):
    final_status = status or ("error" if error else "done")
    with _conn() as c:
        c.execute(
            "UPDATE scrape_jobs SET finished_at=?, status=?, listings_found=?, error=? WHERE id=?",
            (
                datetime.utcnow().isoformat(),
                final_status,
                listings_found,
                error,
                job_id,
            ),
        )


def get_job_status() -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM scrape_jobs ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def reconcile_orphaned_jobs() -> int:
    """A freshly-started process cannot have a live scrape thread, so any job
    still marked 'running' is orphaned — its worker died on a container
    restart/redeploy without ever calling finish_job(). Left as-is it wedges
    the console: 'Keep Sourcing' returns already_running and 'Stop' never
    resolves. Mark such rows 'interrupted' at boot so the buttons work again.
    Returns the number of rows fixed."""
    with _conn() as c:
        cur = c.execute(
            "UPDATE scrape_jobs SET status='interrupted', finished_at=? "
            "WHERE status='running'",
            (datetime.utcnow().isoformat(),),
        )
        return cur.rowcount
