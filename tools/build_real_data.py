#!/usr/bin/env python3
"""
Build the sourcing-platform's real data file from the two upstream scraping projects.

Reads (read-only):
  - off-market : ../offmarket-scraping/exports/map_data.json   (scored owner universe)
  - on-market  : ../general-scraping/backend/live_listings.db  (scored brokered listings)

Writes:
  - frontend/public/data.real.json   (GITIGNORED — contains owner/broker PII + licensed data)

The React app fetches /data.real.json at runtime and falls back to the committed
synthetic src/data.js when it is absent (e.g. a fresh clone or public deploy).

Nothing here prints PII to stdout — only aggregate counts. Run from anywhere:
    python3 tools/build_real_data.py
"""
from __future__ import annotations
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent          # sourcing-platform/
WORKSPACE = REPO.parent                                 # SimiCapital/
OFFMARKET_JSON = WORKSPACE / "offmarket-scraping" / "exports" / "map_data.json"
ONMARKET_DB = WORKSPACE / "general-scraping" / "backend" / "live_listings.db"
OUT = REPO / "frontend" / "public" / "data.real.json"

# County → metro display name + state (Cuyahoga County = Cleveland metro).
CITY_MARKET = {"Cuyahoga": "Cleveland"}
CITY_STATE = {"Nashville": "TN", "Charlotte": "NC", "Columbus": "OH",
              "Cuyahoga": "OH", "Cleveland": "OH", "Charleston": "SC"}

# Off-market scoring is a 0–100-capped model; this batch tops out at 61 and is
# heavily right-skewed (median ~14). We bucket by *relative rank* so the
# Actionable/Tentative/Pass label means "top leads / worth a look / parked",
# while the displayed number stays the raw model score.
ACTIONABLE_CUT, TENTATIVE_CUT = 25, 12

OWNER_TYPE = {"llc": "LLC", "lp": "LP", "llp": "LLP", "individual": "Individual",
              "trust": "Trust", "partnership": "Partnership",
              "corporation": "Corp", "estate": "Estate", "": "—"}

SOURCE_FIRM = {"colliers": "Colliers", "cushman": "Cushman & Wakefield",
               "jll": "JLL", "newmark": "Newmark", "crexi": "Crexi", "cbre": "CBRE"}

# On-market rows carry only a category, not a numeric score; show a nominal
# midpoint so the score column/badge has a value tied to the real category.
CAT_NOMINAL = {"Actionable": 78, "Tentative": 58, "Pass": 32}

_FIX_CASE = {"Llc": "LLC", "Lp": "LP", "Llp": "LLP", "Lp.": "LP", "Inc": "Inc",
             "Ii": "II", "Iii": "III", "Us": "US", "Nc": "NC", "Tn": "TN",
             "Oh": "OH", "Sc": "SC", "Po": "PO"}


def smart_title(s: str | None) -> str:
    if not s:
        return ""
    out = s.title()
    return re.sub(r"[A-Za-z]+\.?",
                  lambda m: _FIX_CASE.get(m.group(0), m.group(0)), out)


def oos_state(row: dict) -> str | None:
    if not row.get("oos"):
        return None
    toks = re.findall(r"\b([A-Z]{2})\b", row.get("mail") or "")
    return toks[-1] if toks else "OOS"


def offmarket_signal(row: dict) -> str:
    sig = row.get("sig") or []
    if sig:
        t = (sig[0].get("type") or "").replace("_", " ").strip()
        if t:
            return t[0].upper() + t[1:]
    if row.get("oos"):
        return "Out-of-state owner"
    if row.get("nv"):
        return "Code violations"
    return "Scored lead"


def offmarket_contact(row: dict) -> str:
    if row.get("phones"):
        return "Owner phone found"
    if row.get("emails"):
        return "Email found"
    if row.get("person"):
        return "Skip-traced"
    return "No contact"


def offmarket_cat(score) -> str:
    if score is None:
        return "Pass"
    if score >= ACTIONABLE_CUT:
        return "Actionable"
    if score >= TENTATIVE_CUT:
        return "Tentative"
    return "Pass"


def load_offmarket() -> list[dict]:
    if not OFFMARKET_JSON.exists():
        print(f"  ! off-market source not found: {OFFMARKET_JSON}", file=sys.stderr)
        return []
    rows = json.loads(OFFMARKET_JSON.read_text())["rows"]
    out = []
    for r in rows:
        lat, lng = r.get("lat"), r.get("lon")
        if lat is None or lng is None:
            continue
        city = r.get("city") or ""
        score = r.get("score")
        out.append({
            "id": f"off-{r.get('apn')}",
            "channel": "off",
            "addr": smart_title(r.get("addr")),
            "mkt": CITY_MARKET.get(city, city),
            "st": CITY_STATE.get(city, ""),
            "sf": int(r.get("sfL") or r.get("sf") or 0),
            "cat": offmarket_cat(score),
            "score": int(round(score)) if isinstance(score, (int, float)) else 0,
            "signal": offmarket_signal(r),
            "owner": smart_title(r.get("own")) or "—",
            "ownerType": OWNER_TYPE.get((r.get("ot") or "").lower(),
                                        smart_title(r.get("ot")) or "—"),
            "oos": oos_state(r),
            "clear": int(r["ch"]) if r.get("ch") else None,
            "year": int(r["yr"]) if r.get("yr") else None,
            "contact": offmarket_contact(r),
            "mail": r.get("mail") or "—",
            "lat": round(float(lat), 6),
            "lng": round(float(lng), 6),
            "apn": r.get("apn"),
            "comp": r.get("comp") or {},
            # real owner contact (drives the AI Caller + drawer; PII — gitignored)
            "phones": r.get("phones") or [],
            "emails": r.get("emails") or [],
            "person": r.get("person") or "",
            "contactConf": r.get("cc") or "",
            # real distress evidence (replaces the drawer's old hardcoded text)
            "sigs": [{"type": s.get("type"), "detail": (s.get("detail") or "")[:90], "date": s.get("date")}
                     for s in (r.get("sig") or [])[:4]],
            "nViol": r.get("nv") or 0,
            "nPermit": r.get("np") or 0,
            # real property facts / financials
            "lastSale": r.get("sale"),
            "lastPrice": int(r["price"]) if r.get("price") else 0,
            "assessed": int(r["av"]) if r.get("av") else 0,
            "holdYears": round(r["hold"], 1) if isinstance(r.get("hold"), (int, float)) else None,
            "distMi": round(r["mi"], 1) if isinstance(r.get("mi"), (int, float)) else None,
            "buildings": r.get("nb"),
            "landUse": r.get("lu") or "",
            "bucket": r.get("bucket"),
        })
    return out


def parse_city_state(address: str) -> tuple[str, str]:
    parts = [p.strip() for p in (address or "").split(",")]
    if len(parts) < 2:
        return "", ""
    m = re.match(r"^([A-Z]{2})\b", parts[-1])
    city = parts[-2] if m else parts[-1]
    # guard against a trailing ZIP / non-city token leaking into the market facet
    if not re.search(r"[A-Za-z]", city):
        city = ""
    return city, (m.group(1) if m else "")


def load_onmarket() -> list[dict]:
    if not ONMARKET_DB.exists():
        print(f"  ! on-market source not found: {ONMARKET_DB}", file=sys.stderr)
        return []
    con = sqlite3.connect(f"file:{ONMARKET_DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    out = []
    for r in con.execute("SELECT * FROM listings"):
        lat, lng = r["lat"], r["lng"]
        if lat is None or lng is None:
            continue
        city, st = parse_city_state(r["address"])
        street = (r["address"] or "").split(",")[0].strip()
        cat = r["score_category"] or "Tentative"
        reason = (r["scoring_reason"] or "").strip()
        broker = (r["broker_name"] or "").strip()
        out.append({
            "id": f"on-{r['id']}",
            "channel": "on",
            "addr": street,
            "mkt": city,
            "st": st,
            "sf": int(r["total_sf"] or 0),
            "cat": cat,
            "score": CAT_NOMINAL.get(cat, 50),
            "signal": (reason[:60] + "…") if len(reason) > 61 else (reason or "Listed"),
            "broker": broker or "—",
            "firm": SOURCE_FIRM.get((r["source"] or "").lower(),
                                    smart_title(r["source"])),
            "ask": round(r["asking_price_psf"], 2) if r["asking_price_psf"] else None,
            "clear": int(r["clear_height"]) if r["clear_height"] else None,
            "year": None,
            "contact": "Broker contact" if broker else "Listing only",
            "daysOn": None,
            "lat": round(float(lat), 6),
            "lng": round(float(lng), 6),
            "listing_url": r["listing_url"],
        })
    con.close()
    return out


def build_brokers(onmarket: list[dict], raw_db: Path) -> list[dict]:
    """Distinct brokers from the on-market DB (name + firm + contact)."""
    if not raw_db.exists():
        return []
    con = sqlite3.connect(f"file:{raw_db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    seen: dict[str, dict] = {}
    for r in con.execute("SELECT broker_name, broker_email, broker_phone, "
                         "broker_cell, source FROM listings "
                         "WHERE broker_name IS NOT NULL AND broker_name != ''"):
        name = r["broker_name"].strip()
        key = name.lower()
        firm = SOURCE_FIRM.get((r["source"] or "").lower(), smart_title(r["source"]))
        if key not in seen:
            seen[key] = {"id": f"bk-{len(seen) + 1}", "name": name, "firm": firm,
                         "phone": r["broker_phone"] or "—",
                         "cell": r["broker_cell"] or "—",
                         "email": r["broker_email"] or "—",
                         "mkts": "—", "spec": "Industrial", "listings": 0,
                         "source": firm, "synced": False}
        seen[key]["listings"] += 1
    con.close()
    return list(seen.values())


def main() -> None:
    print("Building real data file for sourcing-platform…")
    off = load_offmarket()
    on = load_onmarket()
    brokers = build_brokers(on, ONMARKET_DB)
    props = off + on

    from collections import Counter
    by_market = Counter(p["mkt"] for p in props)
    by_cat = Counter(p["cat"] for p in props)

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {"offMarket": str(OFFMARKET_JSON.relative_to(WORKSPACE)),
                   "onMarket": str(ONMARKET_DB.relative_to(WORKSPACE))},
        "counts": {"props": len(props), "off": len(off), "on": len(on),
                   "brokers": len(brokers)},
        "markets": sorted(by_market),
        # static model weights (0–100 cap) — lets the drawer render a real
        # per-component score breakdown from each off-market row's `comp`.
        "compMax": {"vacancy_evidence": 22, "tax_delinquency": 15,
                    "proximity_score": 15, "physical_fit": 12,
                    "code_violations": 12, "hold_period": 8, "owner_profile": 7,
                    "condition_distress": 6, "permit_anomaly": 5,
                    "year_built_band": 5, "truck_access_inverse": 4},
        "props": props,
        "brokers": brokers,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))

    size_kb = OUT.stat().st_size / 1024
    print(f"  off-market : {len(off):>5} props")
    print(f"  on-market  : {len(on):>5} props")
    print(f"  brokers    : {len(brokers):>5}")
    print(f"  by category: {dict(by_cat)}")
    print(f"  by market  : {dict(by_market)}")
    print(f"  wrote {OUT.relative_to(REPO)} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
