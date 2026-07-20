"""Stage 1 FIND markets (Orlando, Raleigh) → sourcing-console off-market rows.

Reads the kept-lists produced by the Off-Market OS Stage 1 scrapers
(../off-market-operating-system/runs/*/stage1_find*.csv — also live on Railway,
see off-market-operating-system/service/DEPLOY-NOTES.md) and emits rows in the
same shape as build_real_data.load_offmarket().

These rows carry an honest PARTIAL score: only the components Stage 1 data can
earn — hold_period, owner_profile, year_built_band (same thresholds as
offmarket-scraping/weights.yaml) — so the console's per-market reachable
ceiling (cityCeil) correctly shows e.g. "12 / 20 reachable" instead of
pretending a full-pipeline score exists.

Geocoding (cached in tools/.stage1_geocache.json, gitignored):
  - Raleigh : Wake County Parcels FeatureServer, polygon centroid per PIN
  - Orlando : US Census batch geocoder on the situs address (free, no key)
Rows that fail to geocode are dropped from the console (it's a map-first UI)
and counted on stdout — the CSVs remain the source of truth.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import urllib.request
import urllib.parse

RUNS_GLOB = "off-market-operating-system/runs"
CACHE = Path(__file__).resolve().parent / ".stage1_geocache.json"

WAKE_QUERY = ("https://maps.wakegov.com/arcgis/rest/services/Property/Parcels/"
              "FeatureServer/0/query")
CENSUS_BATCH = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"

MARKET_OF_DIR = {"orlando": ("Orlando", "FL"), "raleigh": ("Raleigh", "NC")}

# weights.yaml thresholds (offmarket-scraping) — keep in sync.
HOLD_PTS = ((20, 8), (10, 5))
OWNER_TRUST_OR_INDIVIDUAL, OWNER_OOS, OWNER_ESTATE, OWNER_CAP = 3, 2, 2, 7
YEAR_BAND_PTS = ((1955, 1985, 5), (1986, 2000, 3))

ESTATE_PAT = re.compile(r"\b(ESTATE|HEIR|HEIRS|DECEASED)\b")
SF_PAT = re.compile(r"([\d,]+)\s*SF")
STATE_ZIP_PAT = re.compile(r"\b([A-Z]{2})\b[ ,]+\d{5}(-\d{4})?\s*$")

CLASS_DISPLAY = {"LLC": "LLC", "trust": "Trust", "partnership": "Partnership",
                 "individual": "Individual", "corp (private? needs SOS)": "Corp",
                 "government": "Gov", "unclassified": "—"}


def _latest_csvs(workspace: Path) -> dict[str, Path]:
    """Latest stage1_find CSV per market, keyed by market display name."""
    out: dict[str, tuple[str, Path]] = {}
    for p in sorted((workspace / RUNS_GLOB).glob("*/stage1_find*.csv")):
        run_dir = p.parent.name          # e.g. raleigh-wake-nc-2026-07-20
        for prefix, (mkt, _) in MARKET_OF_DIR.items():
            if run_dir.startswith(prefix) and (mkt not in out or run_dir > out[mkt][0]):
                out[mkt] = (run_dir, p)
    return {mkt: path for mkt, (_, path) in out.items()}


def _load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    return {}


def _geocode_raleigh(pins: list[str], cache: dict) -> None:
    """Wake FeatureServer polygon centroids for the given PINs (POST, chunked)."""
    todo = [p for p in pins if f"Raleigh:{p}" not in cache]
    for i in range(0, len(todo), 50):
        chunk = todo[i:i + 50]
        where = "PIN_NUM IN ({})".format(",".join(f"'{p}'" for p in chunk))
        body = urllib.parse.urlencode({
            "where": where, "outFields": "PIN_NUM", "returnGeometry": "true",
            "outSR": "4326", "f": "json"}).encode()
        with urllib.request.urlopen(urllib.request.Request(WAKE_QUERY, data=body),
                                    timeout=120) as resp:
            data = json.loads(resp.read())
        for feat in data.get("features", []):
            pin = str(feat["attributes"]["PIN_NUM"]).strip()
            rings = (feat.get("geometry") or {}).get("rings") or []
            if rings:
                xs = [pt[0] for pt in rings[0]]
                ys = [pt[1] for pt in rings[0]]
                cache[f"Raleigh:{pin}"] = [round(sum(ys) / len(ys), 6),
                                           round(sum(xs) / len(xs), 6)]


def _geocode_orlando(rows: list[dict], cache: dict) -> None:
    """US Census batch geocoder on situs addresses (id = parcel_id)."""
    todo = []
    for r in rows:
        if f"Orlando:{r['parcel_id']}" in cache:
            continue
        parts = [p.strip() for p in r["address"].split(",")]
        street = parts[0] if parts else ""
        city = parts[1] if len(parts) > 1 else "ORLANDO"
        if street:
            todo.append((r["parcel_id"], street, city))
    if not todo:
        return
    buf = io.StringIO()
    w = csv.writer(buf)
    for pid, street, city in todo:
        w.writerow([pid, street, city, "FL", ""])
    boundary = "----stage1geocode"
    payload = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"benchmark\"\r\n\r\n"
        f"Public_AR_Current\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"addressFile\"; "
        f"filename=\"a.csv\"\r\nContent-Type: text/csv\r\n\r\n{buf.getvalue()}\r\n"
        f"--{boundary}--\r\n").encode()
    req = urllib.request.Request(CENSUS_BATCH, data=payload, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        text = resp.read().decode("utf-8", "replace")
    for rec in csv.reader(io.StringIO(text)):
        # id, input, Match/No_Match/Tie, Exact/Non_Exact, matched addr, "lon,lat", ...
        if len(rec) >= 6 and rec[2] == "Match" and rec[5]:
            lon, lat = rec[5].split(",")
            cache[f"Orlando:{rec[0]}"] = [round(float(lat), 6), round(float(lon), 6)]


def _score(row: dict, hold: float | None, year: int | None,
           oos_st: str | None, estate: bool) -> tuple[int, dict]:
    comp = {}
    if hold is not None:
        for cut, pts in HOLD_PTS:
            if hold >= cut:
                comp["hold_period"] = pts
                break
    own_pts = 0
    if row["classification"] in ("trust", "individual"):
        own_pts += OWNER_TRUST_OR_INDIVIDUAL
    if oos_st:
        own_pts += OWNER_OOS
    if estate:
        own_pts += OWNER_ESTATE
    if own_pts:
        comp["owner_profile"] = min(own_pts, OWNER_CAP)
    if year:
        for lo, hi, pts in YEAR_BAND_PTS:
            if lo <= year <= hi:
                comp["year_built_band"] = pts
                break
        else:
            comp["year_built_band"] = 1
    return sum(comp.values()), comp


def load_stage1(workspace: Path, cat, title) -> list[dict]:
    """cat/title = build_real_data.offmarket_cat / smart_title (avoids a cycle)."""
    csvs = _latest_csvs(workspace)
    if not csvs:
        print("  ! no Stage 1 FIND runs found", flush=True)
        return []
    cache = _load_cache()
    by_mkt = {m: list(csv.DictReader(open(p))) for m, p in csvs.items()}

    if "Raleigh" in by_mkt:
        _geocode_raleigh([r["parcel_id"] for r in by_mkt["Raleigh"]], cache)
    if "Orlando" in by_mkt:
        _geocode_orlando(by_mkt["Orlando"], cache)
    CACHE.write_text(json.dumps(cache))

    now_year = datetime.now(timezone.utc).year
    out, dropped = [], {"Orlando": 0, "Raleigh": 0}
    for mkt, rows in by_mkt.items():
        st = dict(MARKET_OF_DIR.values())[mkt]
        for r in rows:
            ll = cache.get(f"{mkt}:{r['parcel_id']}")
            if not ll:
                dropped[mkt] += 1
                continue
            m = SF_PAT.search(r["asset_match"])
            sf = int(m.group(1).replace(",", "")) if m else 0
            year = int(r["year_built_or_size"]) if r["year_built_or_size"].strip().isdigit() else None
            sale_yr = r["sale_yr_last"].strip().rstrip(".0") or ""
            hold = (now_year - int(sale_yr)) if sale_yr.isdigit() and int(sale_yr) > 1900 else None
            oos_st = None
            if r["out_of_state"] == "True":
                sm = STATE_ZIP_PAT.search(r["owner_mailing_address"].upper())
                oos_st = sm.group(1) if sm else "OOS"
            estate = bool(ESTATE_PAT.search(r["owner_of_record"].upper()))
            score, comp = _score(r, hold, year, oos_st, estate)
            if estate:
                signal = "Estate/heir owner"
            elif hold and hold >= 20:
                signal = f"Held {int(hold)}y"
            elif oos_st:
                signal = "Out-of-state owner"
            elif year and 1960 <= year <= 1979:
                signal = "1960s-70s vintage"
            else:
                signal = "Stage 1 keep"
            land = r["land_sqft"].strip()
            out.append({
                "id": f"off-{r['parcel_id']}",
                "channel": "off",
                "addr": title(r["address"].split(",")[0]),
                "mkt": mkt, "st": st,
                "sf": sf, "sfTotal": sf, "sfLargest": sf,
                "cat": cat(score), "score": score,
                "signal": signal,
                "owner": title(r["owner_of_record"]) or "—",
                "ownerType": CLASS_DISPLAY.get(r["classification"], "—"),
                "oos": oos_st,
                "clear": None, "clearSrc": "",
                "year": year,
                "contact": "No contact",
                "mail": title(r["owner_mailing_address"]) or "—",
                "lat": ll[0], "lng": ll[1],
                "apn": r["parcel_id"],
                "comp": comp,
                "phones": [], "emails": [], "person": "", "personRole": "",
                "contactConf": "",
                "sigs": [],
                "nViol": 0, "nPermit": 0,
                "lastSale": sale_yr or None,
                "lastPrice": int(float(r["sale_prc_last"])) if r["sale_prc_last"].strip() else 0,
                "parcelsInSale": 1, "sfCheck": "",
                "assessed": int(float(r["just_value"])) if r["just_value"].strip() else 0,
                "holdYears": float(hold) if hold is not None else None,
                "distMi": None,
                "buildings": None,
                "landUse": r["asset_match"].split(",")[0],
                "bucket": None,
                "gate": "",
                "obs": None,
                "stage1Flag": r["flag"] or "",
            })
    for mkt, n in dropped.items():
        if n:
            print(f"  ! {mkt}: {n} rows not geocoded — dropped from console "
                  f"(still in the Stage 1 CSV)")
    return out
