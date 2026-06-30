#!/usr/bin/env python3
"""
normalize.py — owner entities, portfolio grouping, ownership links (Day 3).

  staging_parcels (owner fields) -> entities (typed, normalized, flagged)
                                 -> ownerships (apn <-> entity)
                                 -> portfolio_group_id (same normalized mailing addr)

All parsing logic lives in lib/normalize_text.py (pure, unit-tested). This script
is just the DB plumbing around it. Idempotent: entities upsert on
(name_norm, mailing_norm); ownerships on (apn, entity_id).

    python transform/normalize.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import home_state as _home_state  # noqa: E402
from lib.normalize_text import entity_type, norm_address, norm_name  # noqa: E402


def load_owner_rows() -> list[dict]:
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            """
            SELECT apn, owner, own_addr, own_city, own_state, own_zip
            FROM staging_parcels
            WHERE owner IS NOT NULL AND owner <> ''
            """
        )
        return cur.fetchall()


def upsert_entities(rows: list[dict], job: JobRun) -> dict[tuple[str, str], int]:
    """One entity per distinct (name_norm, mailing_norm). Returns key -> entity_id."""
    home = _home_state()                     # active market's in-state code (TN/OH/NC/...)
    seen: dict[tuple[str, str], dict] = {}
    for r in rows:
        name_norm = norm_name(r["owner"])
        if not name_norm:
            job.fail("owner normalizes to empty", ref=r["apn"])
            continue
        mailing_norm = norm_address(
            r["own_addr"], r["own_city"], r["own_state"], r["own_zip"])
        key = (name_norm, mailing_norm)
        if key not in seen:
            state = (r["own_state"] or "").strip().upper()
            seen[key] = {
                "name_raw": r["owner"],
                "name_norm": name_norm,
                "mailing_address": ", ".join(
                    p for p in (r["own_addr"], r["own_city"], state, r["own_zip"]) if p),
                "mailing_norm": mailing_norm,
                "mailing_state": state or None,
                # Empty state stays NULL (unknown), not out-of-state: a missing
                # mailing state must not award +2 owner_profile points. Home state is
                # market-driven (markets/<MARKET>.yaml home_state), not hardcoded TN.
                "is_out_of_state": (state != home) if (state and home) else None,
                "entity_type": entity_type(r["owner"]),
            }
        job.ok()

    ids: dict[tuple[str, str], int] = {}
    with cursor() as cur:
        for key, e in seen.items():
            cur.execute(
                """
                INSERT INTO entities (name_raw, name_norm, mailing_address, mailing_norm,
                                      mailing_state, is_out_of_state, entity_type)
                VALUES (%(name_raw)s, %(name_norm)s, %(mailing_address)s, %(mailing_norm)s,
                        %(mailing_state)s, %(is_out_of_state)s, %(entity_type)s)
                ON CONFLICT (name_norm, COALESCE(mailing_norm, '')) DO UPDATE SET
                  name_raw = EXCLUDED.name_raw,
                  mailing_address = EXCLUDED.mailing_address,
                  mailing_state = EXCLUDED.mailing_state,
                  is_out_of_state = EXCLUDED.is_out_of_state,
                  entity_type = EXCLUDED.entity_type
                RETURNING entity_id
                """,
                e,
            )
            ids[key] = cur.fetchone()[0]
    print(f"  entities upserted: {len(ids)}")
    return ids


def link_ownerships(rows: list[dict], ids: dict[tuple[str, str], int]) -> int:
    links = []
    for r in rows:
        key = (norm_name(r["owner"]),
               norm_address(r["own_addr"], r["own_city"], r["own_state"], r["own_zip"]))
        if key in ids:
            links.append((r["apn"], ids[key], "assessor"))
    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO ownerships (apn, entity_id, source) VALUES %s "
            "ON CONFLICT (apn, entity_id) DO NOTHING",
            links, page_size=1000,
        )
    print(f"  ownerships linked: {len(links)}")
    return len(links)


def assign_portfolio_groups() -> None:
    """Same normalized mailing address -> same portfolio group (brief's rule).
    Name-only matches are NOT merged — that's how false merges happen."""
    with cursor() as cur:
        cur.execute(
            """
            WITH g AS (
              SELECT entity_id,
                     dense_rank() OVER (ORDER BY mailing_norm) AS gid
              FROM entities
              WHERE mailing_norm IS NOT NULL AND mailing_norm <> ''
            )
            UPDATE entities e SET portfolio_group_id = g.gid
            FROM g WHERE e.entity_id = g.entity_id
            """
        )


def qa() -> None:
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT entity_type, count(*) AS ct FROM entities "
            "GROUP BY entity_type ORDER BY ct DESC")
        print("  entity types:", {r["entity_type"]: r["ct"] for r in cur.fetchall()})
        cur.execute(
            "SELECT count(*) AS ct FROM entities WHERE is_out_of_state")
        print(f"  out-of-state entities: {cur.fetchone()['ct']}")
        # Founder Day-3 review: largest portfolio clusters, look for false merges.
        cur.execute(
            """
            SELECT e.portfolio_group_id, count(DISTINCT o.apn) AS parcels,
                   count(DISTINCT e.entity_id) AS entities,
                   min(e.name_raw) AS sample_name, min(e.mailing_norm) AS mailing
            FROM entities e JOIN ownerships o USING (entity_id)
            WHERE e.portfolio_group_id IS NOT NULL
            GROUP BY e.portfolio_group_id
            HAVING count(DISTINCT o.apn) > 1
            ORDER BY parcels DESC LIMIT 10
            """
        )
        print("  top portfolio clusters (founder: check for false merges):")
        for r in cur.fetchall():
            print(f"    {r['parcels']:>3} parcels | {r['entities']} entities | "
                  f"{r['sample_name'][:40]:<40} | {r['mailing'][:45]}")


def reset_derived() -> None:
    """entities/ownerships are fully derived from staging_parcels — rebuild them.

    Without this, a change to the normalization rules strands rows keyed on the
    OLD normalization (found Day 2: AVE/AV split one owner into two groups, and
    the fix alone couldn't merge them because both variants persisted).
    Entities referenced by contacts are preserved — phone numbers are NOT
    derived data and must never be dropped; QA flags any left orphaned."""
    with cursor() as cur:
        cur.execute("DELETE FROM ownerships")
        cur.execute(
            "DELETE FROM entities WHERE entity_id NOT IN "
            "(SELECT DISTINCT entity_id FROM contacts WHERE entity_id IS NOT NULL)")


def main() -> int:
    print("normalize: entities + ownerships + portfolios ...")
    with JobRun("normalize") as job:
        rows = load_owner_rows()
        reset_derived()
        ids = upsert_entities(rows, job)
        link_ownerships(rows, ids)
        assign_portfolio_groups()
        qa()
        with cursor(dict_rows=True, commit=False) as cur:
            cur.execute(
                "SELECT count(*) AS ct FROM entities e WHERE NOT EXISTS "
                "(SELECT 1 FROM ownerships o WHERE o.entity_id = e.entity_id)")
            orphans = cur.fetchone()["ct"]
            if orphans:
                print(f"  !! {orphans} contact-bearing entities no longer match an "
                      f"ownership — re-link manually before skip-trace export")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
