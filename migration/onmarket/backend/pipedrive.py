"""Pipedrive API client — creates deals in the Industrial pipeline."""
from __future__ import annotations
import json
import logging
import os
import re

import requests

logger = logging.getLogger(__name__)

PIPEDRIVE_API_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN", "")
_BASE = "https://api.pipedrive.com/v1"

# EasyBay pipeline, "Screened" stage
_STAGE_ID    = 22
_PIPELINE_ID = 5

# ── Custom deal field keys (all 18 Pipedrive fields) ────────────────────────
_CF = {
    "address":          "c62e578cfe04b09a6e77a963194fa9ca2e008842",
    "asset_class":      "3beba667bf68e883baa18069cac2ad2dacc4d1b0",
    "market_msa":       "e5c41e5a62c3bfc3ea3a2b2648a67402dec04145",
    "building_size":    "f07b2c15aa29ce250a1483b062a21a108b1e0d6e",
    "clear_height":     "ae57ace271992b0a37e314cc5ea6bba2ed7d3eef",
    "dock_doors":       "ef5004e7eb6c69f7a70f0940f14ab58f30990313",
    "grade_doors":      "d3659bbc24073fadc149e27db4c81949f351fc4b",
    "sprinkler":        "0fe0c0b672f4589e95d394e02f795fbabc9b7282",
    "office_pct":       "e9a4f32564b0d3921e9a7136aa2ad297c2fe25af",
    "parking_ratio":    "028d7f09e67640b0fc0ea3c1878e305d03f92944",
    "power_capacity":   "3c0520febfd72151c18779761afc005058c2c33b",
    "hvac":             "c540c2e68766380bfdb9c5bf98253c1ef5a41c79",
    "food_access":      "4323492d2dbdc808c45ed5d2ee69314ae8b5728f",
    "truck_access":     "9ac28a18f4778e1c58c9aaff5b824fa7f3ef882a",
    "zoning":           "de51571864d2bcb39de5b59c392e94c30e77de1f",
    "condition":        "0d61a200b479a4e8266745504612f8fae48931e9",
    "lease_type":       "4fd6eab6761c3ffdfe61dc400352f89f5441b246",
    "implied_ppsf":     "d4ac10b32981ccd91f6c194b7e31d2ff5bd5e986",
    "market_gross_rent": "ac75e67c81ea0da5910942a3c808d975412f4436",
}

# ── Pipedrive user lookup (name → user_id) ──────────────────────────────────
_USERS = {
    "aaron":          24697860,
    "andrew skydell": 24680623,
    "andrew":         24680623,
    "jacob diamond":  24856073,
    "jake singer":    24856062,
    "jake":           24856062,
    "jacob":          24856062,
    "jonathan":       24632003,
    "jon":            24632003,
    "kory barbanel":  24605801,
    "kory":           24605801,
}

def _resolve_user_id(analyst_name: str) -> int | None:
    key = analyst_name.strip().lower()
    return _USERS.get(key)


# ── Scorer canonical name → CF key + type ───────────────────────────────────
# (column names after _normalise() in scorer.py)
_FIELD_MAP: list[tuple[str, str, str]] = [
    # (scorer_col,           cf_key,             type)
    ("address",              "address",           "str"),
    ("asset_class",          "asset_class",       "str"),
    ("market_msa",           "market_msa",        "str"),
    ("total_sf",             "building_size",     "float"),
    ("clear_height",         "clear_height",      "float"),
    ("loading_docks",        "dock_doors",        "float"),
    ("grade_doors",          "grade_doors",       "float"),
    ("sprinklered",          "sprinkler",         "str"),
    ("office_pct",           "office_pct",        "float"),
    ("parking_ratio",        "parking_ratio",     "float"),
    ("power",                "power_capacity",    "str"),
    ("hvac",                 "hvac",              "str"),
    ("food_access",          "food_access",       "str"),
    ("truck_court_depth",    "truck_access",      "str"),
    ("zoning",               "zoning",            "str"),
    ("condition",            "condition",         "str"),
    ("lease_type",           "lease_type",        "str"),
    ("Implied_Purchase_Price", "implied_ppsf",    "float"),
    ("market_gross_rent_small_bay", "market_gross_rent", "float"),
]


def _val(row: dict, key: str):
    v = row.get(key)
    return None if v in (None, "", "—", "nan", float("nan")) else v


# ── Broker contact (Pipedrive Person) ───────────────────────────────────────
# The broker captured by the scraper becomes a Pipedrive Person linked to the
# deal, so the team can call them straight from the deal. New Person records are
# owned by the API token's own user (Raz). Existing Persons are reused as-is —
# we never overwrite an existing contact's phone number.

_UNSET = object()
_owner_id_cache = _UNSET   # token owner's user_id, resolved once per process
_label_id_cache = _UNSET   # "on-market-scrapping-tool" Person label option id
_source_key_cache = _UNSET  # custom "Source Listing" Person field key

# Every broker this tool creates is tagged with this Person label so they're
# easy to find/filter in Pipedrive.
_TOOL_LABEL = "on-market-scrapping-tool"
# Custom Person field holding the source listing URL (clickable in the contact).
_SOURCE_FIELD_NAME = "Source Listing"


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def _is_listing_link(url: str | None) -> bool:
    """True only for a real, server-resolvable listing page. Excludes the
    synthetic '#teaser' surrogates the Colliers scraper fabricates for listings
    with no public detail page ('Call broker') — those load a generic page."""
    u = str(url or "")
    return u.startswith("http") and "#teaser" not in u


def _get_tool_label_id() -> int | None:
    """Resolve the Person 'label' option used to tag tool-created brokers,
    creating it (preserving existing options) if absent. Cached per process."""
    global _label_id_cache
    if _label_id_cache is not _UNSET:
        return _label_id_cache
    _label_id_cache = None
    try:
        def _label_field() -> dict | None:
            resp = requests.get(
                f"{_BASE}/personFields",
                params={"api_token": PIPEDRIVE_API_TOKEN},
                timeout=10,
            )
            resp.raise_for_status()
            return next(
                (f for f in (resp.json().get("data") or []) if f.get("key") == "label"),
                None,
            )

        field = _label_field()
        if not field:
            return None
        opts = field.get("options") or []
        match = next((o for o in opts if o.get("label") == _TOOL_LABEL), None)
        if match:
            _label_id_cache = match["id"]
            return _label_id_cache

        # Add the option, keeping every existing one (id + label) intact.
        new_opts = [{"id": o["id"], "label": o["label"]} for o in opts]
        new_opts.append({"label": _TOOL_LABEL})
        requests.put(
            f"{_BASE}/personFields/{field['id']}",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json={"options": new_opts},
            timeout=10,
        ).raise_for_status()
        field2 = _label_field() or {}
        _label_id_cache = next(
            (o["id"] for o in (field2.get("options") or []) if o.get("label") == _TOOL_LABEL),
            None,
        )
    except Exception as exc:  # noqa: BLE001 — label is best-effort, never blocks
        logger.warning("Pipedrive label lookup failed: %s", exc)
        _label_id_cache = None
    return _label_id_cache


def _get_owner_user_id() -> int | None:
    """Pipedrive user who owns the API token (Raz) — used as the owner of newly
    created broker Person records. Resolved once via /users/me, then cached."""
    global _owner_id_cache
    if _owner_id_cache is not _UNSET:
        return _owner_id_cache
    try:
        resp = requests.get(
            f"{_BASE}/users/me",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            timeout=10,
        )
        resp.raise_for_status()
        _owner_id_cache = (resp.json().get("data") or {}).get("id")
    except Exception as exc:  # noqa: BLE001 — owner is best-effort
        logger.warning("Pipedrive /users/me lookup failed: %s", exc)
        _owner_id_cache = None
    return _owner_id_cache


def _get_source_field_key() -> str | None:
    """Resolve (creating if needed) the custom Person field that stores the
    source listing URL. Returns its API key. Cached per process."""
    global _source_key_cache
    if _source_key_cache is not _UNSET:
        return _source_key_cache
    _source_key_cache = None
    try:
        resp = requests.get(
            f"{_BASE}/personFields",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            timeout=10,
        )
        resp.raise_for_status()
        fld = next(
            (f for f in (resp.json().get("data") or []) if f.get("name") == _SOURCE_FIELD_NAME),
            None,
        )
        if fld:
            _source_key_cache = fld["key"]
            return _source_key_cache
        created = requests.post(
            f"{_BASE}/personFields",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json={"name": _SOURCE_FIELD_NAME, "field_type": "varchar"},
            timeout=10,
        )
        created.raise_for_status()
        _source_key_cache = (created.json().get("data") or {}).get("key")
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning("Pipedrive source field lookup failed: %s", exc)
        _source_key_cache = None
    return _source_key_cache


def _search_person(term: str | None, field: str) -> int | None:
    """Return the id of an existing Person matching `term` on `field`
    ('email' or 'phone'), or None. Used to avoid creating duplicates."""
    if not term:
        return None
    try:
        resp = requests.get(
            f"{_BASE}/persons/search",
            params={
                "api_token": PIPEDRIVE_API_TOKEN,
                "term": term,
                "fields": field,
                "exact_match": "true" if field == "email" else "false",
                "limit": 1,
            },
            timeout=10,
        )
        resp.raise_for_status()
        items = ((resp.json().get("data") or {}).get("items")) or []
        if items:
            return items[0]["item"]["id"]
    except Exception as exc:  # noqa: BLE001 — search is best-effort
        logger.warning("Pipedrive person search failed (%s=%s): %s", field, term, exc)
    return None


def _row_raw_extra(row: dict) -> dict:
    """Return the listing's raw_data as a dict. The DB stores it as a JSON
    string; a fresh scrape may pass it as a dict. Returns {} on anything else.
    Used to recover Crexi-only fields (brokerage, broker profile URL) that have
    no dedicated DB column."""
    raw = row.get("raw_data")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def _add_source_note(
    person_id: int,
    address: str | None,
    url: str | None,
    brokerage: str | None = None,
    profile_url: str | None = None,
):
    """Attach a note linking the source listing, so the contact is verifiable.
    Includes the brokerage + a clickable broker profile when known (Crexi),
    since Crexi doesn't expose the broker's phone/email directly."""
    if not (address or url or brokerage or profile_url):
        return
    import html as _html
    label = _html.escape(address or "on-market listing")
    if _is_listing_link(url):
        u = _html.escape(str(url))
        # Show the full URL as visible (and clickable) text so it can be read/copied.
        body = f'{label} — <a href="{u}">{u}</a>'
    else:
        # No public detail page ("Call broker" teaser) — show address only.
        body = f"{label} — no public listing page (Call broker)"
    extras: list[str] = []
    if brokerage:
        extras.append(f"Brokerage: {_html.escape(str(brokerage))}")
    if _is_listing_link(profile_url):
        p = _html.escape(str(profile_url))
        extras.append(f'Broker profile: <a href="{p}">{p}</a>')
    if extras:
        body += "<br>" + " · ".join(extras)
    content = (f"<b>Source</b> (scraped via {_TOOL_LABEL}): {body}")
    try:
        requests.post(
            f"{_BASE}/notes",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json={"content": content, "person_id": person_id},
            timeout=10,
        ).raise_for_status()
    except Exception as exc:  # noqa: BLE001 — note is best-effort
        logger.warning("Pipedrive source note failed for person %s: %s", person_id, exc)


def _find_or_create_broker_person(
    name: str | None,
    email: str | None,
    phone: str | None,
    cell: str | None,
    source_url: str | None = None,
    source_address: str | None = None,
    brokerage: str | None = None,
    profile_url: str | None = None,
) -> int | None:
    """Find or create the broker as a Pipedrive Person and return its id.

    - Reuses an existing Person (matched by email, then cell, then phone) and
      leaves it untouched — we never overwrite an existing contact's phone.
    - Otherwise creates a new Person owned by Raz, with the cell flagged as the
      primary 'mobile' number and the listed phone as a 'work' number.
    """
    if not (name or email or phone or cell):
        return None

    existing = (
        _search_person(email, "email")
        or _search_person(cell, "phone")
        or _search_person(phone, "phone")
    )
    if existing:
        return existing

    phones: list[dict] = []
    if cell:
        phones.append({"value": cell, "primary": True, "label": "mobile"})
    if phone and _digits(phone) != _digits(cell):
        phones.append({"value": phone, "primary": not bool(cell), "label": "work"})

    payload: dict = {"name": name or "Listing Broker"}
    owner_id = _get_owner_user_id()
    if owner_id:
        payload["owner_id"] = owner_id
    label_id = _get_tool_label_id()
    if label_id:
        payload["label"] = label_id
    if _is_listing_link(source_url):
        src_key = _get_source_field_key()
        if src_key:
            payload[src_key] = source_url
    if phones:
        payload["phone"] = phones
    if email:
        payload["email"] = [{"value": email, "primary": True, "label": "work"}]

    try:
        resp = requests.post(
            f"{_BASE}/persons",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json=payload,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("success"):
            new_id = data["data"]["id"]
            _add_source_note(new_id, source_address, source_url, brokerage, profile_url)
            return new_id
        logger.warning("Pipedrive person create failed: %s", data.get("error"))
    except Exception as exc:  # noqa: BLE001 — contact is best-effort, never blocks the deal
        logger.warning("Pipedrive person create error: %s", exc)
    return None


def create_deal(row: dict, analyst_name: str = "") -> dict:
    """POST a single deal to Pipedrive. Returns the created deal dict."""
    if not PIPEDRIVE_API_TOKEN:
        raise EnvironmentError("PIPEDRIVE_API_TOKEN is not set.")

    address = _val(row, "address") or "Unknown Property"
    total_sf = _val(row, "total_sf")
    implied_psf = _val(row, "Implied_Purchase_Price")

    sf_str = f" — {int(float(total_sf)):,} SF" if total_sf else ""
    title  = f"{address}{sf_str}"

    payload: dict = {
        "title":       title,
        "stage_id":    _STAGE_ID,
        "pipeline_id": _PIPELINE_ID,
    }

    user_id = _resolve_user_id(analyst_name) if analyst_name else None
    if user_id:
        payload["user_id"] = user_id

    # Implied purchase price as deal value
    try:
        if implied_psf and total_sf:
            payload["value"]    = round(float(implied_psf) * float(total_sf))
            payload["currency"] = "USD"
    except (ValueError, TypeError):
        pass

    # Map all 18 Pipedrive fields
    for scorer_col, cf_name, typ in _FIELD_MAP:
        v = _val(row, scorer_col)
        if v is None:
            continue
        cf_key = _CF[cf_name]
        try:
            if typ == "float":
                payload[cf_key] = float(v)
            else:
                payload[cf_key] = str(v)
        except (ValueError, TypeError):
            payload[cf_key] = str(v)

    # Link the listing broker as the deal's contact Person (with phone numbers).
    # Crexi-only extras (brokerage, broker profile URL) live in raw_data.
    extra = _row_raw_extra(row)
    person_id = _find_or_create_broker_person(
        _val(row, "broker_name"),
        _val(row, "broker_email"),
        _val(row, "broker_phone"),
        _val(row, "broker_cell"),
        source_url=_val(row, "listing_url"),
        source_address=_val(row, "address"),
        brokerage=extra.get("broker_brokerage"),
        profile_url=extra.get("broker_profile_url"),
    )
    if person_id:
        payload["person_id"] = person_id

    resp = requests.post(
        f"{_BASE}/deals",
        params={"api_token": PIPEDRIVE_API_TOKEN},
        json=payload,
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"Pipedrive error: {data.get('error', 'unknown')}")
    deal = data["data"]

    # Attach notes column as a Pipedrive note on the deal
    notes_val = _val(row, "notes")
    if notes_val:
        requests.post(
            f"{_BASE}/notes",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json={"content": str(notes_val), "deal_id": deal["id"]},
            timeout=10,
        )

    return deal
