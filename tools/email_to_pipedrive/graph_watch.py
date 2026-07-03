#!/usr/bin/env python3
"""Watch your OWN Microsoft 365 mailbox folder and add brokers to Pipedrive.

M365 blocks basic-auth IMAP, so we read the mailbox the modern way: Microsoft
Graph with a one-time device-code sign-in (no client secret, no forwarding, no
spare mailbox). You approve it once at microsoft.com/devicelogin; the token is
cached locally so later runs are silent.

Folder-driven: it processes EVERY message in the target folder (default
"To Pipedrive"), so the keyword lives only in your Outlook rule — change the
rule anytime and this doesn't care.

Setup:
  1. Register an app (see REGISTER_GRAPH_APP.md) -> get a client id.
  2. pip install msal
  3. export GRAPH_CLIENT_ID=... ANTHROPIC_API_KEY=...   # Anthropic optional
  4. python graph_watch.py                 # dry run, one pass, signs you in
     python graph_watch.py --live --loop 120

Permissions requested: Mail.Read (delegated) — read-only on your mailbox.
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote, urlencode

from broker_extract import BrokerExtractor, extract_deal
from pipedrive_sync import upsert_broker, create_deal, upload_file

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = ["Mail.Read"]
# Non-secret identifiers for the "SimiCapital Email to Pipedrive Watcher" app
# registration (single-tenant, public client, Mail.Read). Safe to commit — these
# are public IDs, not credentials. Override via env if you re-register.
CLIENT_ID = os.getenv("GRAPH_CLIENT_ID", "2d3783b0-9454-4b79-aad5-258c5f8f20ab")
AUTHORITY = os.getenv("GRAPH_AUTHORITY",
                      "https://login.microsoftonline.com/25960412-5a50-44b0-879b-cb1bac0280b8")
# Each folder -> an action. "broker" creates a Person; "deal" creates a tracked
# Deal (something we passed on but want to watch). Override names via env.
FOLDERS = [
    (os.getenv("GRAPH_FOLDER", "To Pipedrive"), "broker"),
    (os.getenv("TRACK_FOLDER", "Tracked Deals"), "deal"),
]
HERE = Path(__file__).resolve().parent
CACHE = HERE / ".graph_token_cache.json"          # gitignored; holds the refresh token
SEEN = HERE / ".graph_seen_ids.json"              # message ids already processed


def _token() -> str:
    try:
        import msal
    except ImportError:
        sys.exit("pip install msal")
    if not CLIENT_ID:
        sys.exit("set GRAPH_CLIENT_ID (from your app registration)")
    cache = msal.SerializableTokenCache()
    if CACHE.exists():
        cache.deserialize(CACHE.read_text())
    elif os.getenv("GRAPH_TOKEN_CACHE"):        # seed from env on a headless host (Railway)
        cache.deserialize(os.getenv("GRAPH_TOKEN_CACHE"))
    app = msal.PublicClientApplication(CLIENT_ID, authority=AUTHORITY, token_cache=cache)

    result = None
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(SCOPES, account=accounts[0])
    if not result:
        if os.getenv("HEADLESS") or os.getenv("RAILWAY_ENVIRONMENT"):
            sys.exit("no valid cached token on a headless host — set GRAPH_TOKEN_CACHE "
                     "from a fresh local sign-in (see DEPLOY.md)")
        flow = app.initiate_device_flow(scopes=SCOPES)
        if "user_code" not in flow:
            sys.exit(f"device flow failed: {flow.get('error_description')}")
        print("\n== SIGN IN ONCE ==")
        print(flow["message"])          # "go to microsoft.com/devicelogin and enter CODE"
        print("==================\n")
        result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        sys.exit(f"auth failed: {result.get('error_description')}")
    if cache.has_state_changed:
        CACHE.write_text(cache.serialize())
        try:
            os.chmod(CACHE, 0o600)
        except OSError:
            pass
    return result["access_token"]


def _get(url: str, token: str) -> dict:
    req = Request(url, headers={"Authorization": f"Bearer {token}",
                                "Accept": "application/json"})
    with urlopen(req, timeout=20) as r:
        return json.load(r)


def _folder_id(token: str, name: str) -> str | None:
    # List top-level folders and match by name in Python (avoids URL-encoding an
    # OData $filter with spaces). Target folders are top-level.
    q = urlencode({"$top": 200, "$select": "id,displayName"}, quote_via=quote)
    for f in (_get(f"{GRAPH}/me/mailFolders?{q}", token).get("value") or []):
        if f.get("displayName") == name:
            return f["id"]
    return None


def _messages(token: str, folder_id: str) -> list[dict]:
    q = urlencode({
        "$select": "id,subject,from,body,bodyPreview,receivedDateTime,hasAttachments",
        "$orderby": "receivedDateTime desc",
        "$top": 25,
    }, quote_via=quote)
    return _get(f"{GRAPH}/me/mailFolders/{folder_id}/messages?{q}", token).get("value") or []


def _attachments(token: str, msg_id: str) -> list[tuple]:
    """An email's real file attachments as (filename, content_type, bytes),
    skipping inline signature images. Ready to upload to Pipedrive."""
    out: list[tuple] = []
    try:
        data = _get(f"{GRAPH}/me/messages/{msg_id}/attachments", token)
    except Exception as exc:  # noqa: BLE001
        print(f"    ! attachment fetch failed: {exc}", file=sys.stderr)
        return out
    for a in (data.get("value") or []):
        if a.get("@odata.type") != "#microsoft.graph.fileAttachment" or a.get("isInline"):
            continue
        cb = a.get("contentBytes")
        if not cb:
            continue
        try:
            out.append((a.get("name") or "attachment",
                        a.get("contentType") or "application/octet-stream",
                        base64.b64decode(cb)))
        except Exception:  # noqa: BLE001
            continue
    return out


def _html_to_text(s: str) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)                      # &lt; &gt; &amp; &nbsp; -> < > & space
    return re.sub(r"[ \t]+", " ", s).strip()


def _load_seen() -> set[str]:
    if SEEN.exists():
        try:
            return set(json.loads(SEEN.read_text()))
        except Exception:
            return set()
    return set()


def _save_seen(seen: set[str]) -> None:
    SEEN.write_text(json.dumps(sorted(seen)))


def _one_pass(token: str, live: bool, extractor: BrokerExtractor) -> None:
    seen = _load_seen()
    changed = False
    for name, action in FOLDERS:
        fid = _folder_id(token, name)
        if not fid:
            continue                              # folder not created yet — skip quietly
        msgs = _messages(token, fid)
        fresh = [m for m in msgs if m["id"] not in seen]
        print(f"[{name}] {len(msgs)} message(s), {len(fresh)} new")
        batch: set[str] = set()                   # in-run dedupe vs. Pipedrive search lag
        for m in fresh:
            subject = m.get("subject") or ""
            frm = (m.get("from") or {}).get("emailAddress") or {}
            body = m.get("body") or {}
            text = _html_to_text(body.get("content", "")) if body.get("contentType") == "html" \
                else (body.get("content") or m.get("bodyPreview") or "")
            if action == "deal":
                deal = extract_deal(subject=subject, body=text,
                                    from_name=frm.get("name", ""), from_email=frm.get("address", ""))
                if deal.title.lower() in batch:
                    seen.add(m["id"]); changed = True; continue
                res = create_deal(deal, dry_run=not live)
                batch.add(deal.title.lower())
                print(f"  - deal {res['status']}: {deal.title[:60]} {res.get('url', '')}")
            else:
                broker = extractor.extract(subject=subject, body=text,
                                           from_name=frm.get("name", ""), from_email=frm.get("address", ""))
                if not broker.is_actionable():
                    print(f"  - skip (no broker): {subject[:60]}")
                    seen.add(m["id"]); changed = True; continue
                ekey = (broker.email or "").lower()
                if ekey and ekey in batch:
                    print(f"  - skip (dup in batch): {broker.name or broker.email}")
                    seen.add(m["id"]); changed = True; continue
                res = upsert_broker(broker, dry_run=not live)
                if ekey:
                    batch.add(ekey)
                print(f"  - {res['status']}: {broker.name or broker.email} {res.get('url', '')}")
            # upload the email's attachments onto the newly created record
            if res.get("status") == "created" and m.get("hasAttachments"):
                for fname, ctype, fdata in _attachments(token, m["id"]):
                    try:
                        up = upload_file(fname, fdata, ctype,
                                         deal_id=res.get("deal_id"), person_id=res.get("person_id"))
                        print(f"    + file {fname}: {'ok' if up.get('success') else up.get('error')}")
                    except Exception as exc:  # noqa: BLE001
                        print(f"    ! file {fname} failed: {exc}", file=sys.stderr)
            if res.get("status") != "error":
                seen.add(m["id"]); changed = True
    if changed:
        _save_seen(seen)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="write to Pipedrive")
    ap.add_argument("--loop", type=int, default=0, help="poll every N seconds (0 = one pass)")
    args = ap.parse_args()
    token = _token()
    extractor = BrokerExtractor()
    folders = ", ".join(f"{n} ({a})" for n, a in FOLDERS)
    print(f"watching {folders} [{'LIVE' if args.live else 'DRY-RUN'}]")
    while True:
        try:
            token = _token()          # refreshes silently from cache
            _one_pass(token, args.live, extractor)
        except Exception as exc:  # noqa: BLE001 — keep the watcher alive
            print(f"! pass failed: {exc}", file=sys.stderr)
        if args.loop <= 0:
            break
        time.sleep(args.loop)


if __name__ == "__main__":
    main()
