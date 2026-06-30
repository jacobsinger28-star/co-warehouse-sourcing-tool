#!/usr/bin/env python3
"""Pull the real brokers from Pipedrive and merge them into the frontend real export.

The on-market scraper pushes each listing broker to Pipedrive as a Person OWNED BY
"Raz" (see general-scraping/backend/pipedrive.py `_find_or_create_broker_person`),
tagged with the tool label. So the brokers = Pipedrive persons with owner_name == "Raz"
(everyone else's persons are owners/other contacts). This pulls those, maps them to the
app's broker schema, and writes them into frontend/public/data.real.json `brokers`.

    PIPEDRIVE_API_TOKEN=… python3 tools/pull_pipedrive_brokers.py
    # or it reads the token from ../general-scraping/backend/.env automatically

Owner/broker PII → data.real.json is GITIGNORED and only reaches the public deploy
encrypted (data.enc.json). Re-run after build_real_data.py (which rebuilds props).
"""
from __future__ import annotations
import json, os, sys, urllib.request, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                       # sourcing-platform/
DATA = ROOT / "frontend" / "public" / "data.real.json"
BROKER_OWNER = "Raz"                      # tool-created broker persons are owned by Raz

# area code → our market label (fallback when the org name has no " - City" suffix)
AREA_MKT = {
    "704": "Charlotte", "980": "Charlotte", "828": "Charlotte",
    "843": "Charleston", "854": "Charleston",
    "919": "Raleigh", "984": "Raleigh",
    "305": "Miami", "786": "Miami",
    "954": "Fort Lauderdale", "561": "West Palm Beach",
    "614": "Columbus", "380": "Columbus",
    "513": "Cincinnati", "216": "Cleveland", "440": "Cleveland",
    "615": "Nashville", "629": "Nashville", "931": "Nashville",
    "317": "Indianapolis", "463": "Indianapolis",
    "407": "Orlando", "321": "Orlando", "689": "Orlando", "813": "Tampa", "727": "Tampa",
}


def _token() -> str:
    tok = os.getenv("PIPEDRIVE_API_TOKEN", "")
    if tok:
        return tok
    for env in (ROOT.parent / "general-scraping" / "backend" / ".env",
                ROOT / ".." / "general-scraping" / "backend" / ".env"):
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("PIPEDRIVE_API_TOKEN"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("no PIPEDRIVE_API_TOKEN (set the env var or general-scraping/backend/.env)")


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def _pick(lst, *labels) -> str:
    if not lst:
        return ""
    for lab in labels:
        for e in lst:
            if (e.get("label") or "").lower() == lab:
                return e.get("value", "")
    for e in lst:
        if e.get("primary"):
            return e.get("value", "")
    return lst[0].get("value", "")


def _market(org: str, phone: str, cell: str) -> str:
    if org and " - " in org:
        city = org.split(" - ", 1)[1].split(",")[0].strip()
        if city:
            return city
    for num in (cell, phone):
        digits = "".join(c for c in (num or "") if c.isdigit())
        if len(digits) >= 10:
            ac = digits[-10:-7]
            if ac in AREA_MKT:
                return AREA_MKT[ac]
    return "—"


def main() -> None:
    tok = _token()
    persons, start = [], 0
    while True:
        q = urllib.parse.urlencode({"api_token": tok, "limit": 100, "start": start})
        d = _get(f"https://api.pipedrive.com/v1/persons?{q}")
        persons += d.get("data") or []
        pag = (d.get("additional_data") or {}).get("pagination", {})
        if pag.get("more_items_in_collection"):
            start = pag.get("next_start", start + 100)
        else:
            break

    raw = [p for p in persons if (p.get("owner_name") or "") == BROKER_OWNER]
    brokers = []
    for i, p in enumerate(sorted(raw, key=lambda x: x.get("name", "")), 1):
        org = p.get("org_name") or "—"
        phone = _pick(p.get("phone"), "work")
        cell = _pick(p.get("phone"), "mobile")
        brokers.append({
            "id": i,
            "name": p.get("name") or "Broker",
            "firm": org,
            "phone": phone,
            "cell": cell,
            "email": _pick(p.get("email"), "work"),
            "mkts": _market(org, phone, cell),
            "listings": (p.get("closed_deals_count", 0) or 0) + (p.get("open_deals_count", 0) or 0),
            "synced": True,
        })

    if not DATA.exists():
        sys.exit(f"{DATA} not found — run tools/build_real_data.py first")
    data = json.loads(DATA.read_text())
    data["brokers"] = brokers
    data.setdefault("counts", {})["brokers"] = len(brokers)
    DATA.write_text(json.dumps(data))
    print(f"pulled {len(brokers)} brokers from Pipedrive (owner={BROKER_OWNER}) → {DATA.name}")
    print("markets:", ", ".join(sorted({b["mkts"] for b in brokers})))


if __name__ == "__main__":
    main()
