"""Restore listings from a SQLite backup, marking each row as cached=1.

Idempotent: only inserts rows whose listing_url isn't already in the live DB.
Cached rows are:
  - skipped by prune_stale_listings (won't get wiped by force_refresh)
  - auto-flipped to cached=0 the next time a real scrape touches the same URL

Usage:
    cd backend
    ./.venv/bin/python -m scripts.restore_from_backup [path/to/backup.db]
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
LIVE_DB = BACKEND_DIR / "live_listings.db"
DEFAULT_BACKUP = BACKEND_DIR / "live_listings.db.backup-20260608-165122"


def main() -> int:
    backup_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_BACKUP
    if not backup_path.is_file():
        print(f"error: backup file not found: {backup_path}", file=sys.stderr)
        return 1
    if not LIVE_DB.is_file():
        print(f"error: live DB not found: {LIVE_DB}", file=sys.stderr)
        return 1

    # Ensure the live DB has the cached column (init_db runs the migrations)
    sys.path.insert(0, str(BACKEND_DIR))
    from database import init_db  # noqa: E402
    init_db()

    print(f"backup:  {backup_path}")
    print(f"live DB: {LIVE_DB}")

    src = sqlite3.connect(backup_path)
    src.row_factory = sqlite3.Row
    dst = sqlite3.connect(LIVE_DB)
    dst.row_factory = sqlite3.Row

    # Columns the backup actually has — preserve compatibility if schema drifted
    src_cols = {row[1] for row in src.execute("PRAGMA table_info(listings)")}
    dst_cols = {row[1] for row in dst.execute("PRAGMA table_info(listings)")}
    common = sorted((src_cols & dst_cols) - {"id"})  # don't carry IDs over

    if "listing_url" not in common:
        print("error: listing_url missing from backup or live DB", file=sys.stderr)
        return 1
    if "cached" not in dst_cols:
        print("error: live DB has no `cached` column — run migrations first",
              file=sys.stderr)
        return 1

    existing_urls = {
        row[0] for row in dst.execute("SELECT listing_url FROM listings")
    }

    backup_rows = src.execute(
        f"SELECT {', '.join(common)} FROM listings"
    ).fetchall()

    inserted = 0
    skipped_existing = 0
    by_source: dict[str, int] = {}

    insert_cols = common + ["cached"]
    placeholders = ", ".join("?" * len(insert_cols))
    insert_sql = (
        f"INSERT INTO listings ({', '.join(insert_cols)}) "
        f"VALUES ({placeholders})"
    )

    for row in backup_rows:
        url = row["listing_url"]
        if not url:
            continue
        if url in existing_urls:
            skipped_existing += 1
            continue
        values = [row[c] for c in common] + [1]  # cached=1
        try:
            dst.execute(insert_sql, values)
            inserted += 1
            by_source[row["source"]] = by_source.get(row["source"], 0) + 1
        except sqlite3.IntegrityError as exc:
            print(f"  skip {url[:60]}…  ({exc})")
    dst.commit()

    print()
    print(f"inserted: {inserted}")
    print(f"skipped (already in live DB): {skipped_existing}")
    print(f"by source:")
    for source, n in sorted(by_source.items(), key=lambda x: -x[1]):
        print(f"  {source}: {n}")

    src.close()
    dst.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
