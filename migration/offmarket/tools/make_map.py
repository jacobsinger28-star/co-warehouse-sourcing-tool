#!/usr/bin/env python3
"""
make_map.py — plot the ranked universe on an interactive map into
exports/map.html (companion to make_dashboard.py, 2026-06-17).

Same idea as the dashboard: ONE self-contained static file, every built market in
it (City column -> City filter), data inlined as JSON, no server. The only new
ingredient is a parcel centroid (lat/lon) per row, computed from PostGIS
parcels.geom (SRID 4326) — so a map needs the DB up, exactly like the dashboard.

Markers are coloured by fit-score tier and clustered (Leaflet.markercluster) so
1.5k points stay legible; click a marker for the FULL property detail — the same
facts the dashboard's expanded row shows (owner/mailing, land use, buildings, clear
height, assessed value, last sale, distress evidence and the score breakdown). The
default basemap is satellite imagery (Esri World Imagery, with a street toggle).
Leaflet + the tile layers load from a CDN, so the map (unlike the table) needs
network access to render the basemap.

    python tools/make_map.py [--out exports/map.html]
    python tools/make_map.py --from-json exports/map_data.json   # rebuild w/o DB
    python tools/make_map.py --dump-json  exports/map_data.json   # save a DB-free snapshot

exports/ is gitignored — owner names + addresses stay on this machine. Internal,
do-not-publish, same as the dashboard.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.ranking import (  # noqa: E402  (pure — per-market ceiling + rank, shared with make_dashboard)
    comp_max, fit_sort_key, live_components, market_ceiling)

# Same field set as make_dashboard.ROWS_SQL (so the popup can mirror the table's row
# detail) plus a centroid. ST_PointOnSurface keeps the marker inside oddly-shaped /
# multipart parcels (a true centroid can land in a gap). Pulled per-market with the
# market's schema on the search_path, mirroring make_dashboard.collect().
ROWS_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (apn) apn, total, components
  FROM scores WHERE version LIKE %(ver)s ORDER BY apn, scored_at DESC
),
owner AS (
  SELECT DISTINCT ON (o.apn) o.apn, e.entity_type, e.is_out_of_state,
         e.name_raw, e.mailing_address, o.entity_id
  FROM ownerships o JOIN entities e USING (entity_id) ORDER BY o.apn, e.entity_id
),
-- Best contact per entity: mirrors make_dashboard.ROWS_SQL so the popup shows the same
-- person + phone/email as the table cell. entity_id is unique only within a market, so
-- this relies on the per-schema search_path that collect() sets (same as the dashboard).
contact AS (
  SELECT DISTINCT ON (entity_id) entity_id, person_name, role, phones, emails, confidence
  FROM contacts
  ORDER BY entity_id,
           CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
           coalesce(array_length(phones, 1), 0) DESC,
           coalesce(array_length(emails, 1), 0) DESC
)
SELECT p.apn, p.situs_address, p.in_universe, p.manual_review, p.gate_reason,
       p.land_use_desc,
       round(ST_Y(ST_PointOnSurface(p.geom))::numeric, 6) AS lat,
       round(ST_X(ST_PointOnSurface(p.geom))::numeric, 6) AS lon,
       pr.building_sf, pr.building_sf_largest, pr.building_count, pr.year_built,
       pr.clear_height_est, pr.clear_height_source,
       pr.distance_miles_icbd, pr.hold_years, pr.assessed_value,
       pr.last_sale_date, pr.last_sale_price, pr.sf_confidence,
       ow.entity_type, ow.is_out_of_state, ow.name_raw, ow.mailing_address,
       c.person_name AS contact_person, c.role AS contact_role,
       c.phones AS contact_phones, c.emails AS contact_emails,
       c.confidence AS contact_confidence,
       l.total, l.components
FROM parcels p
JOIN properties pr USING (apn)
LEFT JOIN owner ow ON ow.apn = p.apn
LEFT JOIN contact c ON c.entity_id = ow.entity_id
LEFT JOIN latest l ON l.apn = p.apn
WHERE (p.in_universe OR p.manual_review) AND p.geom IS NOT NULL
"""

SIGNALS_SQL = """
SELECT apn, type, detail, event_date
FROM distress_signals
ORDER BY apn, event_date DESC NULLS LAST
"""

# Imagery/VLM pass per parcel — mirrors make_dashboard.OBS_SQL so the popup shows the
# same "Site assessment" block as the dashboard row + call sheet (parity rule).
OBS_SQL = """
SELECT so.apn, so.parking_fullness, so.signage_present, so.condition, so.divisibility,
       so.truck_access, so.dock_doors_est, so.drive_ins_est,
       so.vlm_json, so.captured_at, so.model_version,
       ST_Y(ST_PointOnSurface(p.geom)) AS lat, ST_X(ST_PointOnSurface(p.geom)) AS lon
FROM site_observations so JOIN parcels p USING (apn)
"""


def _js(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    raise TypeError(type(o))


def _comp_max() -> dict:
    """Per-component point ceiling (delegates to tools.ranking so dashboard + map share it)."""
    return comp_max()


def _label(name: str) -> str:
    return name[:1].upper() + name[1:]


def _place(name: str) -> str:
    from lib.market import home_state
    st = home_state(name)
    return f"{_label(name)}, {st}" if st else _label(name)


def _obs_dict(o: dict) -> dict:
    """One site_observations row -> compact imagery-assessment dict. Mirrors
    make_dashboard._obs_dict + outreach/call_sheets.py:site_assessment_lines (parity)."""
    vlm = o["vlm_json"] or {}
    use = vlm.get("use_truth") or {}
    ten = vlm.get("tenant") or {}
    lat, lon = o.get("lat"), o.get("lon")
    src = (f"https://www.google.com/maps/@{lat},{lon},19z/data=!3m1!1e3"
           if lat is not None else None)
    return {
        "park": o["parking_fullness"], "sign": o["signage_present"], "cond": o["condition"],
        "div": o["divisibility"], "truck": o["truck_access"],
        "docks": o["dock_doors_est"], "drive": o["drive_ins_est"],
        "use": use.get("actual_use"), "match": use.get("matches_landuse"),
        "ten": ten.get("operating_business") or [],
        "tency": ten.get("tenancy"), "occ": ten.get("occupancy"),
        "ctx": vlm.get("context"), "note": vlm.get("note"),
        "src": src, "cap": o["captured_at"].isoformat() if o["captured_at"] else None,
        "ver": o["model_version"],
    }


def _shape_rows(rows: list, sig_rows: list, obs_rows: list, label: str, place: str) -> list:
    signals: dict[str, list] = {}
    for s in sig_rows:
        signals.setdefault(s["apn"], []).append(
            {"type": s["type"], "detail": (s["detail"] or "")[:220],
             "date": s["event_date"].isoformat() if s["event_date"] else None})
    obs = {o["apn"]: _obs_dict(o) for o in obs_rows}

    # Bulk/portfolio-sale detector: county CAMA stamps the WHOLE deal's consideration on
    # every parcel in a multi-parcel sale (e.g. a $739.5M total on 8 Columbus parcels), so a
    # per-SF price off that figure is nonsense. Parcels sharing the exact same sale date AND
    # price are one deal — count them so the popup can flag it and hide the bogus $/SF.
    from collections import Counter
    deal = Counter((r["last_sale_date"], float(r["last_sale_price"] or 0))
                   for r in rows if (r["last_sale_price"] or 0) > 0)

    out = []
    for r in rows:
        if r["lat"] is None or r["lon"] is None:
            continue
        comp = (r["components"] or {}).get("components", {})
        sig = signals.get(r["apn"], [])
        out.append({
            "city": label,
            "place": place,
            "apn": r["apn"],
            "addr": r["situs_address"] or "(no address)",
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
            "universe": bool(r["in_universe"]),
            "bucket": "universe" if r["in_universe"] else "manual review",
            "gate": r["gate_reason"],
            "lu": r["land_use_desc"],
            "score": float(r["total"]) if r["total"] is not None else None,
            "comp": {k: float(v) for k, v in comp.items()},
            "sf": float(r["building_sf"] or 0),
            "sfL": float(r["building_sf_largest"] or 0),
            "nb": r["building_count"],
            "yr": r["year_built"],
            "ch": float(r["clear_height_est"]) if r["clear_height_est"] is not None else None,
            "chs": r["clear_height_source"],
            "mi": float(r["distance_miles_icbd"] or 0),
            "hold": float(r["hold_years"] or 0),
            "av": float(r["assessed_value"] or 0),
            "sale": r["last_sale_date"].isoformat() if r["last_sale_date"] else None,
            "price": float(r["last_sale_price"] or 0),
            "pn": deal.get((r["last_sale_date"], float(r["last_sale_price"] or 0)), 1),
            "sfc": r["sf_confidence"],
            "ot": r["entity_type"] or "?",
            "oos": bool(r["is_out_of_state"]),
            "own": r["name_raw"] or "?",
            "mail": r["mailing_address"] or "",
            # Owner contact (from public-records research, loaded into `contacts`) — mirrors
            # the dashboard so the popup shows the same person + phone/email as the table.
            "person": r.get("contact_person") or "",
            "prole": r.get("contact_role") or "",
            "phones": list(r.get("contact_phones") or []),
            "emails": list(r.get("contact_emails") or []),
            "cc": r.get("contact_confidence") or "",
            "nv": sum(1 for x in sig if x["type"] == "code_violation"),
            "np": sum(1 for x in sig if x["type"] == "permit_anomaly"),
            "sig": sig,
            "obs": obs.get(r["apn"]),
        })
    return out


def collect(markets: list | None = None) -> dict:
    """Every built market's mappable rows in one dataset, each tagged with its city
    — mirrors make_dashboard.collect() (skips unbuilt/half-migrated markets) so each
    parcel can be plotted."""
    from lib.db import cursor
    from lib.market import db_schema, MARKETS_DIR
    if not markets:
        markets = sorted(p.stem for p in MARKETS_DIR.glob("*.yaml"))

    all_rows: list = []
    per_market: list = []
    cmax = comp_max()
    city_ceil: dict = {}
    city_live: dict = {}
    for name in markets:
        schema = db_schema(name)
        try:
            with cursor(dict_rows=True, commit=False) as cur:
                cur.execute("SELECT to_regclass(%s) AS reg", (f"{schema}.parcels",))
                if cur.fetchone()["reg"] is None:
                    continue
                cur.execute(f'SET search_path TO "{schema}", public')
                cur.execute(ROWS_SQL, {"ver": "%-final"})
                rows = [dict(r) for r in cur.fetchall()]
                if not rows:
                    continue
                cur.execute(SIGNALS_SQL)
                sig_rows = cur.fetchall()
                cur.execute(OBS_SQL)
                obs_rows = cur.fetchall()
        except Exception as e:
            print(f"  ! skipped market '{name}': {e}", file=sys.stderr)
            continue
        shaped = _shape_rows(rows, sig_rows, obs_rows, _label(name), _place(name))
        if not shaped:
            continue
        # A1: judge each market against ONLY the points its own feeds can earn.
        ceil = market_ceiling(shaped, cmax)
        for x in shaped:
            x["ceil"] = ceil
        all_rows.extend(shaped)
        per_market.append({
            "city": _label(name),
            "n": len(shaped),
            "ceil": ceil,
        })
        city_ceil[_label(name)] = ceil
        city_live[_label(name)] = live_components(shaped, cmax)

    # Rank by the blended fit-and-evidence metric (tools.ranking fit_sort_key =
    # score/sqrt(ceiling)), not raw score, so feed-poor markets compete fairly (HEALTH_AUDIT §A1).
    all_rows.sort(key=fit_sort_key)
    return {"generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "n": len(all_rows),
            "markets": per_market,
            "comp_max": cmax,
            "city_ceil": city_ceil,
            "city_live": city_live,
            "rows": all_rows}


TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Off-market industrial — map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>
<style>
:root{--ink:#1a1a18;--mut:#6b6a64;--line:#e4e2da;--bg:#faf9f5;--card:#fff;
--teal:#0f6e56;--tealbg:#e1f5ee;--amber:#854f0b;--amberbg:#faeeda;--red:#a32d2d;--redbg:#fcebeb}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font:14px/1.5 -apple-system,'Segoe UI',sans-serif;color:var(--ink);background:var(--bg)}
#map{position:absolute;inset:0}
.panel{position:absolute;z-index:1000;top:12px;left:12px;background:var(--card);border:1px solid var(--line);
border-radius:12px;padding:13px 15px;box-shadow:0 2px 14px rgba(0,0,0,.09);width:308px;
max-height:calc(100vh - 24px);overflow-y:auto}
.panel h1{font-size:15px;font-weight:600;margin:0 0 2px}
.panel .sub{color:var(--mut);font-size:11.5px;margin-bottom:10px}
.tablebtn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--line);
border-radius:8px;background:var(--card);color:var(--teal);font-size:12.5px;font-weight:600;
text-decoration:none;margin-bottom:11px}
.tablebtn:hover{background:#f1f7f4;border-color:#bfe0d4}
.warn{display:inline-block;background:#faeeda;color:var(--amber);border-radius:6px;padding:1px 7px;font-size:10.5px;margin-left:4px}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:4px}
.filters .wide{grid-column:1 / -1}
select,input[type=search]{padding:6px 9px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;background:var(--card);width:100%;min-width:0}
label.cb{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:6px;grid-column:1 / -1}
.reset{grid-column:1 / -1;justify-self:start;padding:4px 10px;border:1px solid var(--line);border-radius:7px;
background:var(--card);color:var(--mut);font-size:11.5px;cursor:pointer}
.reset:hover{color:var(--ink);border-color:#cfccc2}
.legend{margin-top:10px;border-top:1px solid var(--line);padding-top:9px;font-size:12px;color:var(--mut)}
.legend .lr{display:flex;align-items:center;gap:7px;margin-bottom:4px}
.dot{width:13px;height:13px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.18);flex:none}
.cnt{font-size:12px;color:var(--ink);margin-top:8px}.cnt b{font-weight:600}
.covnote{font-size:10.5px;color:var(--mut);margin-top:8px;line-height:1.5;border-top:1px solid var(--line);padding-top:8px}
/* --- popup: mirrors the dashboard's expanded-row detail --- */
.leaflet-popup-content{margin:12px 14px 13px;width:332px!important}
.lp{font:13px/1.45 -apple-system,'Segoe UI',sans-serif;max-height:min(64vh,440px);overflow-y:auto}
.lp a.a{display:block;font-weight:600;font-size:14px;margin-bottom:1px;color:var(--teal);text-decoration:none}
.lp a.a:hover{text-decoration:underline}
.lp .apn{font-size:11px;color:var(--mut);margin-bottom:8px}
.lp .chips{margin:0 0 8px}
.lp .chip{display:inline-block;border-radius:8px;padding:0 7px;font-size:10.5px;margin:0 4px 4px 0}
.lp .chip.hot{background:var(--tealbg);color:var(--teal)}
.lp .chip.v{background:var(--redbg);color:var(--red)}.lp .chip.p{background:#f0efe9;color:#8a887f}
.lp .chip.o{background:#efeee8;color:var(--mut)}.lp .chip.mr{background:var(--amberbg);color:var(--amber)}
.lp .chip.bad{background:var(--redbg);color:var(--red)}
.lp .sc{display:inline-block;font-weight:700;border-radius:6px;padding:1px 8px;font-size:12px;margin-bottom:9px}
.lp .sc.hi{background:var(--tealbg);color:var(--teal)}.lp .sc.mid{background:var(--amberbg);color:var(--amber)}
.lp .sc.lo{background:#edebe4;color:#6b6a64}.lp .sc.na{background:#f0efe9;color:var(--mut);font-weight:500}
.lp .facts{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0 0 10px;align-items:baseline}
.lp .facts dt{color:var(--mut);font-size:10px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
.lp .facts dd{margin:0;color:var(--ink);font-size:12px}
.lp .muted{color:var(--mut)}
.lp .bkhd{font-size:11px;color:var(--mut);margin:8px 0 6px}.lp .bkhd b{color:var(--ink);font-weight:700}
.lp .cbreak{display:grid;grid-template-columns:96px 1fr 40px;gap:4px 8px;align-items:center;margin:0 0 7px}
.lp .cbreak .lab{font-size:11px;color:var(--ink)}
.lp .cbreak .track{height:7px;border-radius:4px;background:#ece9e1;overflow:hidden}
.lp .cbreak .fill{display:block;height:100%;border-radius:4px;background:#1d9e75}
.lp .cbreak .fill.z{width:0}
.lp .cbreak .val{font-size:11px;color:var(--mut);text-align:right;font-variant-numeric:tabular-nums}
.lp .cbreak .val b{color:var(--ink);font-weight:600}
.lp .pendrow{font-size:10.5px;color:#9a988f;margin:-1px 0 9px;line-height:1.5}.lp .pendrow b{color:#6b6a64}
.lp .evhd{font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--mut);margin:8px 0 6px}
.lp .evlist{display:flex;flex-direction:column;gap:6px;margin:0 0 10px}
.lp .evrow{display:flex;gap:8px;align-items:flex-start}
.lp .evrow .tag{flex:none;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;border-radius:5px;margin-top:1px;min-width:54px;text-align:center}
.lp .evrow .tag.vv{background:var(--redbg);color:var(--red)}.lp .evrow .tag.pp{background:#f0efe9;color:#8a887f}
.lp .evrow .ev{font-size:11.5px;color:var(--ink);line-height:1.45}
.lp .evrow .ev .when{color:var(--mut);font-variant-numeric:tabular-nums;margin-right:5px}
.lp a.mapl{display:inline-block;color:var(--teal);font-weight:600;text-decoration:none;font-size:12px;margin-top:2px}
.lp a.mapl:hover{text-decoration:underline}
</style></head><body>
<div id="map"></div>
<div class="panel">
  <h1>Off-market industrial <span class="warn">internal</span></h1>
  <div class="sub" id="sub">Generated __GEN__ · ranked universe</div>
  <a class="tablebtn" href="dashboard.html" target="_top" title="Back to the sortable table view">☰ Table view</a>
  <div class="filters">
    <input type="search" id="q" class="wide" placeholder="Search address / owner / APN">
    <select id="city"><option value="">All cities</option></select>
    <select id="otype"><option value="">All owner types</option></select>
    <select id="ownerloc"><option value="">Any owner location</option>
      <option value="in">In-state owner</option><option value="out">Out-of-state owner</option></select>
    <select id="minscore"><option value="">Any score</option><option value="mid">Moderate +</option>
      <option value="hi">Strong only</option></select>
    <select id="minsf"><option value="0">Any size</option><option value="60000">≥ 60k SF</option>
      <option value="75000">≥ 75k SF</option><option value="100000">≥ 100k SF</option>
      <option value="125000">≥ 125k SF</option><option value="150000">≥ 150k SF</option>
      <option value="200000">≥ 200k SF</option><option value="250000">≥ 250k SF</option>
      <option value="300000">≥ 300k SF</option><option value="500000">≥ 500k SF</option>
      <option value="1000000">≥ 1M SF</option></select>
    <select id="maxsf"><option value="0">No max SF</option><option value="100000">≤ 100k SF</option>
      <option value="150000">≤ 150k SF</option><option value="200000">≤ 200k SF</option>
      <option value="300000">≤ 300k SF</option><option value="500000">≤ 500k SF</option></select>
    <select id="maxch" autocomplete="off"><option value="0">Any clear height</option><option value="16">≤ 16 ft clear</option>
      <option value="20">≤ 20 ft clear</option><option value="24">≤ 24 ft clear</option>
      <option value="28">≤ 28 ft clear</option><option value="32">≤ 32 ft clear</option></select>
    <select id="maxmi"><option value="0">Any distance</option><option value="5">≤ 5 mi to core</option>
      <option value="10">≤ 10 mi</option><option value="15">≤ 15 mi</option></select>
    <select id="minhold"><option value="0">Any hold</option><option value="5">held ≥ 5 yr</option>
      <option value="10">held ≥ 10 yr</option><option value="20">held ≥ 20 yr</option></select>
    <select id="minyr"><option value="0">Any year built</option><option value="1900">built ≥ 1900</option>
      <option value="1960">built ≥ 1960</option><option value="1980">built ≥ 1980</option>
      <option value="2000">built ≥ 2000</option></select>
    <select id="maxyr"><option value="0">No year max</option><option value="1960">built ≤ 1960</option>
      <option value="1980">built ≤ 1980</option><option value="1990">built ≤ 1990</option>
      <option value="2000">built ≤ 2000</option></select>
    <select id="maxacq" class="wide"><option value="0">Any year held (since)</option>
      <option value="2020">held since ≤ 2020</option><option value="2015">held since ≤ 2015</option>
      <option value="2010">held since ≤ 2010</option><option value="2005">held since ≤ 2005</option>
      <option value="2000">held since ≤ 2000</option><option value="1990">held since ≤ 1990</option></select>
    <label class="cb"><input type="checkbox" id="mr"> include 60–75k manual review</label>
    <label class="cb"><input type="checkbox" id="sigonly"> only with distress signals</label>
    <button type="button" class="reset" id="reset">Reset filters</button>
  </div>
  <div class="legend">
    <div class="lr"><span class="dot" style="background:#0f6e56"></span> strong fit</div>
    <div class="lr"><span class="dot" style="background:#d98a2b"></span> moderate</div>
    <div class="lr"><span class="dot" style="background:#b0ada2"></span> lower</div>
    <div class="lr"><span class="dot" style="background:#cfcbc0"></span> not scored (manual review)</div>
  </div>
  <div class="cnt" id="cnt"></div>
  <div class="covnote" id="covnote"></div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script>
const DATA=__DATA__;
const rows=DATA.rows;
const CMAX=DATA.comp_max||{};
const CKEYS=Object.keys(CMAX);
const CLABEL={proximity_score:'Proximity',vacancy_evidence:'Vacancy',tax_delinquency:'Tax delinq.',
physical_fit:'Physical fit',code_violations:'Violations',hold_period:'Hold period',
owner_profile:'Owner profile',permit_anomaly:'Permit anomaly',year_built_band:'Year-built',
truck_access_inverse:'Truck access'};
// Reachable ceiling, same as the dashboard: a component only counts toward the ceiling once
// some scored row actually earns it — the dormant ones (vacancy, tax, …) are pending data, so
// the score is judged against the live ceiling, not a notional 100.
// A1: judge each parcel against its own market's reachable points (city_ceil/city_live from
// tools/ranking.py); fall back to a global ceiling for old --from-json snapshots.
const CITY_CEIL=DATA.city_ceil||{},CITY_LIVE=DATA.city_live||{};
const GLOBAL_LIVE={};rows.forEach(r=>{const c=r.comp||{};for(const k in c)if(c[k]>0)GLOBAL_LIVE[k]=1;});
const GLOBAL_CEIL=CKEYS.reduce((s,k)=>s+(GLOBAL_LIVE[k]?CMAX[k]:0),0)||42;
function ceilFor(r){return (r&&r.ceil)||(r&&CITY_CEIL[r.city])||GLOBAL_CEIL;}
function liveFor(r){return (r&&CITY_LIVE[r.city])||CKEYS.filter(k=>GLOBAL_LIVE[k]);}
function tier(r){if(r==null||r.score==null)return 'na';const p=r.score/ceilFor(r);return p>=0.66?'hi':p>=0.4?'mid':'lo';}
const COLOR={hi:'#0f6e56',mid:'#d98a2b',lo:'#b0ada2',na:'#cfcbc0'};
const fmt=n=>n==null?'—':n.toLocaleString(undefined,{maximumFractionDigits:0});
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtPhone(p){const d=String(p==null?'':p).replace(/\\D/g,'');
return d.length===10?'('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6):String(p||'');}
// Owner contact for the popup: person + role, every phone (tel:) and email (mailto:).
// Mirrors the dashboard's contactDetail so the map shows the same source-backed contact.
function contactDetail(r){const hasP=r.phones&&r.phones.length,hasE=r.emails&&r.emails.length;
if(!hasP&&!hasE&&!r.person)return '<span class="muted">— no source-backed contact yet</span>';
let h='';if(r.person)h+='<b>'+esc(r.person)+'</b>'+(r.prole?' <span class="muted">('+esc(String(r.prole).replace(/_/g,' '))+')</span>':'')+(hasP||hasE?'<br>':'');
if(hasP)h+=r.phones.map(p=>'<a href="tel:'+esc(String(p).replace(/\\D/g,''))+'">'+esc(fmtPhone(p))+'</a>').join(' &nbsp;·&nbsp; ');
if(hasP&&hasE)h+='<br>';
if(hasE)h+=r.emails.map(e=>'<a href="mailto:'+esc(e)+'">'+esc(e)+'</a>').join(' &nbsp;·&nbsp; ');
if(r.cc)h+=' <span class="chip '+(r.cc==='high'?'hot':(r.cc==='medium'?'o':'mr'))+'" style="margin-left:6px">'+esc(r.cc)+' confidence</span>';
return h;}

const map=L.map('map',{preferCanvas:true}).setView([37.5,-84],5);
// Satellite (default) = Esri World Imagery + a transparent reference overlay for street/place
// labels (Google-hybrid feel). Street = OpenStreetMap. Toggle top-right.
const sat=L.layerGroup([
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:19,attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics'}),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:19,opacity:.9})
]);
const street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {maxZoom:19,attribution:'&copy; OpenStreetMap'});
sat.addTo(map);  // default basemap
L.control.layers({'Satellite':sat,'Street':street},null,{position:'topright',collapsed:false}).addTo(map);

const cluster=L.markerClusterGroup({maxClusterRadius:48,spiderfyOnMaxZoom:true,
  showCoverageOnHover:false});
map.addLayer(cluster);

// The county code-violation feed jams "Type: X Description: Y Additional Comments: Z" into one
// blob and permit anomalies carry a machine key prefix — pull out the human-readable part so the
// evidence reads like a sentence, not a data dump (ported from the dashboard).
function cleanEv(x){const t=String(x.detail||'').trim();
  if(x.type==='permit_anomaly')return esc(t.replace(/^[a-z0-9_]+:\\s*/,''));
  let typ='',desc=t;const di=t.search(/Description:/i);
  if(di>=0){const ti=t.search(/Type:/i);
    if(ti>=0&&ti<di)typ=t.slice(ti+5,di).trim().replace(/^Property Violations\\s*-\\s*/i,'').trim();
    desc=t.slice(di+12);const ai=desc.search(/Additional Comments:/i);if(ai>=0)desc=desc.slice(0,ai);desc=desc.trim();}
  return (typ?'<b>'+esc(typ)+'</b> — ':'')+esc(desc);}

function chips(r){let h='';
  h+='<span class="chip'+((r.ot==='trust'||r.ot==='individual')?' hot':'')+'">'+esc(r.ot)+'</span>';
  if(r.oos)h+='<span class="chip o">out-of-state</span>';
  if(r.bucket!=='universe')h+='<span class="chip mr">manual review</span>';
  if(r.sfc==='mismatch')h+='<span class="chip bad">SF mismatch</span>';
  if(r.nv)h+='<span class="chip v">'+r.nv+' violation'+(r.nv>1?'s':'')+'</span>';
  if(r.np)h+='<span class="chip p">no recent permits</span>';
  return h;}

// Last sale price + price/SF. A bulk/portfolio sale (same date+price stamped on >1 parcel,
// flagged server-side via r.pn) — or any absurd >$1,000/SF figure — gets the total shown but
// the per-SF suppressed, since dividing a whole-deal price by one parcel's SF is meaningless.
function salePrice(r){if(!r.sale)return '—';
  if(!r.price)return '$0 <span class="muted">($0 / non-arm\\'s-length recorded)</span>';
  const psf=r.sf?r.price/r.sf:0;
  const bulk=r.pn>1||psf>1000;
  if(bulk)return '$'+fmt(r.price)+' <span class="muted">· '
    +(r.pn>1?r.pn+'-parcel bulk sale':'bulk/portfolio?')+' — per-SF n/a</span>';
  return '$'+fmt(r.price)+(psf?' <span class="muted">· $'+psf.toFixed(2)+'/SF</span>':'');}

function facts(r){const F=[
  ['Owner','<b>'+esc(r.own)+'</b> <span class="muted">('+esc(r.ot)+(r.oos?', out-of-state':'')+')</span>'],
  ['Contact',contactDetail(r)],
  ['Mailing',r.mail?esc(r.mail):'—'],
  ['Land use',esc(r.lu||'—')],
  ['Building',fmt(r.sf)+' SF total'+(r.sfL&&r.sfL!==r.sf?' · largest '+fmt(r.sfL)+' SF':'')
    +(r.nb?' · '+r.nb+' building'+(r.nb>1?'s':''):'')],
  ['Clear height',r.ch!=null?('~'+r.ch.toFixed(0)+' ft <span class="muted">'+(r.chs||'est')
    +' roof est — interior ~2-4 ft less</span>'):'<span class="muted">— no LiDAR estimate</span>'],
  ['Year built',r.yr?String(r.yr):'—'],
  // av<=1 = not in the county feed (Charlotte's assessed_value is absent) — show "—", not a fake $0/SF.
  ['Assessed',r.av>1?('$'+fmt(r.av)+(r.sf?' <span class="muted">· $'+(r.av/r.sf).toFixed(2)+'/SF</span>':''))
    :'<span class="muted">— not in county feed</span>'],
  ['Last sale',r.sale?r.sale:'—'],
  ['Sale price',salePrice(r)],
  ['Location',r.mi.toFixed(1)+' mi to core · held '+r.hold.toFixed(0)+' yr']];
  return '<dl class="facts">'+F.map(kv=>'<dt>'+kv[0]+'</dt><dd>'+kv[1]+'</dd>').join('')+'</dl>';}

function compBreak(r){const c=r.comp||{};
  if(!Object.keys(c).length)return '<div class="pendrow">Not scored — '+esc(r.gate||'manual review (60–75k SF)')+'</div>';
  const LV=liveFor(r);
  const live=CKEYS.filter(k=>LV.includes(k)).map(k=>[k,c[k]||0,CMAX[k]]).sort((a,b)=>b[1]-a[1]);
  const dormant=CKEYS.filter(k=>!LV.includes(k));
  let h='<div class="bkhd">Score breakdown — <b>'+(r.score==null?'—':r.score)+'</b> of '+ceilFor(r)+' reachable in '+(r.city||'this market')+'</div><div class="cbreak">';
  live.forEach(([k,v,mx])=>{const pct=mx?Math.round(v/mx*100):0;
    h+='<div class="lab">'+(CLABEL[k]||k.replace(/_/g,' '))+'</div>'
      +'<div class="track"><i class="fill'+(v>0?'':' z')+'" style="width:'+pct+'%"></i></div>'
      +'<div class="val"><b>'+(+v)+'</b>/'+mx+'</div>';});
  h+='</div>';
  if(dormant.length)h+='<div class="pendrow">Locked until imagery + tax land: '
    +dormant.map(k=>(CLABEL[k]||k.replace(/_/g,' '))+' <b>'+CMAX[k]+'</b>').join(' · ')+'</div>';
  return h;}

function evidence(r){if(!r.sig.length)return '';
  return '<div class="evhd">Distress evidence</div><div class="evlist">'+r.sig.map(x=>{const v=x.type==='code_violation',vis=x.type==='visual_distress';
    const tag=v?'Violation':vis?'Visual':'Permit';
    return '<div class="evrow"><span class="tag '+(v||vis?'vv':'pp')+'">'+tag+'</span>'
      +'<div class="ev">'+(x.date?'<span class="when">'+x.date+'</span>':'')+cleanEv(x)+'</div></div>';}).join('')+'</div>';}
// Site assessment from the imagery/VLM pass (site_observations) — mirrors the dashboard
// row + call sheet so the popup shows the same read.
function occLabel(p,s){
  if(p==='empty'&&s==='no')return 'vacancy signals — empty lot, no signage';
  if(p==='empty'||p==='sparse'||s==='no')return 'possible vacancy — sparse / no signage';
  if(p==='not_visible'&&s==='not_visible')return 'occupancy unclear from imagery';
  if(!p&&!s)return 'not assessed';
  return 'clearly active (occupied)';}
function siteAssess(r){const o=r.obs;if(!o)return '';
  let h='<div class="evhd">Site assessment <span class="muted">(imagery / VLM)</span></div><dl class="facts">';
  h+='<dt>Occupancy</dt><dd>'+esc(occLabel(o.park,o.sign))+' <span class="muted">(parking '+esc(o.park||'—')+', signage '+esc(o.sign||'—')+')</span></dd>';
  if(o.use){const fl=o.match===false?' — ⚠️ NO LONGER MATCHES assessor land use':o.match===true?' ✓ matches land use':'';
    h+='<dt>Observed use</dt><dd>'+esc(o.use)+(fl?'<b>'+esc(fl)+'</b>':'')+'</dd>';}
  if(o.ten&&o.ten.length){const m=[o.tency,o.occ].filter(Boolean).join(' / ');
    h+='<dt>Tenant(s)</dt><dd>'+esc(o.ten.join(', '))+(m?' <span class="muted">('+esc(m)+')</span>':'')+'</dd>';}
  const phys=[];if(o.docks!=null)phys.push('~'+o.docks+' docks');if(o.drive!=null)phys.push('~'+o.drive+' drive-ins');
  if(o.div)phys.push('divisibility '+o.div);if(o.truck)phys.push('truck '+o.truck);if(o.cond)phys.push('condition '+o.cond);
  if(phys.length)h+='<dt>Physical</dt><dd>'+esc(phys.join(' · '))+'</dd>';
  if(o.ctx)h+='<dt>Context</dt><dd>'+esc(o.ctx)+'</dd>';
  if(o.note)h+='<dt>Observed</dt><dd>'+esc(o.note)+'</dd>';
  h+='</dl>';
  if(o.src)h+='<div class="muted" style="margin:-6px 0 10px">source: <a target="_blank" rel="noopener" href="'+o.src+'">satellite imagery ↗</a>'+(o.cap?' · '+esc(o.cap):'')+(o.ver?' · '+esc(o.ver):'')+'</div>';
  return h;}

function popup(r){const qy=encodeURIComponent(r.addr+', '+(r.place||r.city||''));
  const gsearch='https://www.google.com/search?q='+qy;
  const gmaps='https://www.google.com/maps/search/?api=1&query='+qy;
  return '<div class="lp"><a class="a" target="_blank" rel="noopener" href="'+gsearch+'">'+esc(r.addr)+' ↗</a>'
    +'<div class="apn">'+esc(r.city)+' · APN '+esc(r.apn)+'</div>'
    +'<span class="sc '+tier(r)+'">'+(r.score==null?'manual review':'Score '+r.score+' / '+ceilFor(r)+' ('+Math.round(r.score/ceilFor(r)*100)+'% fit)')+'</span>'
    +'<div class="chips">'+chips(r)+'</div>'
    +facts(r)+compBreak(r)+siteAssess(r)+evidence(r)
    +'<a class="mapl" target="_blank" rel="noopener" href="'+gmaps+'">Open in Google Maps ↗</a></div>';}

const otSel=document.getElementById('otype');
[...new Set(rows.map(r=>r.ot))].sort().forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;otSel.appendChild(o);});
const citySel=document.getElementById('city');
const CITIES=[...new Set(rows.map(r=>r.city).filter(Boolean))].sort();
CITIES.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;citySel.appendChild(o);});
if(CITIES.length<2)citySel.style.display='none';
const $=id=>document.getElementById(id);

// Score filter is tier-based (matches the marker colours): 'hi' = strong only, 'mid' =
// strong or moderate. tier(null)==='na', so unscored manual-review parcels drop out the
// moment any min-score / clear-height / year is set — same semantics as the dashboard.
function visible(){const q=$('q').value.toLowerCase(),
  ot=otSel.value,cy=citySel.value,ownerloc=$('ownerloc').value,minscore=$('minscore').value,
  minsf=+$('minsf').value,maxsf=+$('maxsf').value,maxch=+$('maxch').value,
  maxmi=+$('maxmi').value,minhold=+$('minhold').value,minyr=+$('minyr').value,maxyr=+$('maxyr').value,
  maxacq=+$('maxacq').value,
  mr=$('mr').checked,so=$('sigonly').checked;
  // "held since <= Y" = current owner acquired in/before year Y (long-held). Acquisition year
  // comes from last_sale_date (r.sale); rows with no recorded sale drop out when the filter is set.
  return rows.filter(r=>(mr||r.universe)&&r.sf>=minsf&&(!maxsf||r.sf<=maxsf)
    &&(!minscore||(minscore==='hi'?tier(r)==='hi':(tier(r)==='hi'||tier(r)==='mid')))
    &&(!maxmi||r.mi<=maxmi)&&(!minhold||r.hold>=minhold)
    // clear height (Nashville only) + year built (missing for Columbus) PASS THROUGH when the
    // value is absent — so setting them narrows the cities that HAVE the data without nuking the
    // cities that don't. A parcel is only dropped when it HAS a value that fails the bound.
    &&(!maxch||r.ch==null||r.ch<=maxch)
    &&(!minyr||!r.yr||r.yr>=minyr)&&(!maxyr||!r.yr||r.yr<=maxyr)
    &&(!maxacq||(r.sale&&+r.sale.slice(0,4)<=maxacq))
    &&(!ownerloc||(ownerloc==='out'?r.oos:!r.oos))&&(!ot||r.ot===ot)&&(!cy||r.city===cy)
    &&(!so||r.nv||r.np)&&(!q||(r.addr+' '+r.own+' '+r.apn+' '+(r.person||'')+' '+(r.phones||[]).join(' ')+' '+(r.emails||[]).join(' ')).toLowerCase().includes(q)));}

function draw(){const f=visible();cluster.clearLayers();
  const ms=f.map(r=>L.circleMarker([r.lat,r.lon],
    {radius:7,color:'#fff',weight:1.5,fillColor:COLOR[tier(r)],fillOpacity:.95})
    .bindPopup(()=>popup(r),{maxWidth:360,minWidth:300,
      autoPanPaddingTopLeft:[336,70],autoPanPaddingBottomRight:[40,40]})
    .bindTooltip(r.addr,{direction:'top'}));
  cluster.addLayers(ms);
  document.getElementById('cnt').innerHTML='<b>'+f.length+'</b> of '+rows.length+' shown';
  if(ms.length){try{map.fitBounds(cluster.getBounds().pad(.12));}catch(e){}}}

['q','city','otype','ownerloc','minscore','minsf','maxsf','maxch','maxmi','minhold','minyr','maxyr','maxacq','mr','sigonly']
  .forEach(id=>$(id).addEventListener('input',draw));
$('reset').addEventListener('click',()=>{
  document.querySelectorAll('.filters select').forEach(s=>{s.selectedIndex=0;});
  $('q').value='';$('mr').checked=false;$('sigonly').checked=false;draw();});
document.getElementById('sub').textContent=
  'Generated '+DATA.generated+' · '+rows.length+' parcels across '+CITIES.length+(CITIES.length>1?' cities':' city');
// Honest data-coverage note so the clear-height / year-built filters don't look broken: they only
// constrain the cities that actually carry that field; cities without it are left untouched.
(function(){const cov={};CITIES.forEach(c=>cov[c]={ch:0,yr:0});
  rows.forEach(r=>{if(r.ch!=null)cov[r.city].ch++;if(r.yr)cov[r.city].yr++;});
  const chC=CITIES.filter(c=>cov[c].ch>0), yrMiss=CITIES.filter(c=>cov[c].yr===0);
  let n=[];
  if(chC.length<CITIES.length)n.push('Clear-height data: '+(chC.join(', ')||'none')+' only');
  if(yrMiss.length)n.push('Year built: not yet in '+yrMiss.join(', '));
  $('covnote').textContent=n.length?(n.join(' · ')+'. Those filters narrow the cities that have the data and leave the rest unchanged.'):'';
})();
draw();
// Parity with the dashboard: the clear-height filter must NEVER open pre-applied. Browsers restore
// form-control values on back/forward (bfcache), so returning from the Table view could otherwise
// reopen the map still filtered to a previously-picked '≤ N ft'. pageshow fires on the initial load
// AND on bfcache restore — force it back to "Any clear height" (no clear-height filter) each time.
window.addEventListener('pageshow',function(){var m=document.getElementById('maxch');
if(m&&m.value!=='0'){m.value='0';draw();}});
</script></body></html>
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="exports/map.html")
    ap.add_argument("--from-json", default=None, metavar="PATH",
                    help="build from a saved JSON snapshot instead of the DB")
    ap.add_argument("--dump-json", default=None, metavar="PATH",
                    help="also write the collected data to this JSON path (DB-free rebuild)")
    args = ap.parse_args()

    if args.from_json:
        data = json.loads(Path(args.from_json).read_text(encoding="utf-8"))
        data.setdefault("comp_max", _comp_max())  # backfill snapshots saved before the breakdown bars
        data.setdefault("city_ceil", {})           # backfill pre-A1 snapshots (client falls back to a global ceiling)
        data.setdefault("city_live", {})
    else:
        data = collect()
        if args.dump_json:
            Path(args.dump_json).parent.mkdir(parents=True, exist_ok=True)
            Path(args.dump_json).write_text(json.dumps(data, default=_js), encoding="utf-8")
            print(f"data snapshot: {args.dump_json} written ({len(data['rows'])} rows)")

    payload = json.dumps(data, default=_js).replace("</", "<\\/")
    html = TEMPLATE.replace("__DATA__", payload).replace("__GEN__", data["generated"])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"map: {out} written — {data['n']} parcels across "
          f"{len(data['markets'])} markets ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
