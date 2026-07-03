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
import uuid
from pathlib import Path
from typing import Optional

from broker_extract import Broker

_BASE = "https://api.pipedrive.com/v1"
try:
    _ROOT = Path(__file__).resolve().parents[2]      # sourcing-platform/ (local dev)
except IndexError:
    _ROOT = None                                     # deployed alone (e.g. Railway /app)
_TOOL_LABEL = "email-intake-tool"                    # provenance tag (in the note)
_LABEL = "from-email"                                # Pipedrive Person label to set
_label_id_cache: int | None = None


def _token() -> str:
    tok = os.getenv("PIPEDRIVE_API_TOKEN", "")
    if tok:
        return tok
    if _ROOT is not None:
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


def _put(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="PUT",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def _label_field(token: str) -> dict | None:
    d = _get(f"{_BASE}/personFields?api_token={token}")
    return next((f for f in (d.get("data") or []) if f.get("key") == "label"), None)


def _get_label_id(token: str, create: bool = True) -> int | None:
    """Resolve the Person 'label' option id for _LABEL ("from-email"), creating
    it (preserving existing options) when create=True. Mirrors pipedrive.py."""
    global _label_id_cache
    if _label_id_cache is not None:
        return _label_id_cache
    try:
        field = _label_field(token)
        if not field:
            return None
        opts = field.get("options") or []
        match = next((o for o in opts if (o.get("label") or "").lower() == _LABEL.lower()), None)
        if match:
            _label_id_cache = match["id"]
            return _label_id_cache
        if not create:
            return None
        new_opts = [{"id": o["id"], "label": o["label"]} for o in opts]  # keep existing
        new_opts.append({"label": _LABEL})
        _put(f"{_BASE}/personFields/{field['id']}?api_token={token}", {"options": new_opts})
        field2 = _label_field(token) or {}
        _label_id_cache = next(
            (o["id"] for o in (field2.get("options") or [])
             if (o.get("label") or "").lower() == _LABEL.lower()), None)
    except Exception as exc:  # noqa: BLE001 — label is best-effort, never blocks
        print(f"  ! label lookup failed: {exc}", file=sys.stderr)
        _label_id_cache = None
    return _label_id_cache


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
        label_id = _get_label_id(token, create=False)   # don't create the option in a dry run
        preview = {**payload, **({"label": label_id} if label_id else {})}
        return {"status": "dry_run", "would_create": preview, "label": _LABEL,
                "note": _note_body(broker), "owner_id": owner_id}

    label_id = _get_label_id(token, create=True)         # get-or-create "from-email"
    if label_id:
        payload["label"] = label_id
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


# --------------------------- deals: "passed but tracking" ---------------------------
# The dedicated "Tracking" pipeline/stage (created once via the Pipedrive API).
# Non-secret ids, overridable via env if you rebuild the pipeline.
_TRACK_STAGE_ID = int(os.getenv("TRACK_STAGE_ID", "33"))
_deal_label_id_cache: int | None = None


def _deal_label_field(token: str) -> dict | None:
    d = _get(f"{_BASE}/dealFields?api_token={token}")
    return next((f for f in (d.get("data") or []) if f.get("key") == "label"), None)


def _get_deal_label_id(token: str, create: bool = True) -> int | None:
    """Deal 'label' option id for _LABEL ("from-email"), created if missing.
    Deal labels are a separate field from person labels."""
    global _deal_label_id_cache
    if _deal_label_id_cache is not None:
        return _deal_label_id_cache
    try:
        field = _deal_label_field(token)
        if not field:
            return None
        opts = field.get("options") or []
        match = next((o for o in opts if (o.get("label") or "").lower() == _LABEL.lower()), None)
        if match:
            _deal_label_id_cache = match["id"]
            return _deal_label_id_cache
        if not create:
            return None
        new_opts = [{"id": o["id"], "label": o["label"]} for o in opts]  # keep existing
        new_opts.append({"label": _LABEL})
        _put(f"{_BASE}/dealFields/{field['id']}?api_token={token}", {"options": new_opts})
        field2 = _deal_label_field(token) or {}
        _deal_label_id_cache = next(
            (o["id"] for o in (field2.get("options") or [])
             if (o.get("label") or "").lower() == _LABEL.lower()), None)
    except Exception as exc:  # noqa: BLE001 — label is best-effort
        print(f"  ! deal label lookup failed: {exc}", file=sys.stderr)
        _deal_label_id_cache = None
    return _deal_label_id_cache


def _search_deal_by_title(token: str, title: str) -> Optional[int]:
    """Return an existing deal id with this exact title (avoids duplicate deals
    when the same email is re-read, e.g. after a Railway restart)."""
    if not title:
        return None
    q = urllib.parse.urlencode({"api_token": token, "term": title, "fields": "title", "limit": 5})
    try:
        items = ((_get(f"{_BASE}/deals/search?{q}").get("data") or {}).get("items")) or []
        for it in items:
            if (it["item"].get("title") or "").strip().lower() == title.strip().lower():
                return it["item"]["id"]
    except Exception as exc:  # noqa: BLE001 — search is best-effort
        print(f"  ! deal search failed ({title}): {exc}", file=sys.stderr)
    return None


def create_deal(deal, dry_run: bool = True) -> dict:
    """Create a Pipedrive Deal in the Tracking pipeline (a deal we passed on but
    want to keep watching). Dedupes by title. `deal` is a broker_extract.Deal."""
    token = _token()
    existing = _search_deal_by_title(token, deal.title)
    if existing:
        return {"status": "exists", "deal_id": existing,
                "url": f"https://app.pipedrive.com/deal/{existing}"}

    owner_id = _owner_user_id(token)
    payload: dict = {"title": deal.title, "stage_id": _TRACK_STAGE_ID, "status": "open"}
    if deal.value:
        payload["value"] = deal.value
        payload["currency"] = "USD"
    if owner_id:
        payload["user_id"] = owner_id                    # deal owner = Raz

    if dry_run:
        label_id = _get_deal_label_id(token, create=False)   # don't create the option in a dry run
        preview = {**payload, **({"label": label_id} if label_id else {})}
        return {"status": "dry_run", "would_create": preview, "label": _LABEL, "note": deal.note[:200]}

    label_id = _get_deal_label_id(token, create=True)         # get-or-create "from-email" deal label
    if label_id:
        payload["label"] = label_id
    data = _post(f"{_BASE}/deals?api_token={token}", payload)
    if not data.get("success"):
        return {"status": "error", "error": data.get("error"), "payload": payload}
    did = data["data"]["id"]
    try:  # save the email as the deal's note so the context is there
        import html
        _post(f"{_BASE}/notes?api_token={token}",
              {"content": "<b>Tracked via email-intake-tool (passed, watching)</b><br>"
                          + html.escape(deal.note).replace("\n", "<br>"),
               "deal_id": did})
    except Exception as exc:  # noqa: BLE001
        print(f"  ! deal note failed for {did}: {exc}", file=sys.stderr)
    return {"status": "created", "deal_id": did,
            "url": f"https://app.pipedrive.com/deal/{did}"}


# --------------------------- attachments -> Pipedrive files ---------------------------
def upload_file(name: str, data: bytes, content_type: str = "application/octet-stream",
                *, deal_id: Optional[int] = None, person_id: Optional[int] = None) -> dict:
    """Upload one file (an email attachment) to Pipedrive, linked to a deal
    and/or person. Multipart built by hand to stay dependency-free (urllib)."""
    token = _token()
    boundary = "----eit" + uuid.uuid4().hex
    b = boundary.encode()
    parts: list[bytes] = []
    for key, val in (("deal_id", deal_id), ("person_id", person_id)):
        if val:
            parts.append(b"--" + b + b"\r\nContent-Disposition: form-data; name=\""
                         + key.encode() + b"\"\r\n\r\n" + str(val).encode() + b"\r\n")
    safe = (name or "attachment").replace('"', "'")
    parts.append(b"--" + b + b"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""
                 + safe.encode("utf-8") + b"\"\r\nContent-Type: "
                 + (content_type or "application/octet-stream").encode() + b"\r\n\r\n")
    parts.append(data)
    parts.append(b"\r\n--" + b + b"--\r\n")
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{_BASE}/files?api_token={token}", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
