#!/usr/bin/env python3
"""
record_observation.py — land ONE imagery pass into the pipeline, all use cases at once.

Until the ANTHROPIC_API_KEY path (imagery/vlm_score.py) is built, the VLM is a human
reading Google Maps satellite + Street View through the Claude-in-Chrome extension
(POC: BUILD_LOG §26d, memory `vacancy-via-chrome-vlm`). The vacancy POC wrote
site_observations with hand-rolled SQL and captured only the 3 vacancy fields. This
module is the reusable upgrade: one call captures EVERY signal a screenshot yields
(the full menu in docs/SCREENSHOT_USES.md) and routes each to its correct home —

  parking_fullness / signage_present / condition  -> site_observations  (#1 vacancy → vacancy_evidence)
  dock_doors_est / drive_ins_est / divisibility / truck_access -> site_observations  (#2 physical → physical_fit + truck_access)
  visual_distress (junk/dumping/scrap/overgrowth) -> distress_signals type='visual_distress'  (#4, EVIDENCE — sourced, not yet scored)
  tenant / use_truth / context / eave_height_band -> site_observations.vlm_json sub-keys  (#5 use-truth, #6 tenant, #8 context)

Aligns with the column schema in prompts/vlm_site_assessment.md; the api-VLM path can
call record_observation() with the same kwargs once it parses that prompt's JSON.

HARD RULES carried over from the brief:
  * Never guess. A field you cannot read from THE IMAGE stays None / 'not_visible'.
  * visual_distress is the leading-edge edge (distress the city hasn't cited yet), but it
    is EVIDENCE only — it lands a sourced distress_signals row that shows on the call sheet
    and dashboard; it does NOT (yet) feed the score (code_violations counts only
    type='code_violation'; adding a weight is a founder decision).

Usage (Python — used by the backfill + fresh-pass scripts):
    from imagery.record_observation import record_observation, maps_urls
    record_observation("010-217134", parking_fullness="sparse", signage_present="no",
                       condition="poor", dock_doors_est=6, truck_access="tight",
                       tenant=[], use_truth="warehouse", occupancy="vacant",
                       visual_distress=["debris pile in side yard", "boarded window"])

CLI (print the imagery URLs for a parcel, then record):
    MARKET=columbus python imagery/record_observation.py --urls 010-217134
    MARKET=columbus python imagery/record_observation.py 010-217134 \
        --parking sparse --signage no --condition poor --docks 6 --truck tight \
        --visual-distress "debris pile" --visual-distress "boarded window" \
        --use-truth warehouse --occupancy vacant --note "long-vacant; weeds in lot"
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote_plus

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import cursor  # noqa: E402
from lib.market import active_market, home_state  # noqa: E402

# Allowed enum values — mirror site_observations CHECK-able columns + scoring/rules.py so
# a typo is rejected loudly instead of silently storing an unscoreable value.
ENUMS = {
    "parking_fullness": {"empty", "sparse", "moderate", "full", "not_visible"},
    "signage_present": {"yes", "no", "not_visible"},
    "condition": {"good", "fair", "poor", "not_visible"},
    "divisibility": {"single_box", "some_separation", "multi_entry", "not_visible"},
    "truck_access": {"easy", "tight", "bad", "not_visible"},
    "eave_height_band": {"under_16ft_likely", "16ft_plus_likely", "not_visible"},
    # not a scored column, but constrained so use-truth stays comparable across parcels
    "use_truth": {"warehouse", "truck_terminal", "flex", "manufacturing", "self_storage",
                  "retail", "office", "church", "entertainment", "conversion",
                  "vehicle_or_salvage_yard", "other", "not_visible"},
    "occupancy": {"owner_occupied", "leased", "vacant", "unknown"},
    "tenancy": {"single", "multi", "unknown"},
}

DEFAULT_MODEL = "human-chrome-vlm"


def _check(name: str, value):
    if value is None:
        return None
    if name in ENUMS and value not in ENUMS[name]:
        raise ValueError(f"{name}={value!r} not in {sorted(ENUMS[name])}")
    return value


def latlon(apn: str) -> tuple[float, float] | None:
    """Interior point (point-on-surface) lat/lon for the parcel, or None if no geom."""
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lon "
            "FROM parcels WHERE apn = %s", (apn,))
        row = cur.fetchone()
    if not row or row["lat"] is None:
        return None
    return float(row["lat"]), float(row["lon"])


def _situs_address(apn: str) -> str | None:
    """Street situs address for the parcel, used to geocode a road-frontage Street View."""
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT situs_address FROM parcels WHERE apn = %s", (apn,))
        row = cur.fetchone()
    addr = (row or {}).get("situs_address")
    return addr.strip() if addr else None


def maps_urls(apn: str) -> dict[str, str]:
    """Imagery URLs to open in the Chrome extension for a manual pass.

    - satellite / street_view: centroid (point-on-surface) views.
    - place: the situs-address geocoded Maps place page. PREFER THIS for the manual
      pass — its Street View thumbnail snaps to the ROAD FRONTAGE (the centroid
      street_view returns "No Street View imagery available here" for interior-point
      industrial parcels — empirically ~2/5 of the Columbus top queue), and it surfaces
      the Google business label, a strong occupancy / use-truth tell.
    """
    urls: dict[str, str] = {}
    ll = latlon(apn)
    if ll is not None:
        lat, lon = ll
        urls["satellite"] = f"https://www.google.com/maps/@{lat},{lon},19z/data=!3m1!1e3"
        # cbll form (verified to load a pano); the older map_action=pano&viewpoint form
        # is less reliable for arbitrary points.
        urls["street_view"] = f"https://www.google.com/maps?q=&layer=c&cbll={lat},{lon}"
    addr = _situs_address(apn)
    if addr:
        q = quote_plus(f"{addr}, {(home_state() or '').strip()}".strip().rstrip(", "))
        urls["place"] = f"https://www.google.com/maps/place/{q}"
    return urls


def record_observation(
    apn: str,
    *,
    # --- #1 vacancy ---
    parking_fullness: str | None = None,
    signage_present: str | None = None,
    # --- #3 condition ---
    condition: str | None = None,
    # --- #2 physical ---
    dock_doors_est: int | None = None,
    drive_ins_est: int | None = None,
    divisibility: str | None = None,
    truck_access: str | None = None,
    eave_height_band: str | None = None,
    # --- #5 use-truth / #6 tenant / #8 context (-> vlm_json) ---
    use_truth: str | None = None,
    matches_landuse: bool | None = None,
    tenant: list[str] | None = None,
    tenancy: str | None = None,
    occupancy: str | None = None,
    context: str | None = None,
    # --- #4 visual distress (-> distress_signals) ---
    visual_distress: list[str] | None = None,
    # --- bookkeeping ---
    note: str | None = None,
    image_paths: list[str] | None = None,
    captured_at: date | None = None,
    model_version: str = DEFAULT_MODEL,
    human_verified: bool = True,
) -> dict:
    """Upsert one site_observations row + (optionally) one sourced visual_distress
    distress_signals row, in the active market's schema (MARKET env var). Returns a
    summary dict. Idempotent — re-running for the same APN updates in place."""
    for n, v in (("parking_fullness", parking_fullness), ("signage_present", signage_present),
                 ("condition", condition), ("divisibility", divisibility),
                 ("truck_access", truck_access), ("eave_height_band", eave_height_band),
                 ("use_truth", use_truth), ("occupancy", occupancy), ("tenancy", tenancy)):
        _check(n, v)

    # Everything without a dedicated column lives in vlm_json (raw model output home).
    vlm: dict = {}
    if note:
        vlm["note"] = note
    if eave_height_band:
        vlm["eave_height_band"] = eave_height_band
    if use_truth or matches_landuse is not None:
        vlm["use_truth"] = {"actual_use": use_truth, "matches_landuse": matches_landuse}
    if tenant is not None or tenancy or occupancy:
        vlm["tenant"] = {"operating_business": tenant or [],
                         "tenancy": tenancy, "occupancy": occupancy}
    if context:
        vlm["context"] = context
    if visual_distress:
        vlm["visual_distress"] = visual_distress

    paths = image_paths or ["google_maps_satellite"]
    cap = captured_at or date.today()

    with cursor() as cur:
        cur.execute(
            """
            INSERT INTO site_observations
              (apn, image_paths, captured_at, vlm_json, dock_doors_est, drive_ins_est,
               parking_fullness, signage_present, condition, divisibility, truck_access,
               model_version, human_verified)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (apn) DO UPDATE SET
               image_paths=EXCLUDED.image_paths, captured_at=EXCLUDED.captured_at,
               vlm_json=EXCLUDED.vlm_json, dock_doors_est=EXCLUDED.dock_doors_est,
               drive_ins_est=EXCLUDED.drive_ins_est, parking_fullness=EXCLUDED.parking_fullness,
               signage_present=EXCLUDED.signage_present, condition=EXCLUDED.condition,
               divisibility=EXCLUDED.divisibility, truck_access=EXCLUDED.truck_access,
               model_version=EXCLUDED.model_version, human_verified=EXCLUDED.human_verified
            """,
            (apn, paths, cap, psycopg2.extras.Json(vlm), dock_doors_est, drive_ins_est,
             parking_fullness, signage_present, condition, divisibility, truck_access,
             model_version, human_verified),
        )

        signal_landed = False
        if visual_distress:
            urls = maps_urls(apn)
            src = urls.get("satellite", f"google_maps_satellite:{apn}")
            cur.execute(
                """
                INSERT INTO distress_signals (apn, type, detail, event_date, source_ref, verified)
                VALUES (%s, 'visual_distress', %s, %s, %s, %s)
                ON CONFLICT (apn, type, source_ref) DO UPDATE SET
                  detail=EXCLUDED.detail, event_date=EXCLUDED.event_date, verified=EXCLUDED.verified
                """,
                (apn, "; ".join(visual_distress), cap, src, human_verified),
            )
            signal_landed = True

    return {"apn": apn, "market": active_market(), "vlm_json": vlm,
            "visual_distress_signal": signal_landed}


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("apn", nargs="?", help="parcel APN (omit with --urls only to list URLs)")
    ap.add_argument("--urls", metavar="APN", help="just print the satellite + Street View URLs and exit")
    ap.add_argument("--parking", dest="parking_fullness")
    ap.add_argument("--signage", dest="signage_present")
    ap.add_argument("--condition")
    ap.add_argument("--docks", dest="dock_doors_est", type=int)
    ap.add_argument("--drive-ins", dest="drive_ins_est", type=int)
    ap.add_argument("--divisibility")
    ap.add_argument("--truck", dest="truck_access")
    ap.add_argument("--eave", dest="eave_height_band")
    ap.add_argument("--use-truth", dest="use_truth")
    ap.add_argument("--matches-landuse", dest="matches_landuse",
                    type=lambda s: s.lower() in ("1", "true", "yes", "y"))
    ap.add_argument("--tenant", action="append", help="operating business name (repeatable)")
    ap.add_argument("--tenancy")
    ap.add_argument("--occupancy")
    ap.add_argument("--context")
    ap.add_argument("--visual-distress", dest="visual_distress", action="append",
                    help="one visible distress observation (repeatable)")
    ap.add_argument("--note")
    args = ap.parse_args()

    if args.urls:
        urls = maps_urls(args.urls)
        if not urls:
            print(f"no geometry for {args.urls}", file=sys.stderr)
            return 1
        print(f"# {args.urls} ({active_market()})")
        for k, v in urls.items():
            print(f"{k:>11}: {v}")
        return 0

    if not args.apn:
        ap.error("APN required (or use --urls APN)")

    kw = {k: v for k, v in vars(args).items()
          if k not in ("apn", "urls") and v is not None}
    res = record_observation(args.apn, **kw)
    print(json.dumps(res, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
