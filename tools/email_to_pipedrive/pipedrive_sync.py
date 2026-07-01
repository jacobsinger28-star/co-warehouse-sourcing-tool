"""Create/dedupe a broker in Pipedrive.

Mirrors general-scraping/backend/pipedrive.py `_find_or_create_broker_person`:
  * dedupe by email, then cell, then phone (never overwrite an existing person)
  * create a Person owned by Raz, cell flagged primary 'mobile', phone as 'work'
  * attach a source note recording where the contact came from

Token loading mirrors tools/pull_pipedrive_brokers.py (env or the general-scraping
backend .env). dry_run=True (default) prints the exact payload and hits nothing.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from broker_extract import Broker

_BASE = "https://api.pipedrive.com/v1"
_ROOT = Path(__file__).resolve().parents[2]          # sourcing-platform/
_TOOL_LABEL = "email-intake-tool"                    # provenance tag (in the note)


def _token() -> str:
    tok = os.getenv("PIPEDRIVE_API_TOKEN", "")
    if tok:
        return tok
    for env in (_ROOT.parent / "general-scraping" / "backend" / ".env",):
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("PIPEDRIVE_API_TOKEN"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("no PIPEDRIVE_API_TOKEN (set env var or general-scraping/backend/.env)")


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.load(r)


def _post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def _digits(s: Optional[str]) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def _search_person(token: str, term: Optional[str], field: str) -> Optional[int]:
    if not term:
        return None
    q = urllib.parse.urlencode({
        "api_token": token, "term": term, "fields": field,
        "exact_match": "true" if field == "email" else "false", "limit": 1,
    })
    try:
        items = ((_get(f"{_BASE}/persons/search?{q}").get("data") or {}).get("items")) or []
        if items:
            return items[0]["item"]["id"]
    except Exception as exc:  # noqa: BLE001 — search is best-effort
        print(f"  ! person search failed ({field}={term}): {exc}", file=sys.stderr)
    return None


def _owner_user_id(token: str) -> Optional[int]:
    env = os.getenv("PIPEDRIVE_OWNER_USER_ID")
    if env and env.isdigit():
        return int(env)
    try:
        return (_get(f"{_BASE}/users/me?api_token={token}").get("data") or {}).get("id")
    except Exception:
        return None


def _build_payload(broker: Broker, owner_id: Optional[int]) -> dict:
    phones = []
    if broker.cell:
        phones.append({"value": broker.cell, "primary": True, "label": "mobile"})
    if broker.phone and _digits(broker.phone) != _digits(broker.cell):
        phones.append({"value": broker.phone, "primary": not bool(broker.cell), "label": "work"})
    payload: dict = {"name": broker.name or "Broker"}
    # Org/firm linking is left to a later pass; the firm is recorded in the note.
    if owner_id:
        payload["owner_id"] = owner_id
    if phones:
        payload["phone"] = phones
    if broker.email:
        payload["email"] = [{"value": broker.email, "primary": True, "label": "work"}]
    return payload


def _note_body(broker: Broker) -> str:
    import html
    bits = [f"<b>Source</b> (added via {_TOOL_LABEL} from a forwarded email)"]
    if broker.company:
        bits.append(f"Firm: {html.escape(broker.company)}")
    if broker.markets:
        bits.append(f"Markets: {html.escape(', '.join(broker.markets))}")
    if broker.context:
        bits.append(html.escape(broker.context))
    for d in broker.deals[:8]:
        s = d.get("summary") or ""
        addr = d.get("address")
        price = d.get("price")
        line = " • ".join(filter(None, [s, addr, price]))
        if line:
            bits.append(html.escape(line))
    return "<br>".join(bits)


def upsert_broker(broker: Broker, dry_run: bool = True) -> dict:
    """Dedupe + create. dry_run prints the payload and returns without POSTing."""
    token = _token()
    existing = (
        _search_person(token, broker.email, "email")
        or _search_person(token, broker.cell, "phone")
        or _search_person(token, broker.phone, "phone")
    )
    if existing:
        return {"status": "exists", "person_id": existing,
                "url": f"https://app.pipedrive.com/person/{existing}"}

    owner_id = _owner_user_id(token)
    payload = _build_payload(broker, owner_id)

    if dry_run:
        return {"status": "dry_run", "would_create": payload,
                "note": _note_body(broker), "owner_id": owner_id}

    data = _post(f"{_BASE}/persons?api_token={token}", payload)
    if not data.get("success"):
        return {"status": "error", "error": data.get("error"), "payload": payload}
    new_id = data["data"]["id"]
    try:  # source note is best-effort
        _post(f"{_BASE}/notes?api_token={token}",
              {"content": _note_body(broker), "person_id": new_id})
    except Exception as exc:  # noqa: BLE001
        print(f"  ! note failed for person {new_id}: {exc}", file=sys.stderr)
    return {"status": "created", "person_id": new_id,
            "url": f"https://app.pipedrive.com/person/{new_id}"}
