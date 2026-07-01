#!/usr/bin/env python3
"""Watch a mailbox and auto-add keyword'd broker emails to Pipedrive.

This is the "without asking" version: it polls INBOX for unread messages that
contain the KEYWORD, runs each through the same extract -> dedupe -> create
pipeline, then marks them read so they aren't processed twice.

    IMAP_HOST=imap.gmail.com IMAP_USER=you@x.com IMAP_PASS='app-password' \
    KEYWORD='#pipedrive' python imap_watch.py                 # dry run, one pass
    ... python imap_watch.py --live --loop 60                  # create, poll 60s

Note on raz@simicap.com: Microsoft 365 disables basic-auth IMAP on most tenants,
so either (a) point an Outlook rule to auto-forward keyword'd mail to a mailbox
that DOES allow an app password (e.g. a Gmail with 2FA app password) and watch
that, or (b) use the Microsoft Graph path (see README) instead of IMAP.
"""
from __future__ import annotations

import argparse
import email
import imaplib
import os
import sys
import time
from email.utils import parseaddr

from broker_extract import BrokerExtractor
from pipedrive_sync import upsert_broker
from process_email import _plain_body

KEYWORD = os.getenv("KEYWORD", "#pipedrive")


def _process_one(raw: bytes, extractor: BrokerExtractor, keyword: str, live: bool) -> str:
    msg = email.message_from_bytes(raw)
    subject = msg.get("Subject", "") or ""
    body = _plain_body(msg)
    if keyword.lower() not in f"{subject}\n{body}".lower():
        return "skip (no keyword)"
    from_name, from_email = parseaddr(msg.get("From", ""))
    broker = extractor.extract(subject=subject, body=body,
                               from_name=from_name, from_email=from_email)
    if not broker.is_actionable():
        return "skip (no broker)"
    res = upsert_broker(broker, dry_run=not live)
    tag = res["status"]
    who = broker.name or broker.email
    if res.get("person_id"):
        return f"{tag}: {who} -> {res['url']}"
    return f"{tag}: {who}"


def _pass(host, user, pw, folder, keyword, live, extractor) -> int:
    m = imaplib.IMAP4_SSL(host)
    m.login(user, pw)
    m.select(folder)
    # server-side narrowing to unread + keyword; body match is re-checked locally
    typ, data = m.search(None, "UNSEEN", "TEXT", keyword)
    ids = data[0].split() if data and data[0] else []
    print(f"[{folder}] {len(ids)} unread candidate(s)")
    n = 0
    for i in ids:
        typ, msgdata = m.fetch(i, "(RFC822)")
        if typ != "OK" or not msgdata or not msgdata[0]:
            continue
        result = _process_one(msgdata[0][1], extractor, keyword, live)
        print(f"  - {result}")
        if live:
            m.store(i, "+FLAGS", "\\Seen")   # only consume it once we actually acted
        n += 1
    m.logout()
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", default="INBOX")
    ap.add_argument("--keyword", default=KEYWORD)
    ap.add_argument("--live", action="store_true", help="write to Pipedrive + mark read")
    ap.add_argument("--loop", type=int, default=0, help="poll every N seconds (0 = one pass)")
    args = ap.parse_args()

    host = os.getenv("IMAP_HOST"); user = os.getenv("IMAP_USER"); pw = os.getenv("IMAP_PASS")
    if not (host and user and pw):
        sys.exit("set IMAP_HOST, IMAP_USER, IMAP_PASS")

    extractor = BrokerExtractor()
    mode = "LIVE" if args.live else "DRY-RUN"
    print(f"watching {user}/{args.folder} for {args.keyword!r} [{mode}]")
    while True:
        try:
            _pass(host, user, pw, args.folder, args.keyword, args.live, extractor)
        except Exception as exc:  # noqa: BLE001 — keep the watcher alive
            print(f"  ! pass failed: {exc}", file=sys.stderr)
        if args.loop <= 0:
            break
        time.sleep(args.loop)


if __name__ == "__main__":
    main()
