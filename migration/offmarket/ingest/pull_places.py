#!/usr/bin/env python3
"""
pull_places.py — SCAFFOLD (not yet validated against the live API).

Pull Google Maps **Places** business data per parcel and turn it into the same structured signals
our manual Chrome-VLM pass produces (`imagery/record_observation.py`), but PROGRAMMATICALLY and at
WHOLE-UNIVERSE scale. This is the structured sibling of the manual imagery pass — see the POC and
the full use-case catalog in `docs/MAPS_PLACES_POC.md`.

WHY a scaffold and not a finished module: like `imagery/fetch_images.py`, an untested module that
hits a paid external API is worse than an honest stub. `GOOGLE_MAPS_API_KEY` is not set yet, so:
  * with NO key  -> exits 0 with a skip note (keeps `make refresh` green).
  * with a key   -> default is `--dry-run`: it fetches + classifies + PRINTS what it would land,
                    writing nothing, so the founder can eyeball accuracy before trusting it.
                    Pass `--write` to actually upsert.

WHAT THE POC FOUND (docs/MAPS_PLACES_POC.md): on 11 hand-verified Columbus parcels Google had usable
business data for 10/11 and added category / phone / website / hours / review-text / activity-recency
on top of the tenant name. It also caught a false-positive our imagery missed (773 Markison) and a
conversion by category alone (512 Maier = "Rock climbing gym").

HARD RULES (carry the lessons that bit us before):
  * ABSENT DATA IS NEVER A NEGATIVE. No place found -> contributes 0, never a deduction. The hottest
    off-market targets (e.g. 521 Marion) have NO Google pin at all.
  * NEVER CLOBBER A HUMAN-VERIFIED ROW. record_observation upserts ON CONFLICT (apn); a human
    'human-chrome-vlm' observation must not be buried by an automated 'google-places' one
    (the §6e re-score lesson). We SKIP any apn already human_verified=True unless --force.
  * EVIDENCE BEFORE SCORE. Adding a scored weight for any Places-derived signal is a founder
    decision; until then these land as sourced evidence (like visual_distress).

Usage:
    MARKET=columbus python ingest/pull_places.py --top 25                # dry-run, top 25 of queue
    MARKET=columbus python ingest/pull_places.py --apn 010-009676        # one parcel, dry-run
    MARKET=columbus python ingest/pull_places.py --top 25 --write        # actually land it
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import cursor  # noqa: E402
from lib.market import active_market, home_state  # noqa: E402

# --- Places API (New) ------------------------------------------------------ #
TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
# Field mask keeps the bill down — only what we map below. (Place Details fields ride in the
# Text Search response when requested via the mask, so one call usually suffices.)
FIELD_MASK = ",".join(
    f"places.{f}" for f in (
        "displayName", "primaryType", "types", "businessStatus", "rating",
        "userRatingCount", "nationalPhoneNumber", "websiteUri",
        "regularOpeningHours.weekdayDescriptions", "reviews", "formattedAddress",
    )
)

# Google place `types` -> our use_truth enum (record_observation.ENUMS["use_truth"]).
# Anything mapping to an EXCLUDED competing use (self-storage, church, retail, entertainment, auto
# sales) flips matches_landuse=False so the land-use gate / call sheet can flag the conversion.
TYPE_TO_USE_TRUTH = {
    "warehouse": "warehouse", "moving_company": "truck_terminal",
    "storage": "self_storage", "self_storage": "self_storage",
    "gym": "entertainment", "fitness_center": "entertainment",
    "church": "church", "place_of_worship": "church",
    "store": "retail", "car_dealer": "retail", "shopping_mall": "retail",
    "general_contractor": "flex", "electrician": "flex", "plumber": "flex",
    # manufacturing-ish
    "manufacturer": "manufacturing", "factory": "manufacturing",
}
EXCLUDED_USES = {"self_storage", "retail", "church", "entertainment"}

# Review free-text -> distress keywords (use case #11, review-text mining).
DISTRESS_KEYWORDS = (
    "abandoned", "out of business", "closed down", "permanently closed", "vacant",
    "gate locked", "no one answers", "they moved", "moved out", "overgrown", "run down",
    "boarded", "looks closed", "derelict",
)


def _api_key() -> str | None:
    return os.environ.get("GOOGLE_MAPS_API_KEY")


def _queue(top: int | None, apn: str | None) -> list[dict]:
    """Top-N of the call queue (or one apn), with the situs address to search on.

    The ranked queue is the latest `scores.total` per apn (there is no `universe` table —
    scores has a (apn, scored_at) PK, so we take the most recent row per apn). Tables are
    unqualified: lib.db sets search_path to the active MARKET schema."""
    if apn:
        sql = """
            SELECT p.apn, p.situs_address,
                   COALESCE(o.human_verified, false) AS already_human
            FROM parcels p
            LEFT JOIN site_observations o USING (apn)
            WHERE p.apn = %s
        """
        params: tuple = (apn,)
    else:
        sql = """
            WITH latest AS (
                SELECT DISTINCT ON (apn) apn, total
                FROM scores ORDER BY apn, scored_at DESC
            )
            SELECT p.apn, p.situs_address,
                   COALESCE(o.human_verified, false) AS already_human,
                   l.total AS score
            FROM parcels p
            JOIN latest l USING (apn)
            LEFT JOIN site_observations o USING (apn)
            ORDER BY l.total DESC NULLS LAST
        """ + ("LIMIT %s" if top else "")
        params = (top,) if top else ()
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def search_place(situs: str) -> dict | None:
    """Places Text Search (fuzzy — handles range addresses like '600 - 740 MARION RD'). Returns the
    top candidate's mapped fields, or None if Google has no business there (NOT a negative signal)."""
    import requests  # local import so the keyless stub path needs no network dep
    query = f"{situs}, {(home_state() or '').strip()}".strip().rstrip(", ")
    resp = requests.post(
        TEXT_SEARCH_URL,
        headers={"X-Goog-Api-Key": _api_key(), "X-Goog-FieldMask": FIELD_MASK,
                 "Content-Type": "application/json"},
        json={"textQuery": query}, timeout=20,
    )
    resp.raise_for_status()
    places = resp.json().get("places") or []
    return places[0] if places else None


def classify(place: dict) -> dict:
    """Map one raw Places result -> record_observation kwargs + derived flags. Pure (no I/O)."""
    name = (place.get("displayName") or {}).get("text")
    types = place.get("types") or []
    primary = place.get("primaryType")
    status = place.get("businessStatus")  # OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY

    use_truth = None
    for t in ([primary] + types):
        if t in TYPE_TO_USE_TRUTH:
            use_truth = TYPE_TO_USE_TRUTH[t]
            break
    matches_landuse = None if use_truth is None else (use_truth not in EXCLUDED_USES)

    # occupancy: an operational business => occupied; closed => vacant. leased-vs-owner is unknown
    # from Places, so we DON'T assert it (leave for the human read / skip-trace).
    occupancy = {"OPERATIONAL": "leased", "CLOSED_PERMANENTLY": "vacant",
                 "CLOSED_TEMPORARILY": "unknown"}.get(status, "unknown")

    # review-text distress mining
    review_hits: list[str] = []
    for r in (place.get("reviews") or []):
        txt = ((r.get("text") or {}).get("text") or "").lower()
        for kw in DISTRESS_KEYWORDS:
            if kw in txt:
                review_hits.append(f'review: "{kw}"')
                break

    visual_distress = []
    if status == "CLOSED_PERMANENTLY":
        visual_distress.append("Google business_status = permanently closed")
    visual_distress += review_hits

    return {
        "apn_name": name,
        "kwargs": dict(
            use_truth=use_truth, matches_landuse=matches_landuse, occupancy=occupancy,
            tenant=[name] if name else [],
            visual_distress=visual_distress or None,
            note=(f"google-places: {primary or ''} · status={status} · "
                  f"rating={place.get('rating')}({place.get('userRatingCount')})"),
        ),
        "contact": {"phone": place.get("nationalPhoneNumber"),
                    "website": place.get("websiteUri")},
        "excluded_use": bool(matches_landuse is False),
    }


def run(top: int | None, apn: str | None, write: bool, force: bool) -> int:
    rows = _queue(top, apn)
    out = []
    for r in rows:
        if r["already_human"] and not force:
            out.append({"apn": r["apn"], "skipped": "already human-verified (use --force to override)"})
            continue
        place = search_place(r["situs_address"] or "")
        if place is None:
            # ABSENT DATA IS NEVER A NEGATIVE — record nothing, contribute 0.
            out.append({"apn": r["apn"], "situs": r["situs_address"], "google": "no business pin"})
            continue
        mapped = classify(place)
        rec = {"apn": r["apn"], "situs": r["situs_address"],
               "google_name": mapped["apn_name"], **mapped["kwargs"],
               "contact": mapped["contact"], "excluded_use": mapped["excluded_use"]}
        if write:
            from imagery.record_observation import record_observation
            record_observation(r["apn"], model_version="google-places", human_verified=False,
                               **{k: v for k, v in mapped["kwargs"].items() if v is not None})
            rec["written"] = True
        out.append(rec)
    print(json.dumps({"market": active_market(), "write": write, "results": out},
                     indent=2, default=str))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--top", type=int, help="process the top-N of the call queue")
    ap.add_argument("--apn", help="process a single parcel")
    ap.add_argument("--write", action="store_true", help="actually upsert (default: dry-run)")
    ap.add_argument("--force", action="store_true",
                    help="overwrite even human-verified observations (default: skip them)")
    args = ap.parse_args()

    if not _api_key():
        print("pull_places: GOOGLE_MAPS_API_KEY not set — skipping (scaffold). "
              "See docs/MAPS_PLACES_POC.md + docs/TOOLS_REGISTRY.md.")
        return 0
    if not args.top and not args.apn:
        ap.error("give --top N or --apn APN")
    return run(args.top, args.apn, args.write, args.force)


if __name__ == "__main__":
    raise SystemExit(main())
