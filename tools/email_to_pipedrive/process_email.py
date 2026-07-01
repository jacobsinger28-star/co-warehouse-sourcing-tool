#!/usr/bin/env python3
"""Keyword-gated: read one email, pull out the broker, add them to Pipedrive.

The pilot rule (per Andrew): only act on emails that contain a KEYWORD, so you
opt an email in by putting the keyword in it (or an Outlook rule forwards those).

Inputs (any one):
    --eml path/to/message.eml           # a saved raw email
    --body-file body.txt [--from ..] [--subject ..]
    --from ".." --subject ".." --body ".."
    (or pipe a raw RFC822 email on stdin)

Nothing hits Pipedrive unless you pass --live (default is a dry run that prints
exactly what WOULD be created).

    python process_email.py --eml sample.eml               # dry run
    python process_email.py --eml sample.eml --live         # actually create
    KEYWORD='#lead' python process_email.py --eml sample.eml
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from email import message_from_binary_file, message_from_string
from email.utils import parseaddr

from broker_extract import BrokerExtractor
from pipedrive_sync import upsert_broker

DEFAULT_KEYWORD = os.getenv("KEYWORD", "#pipedrive")


def _plain_body(msg) -> str:
    if msg.is_multipart():
        # prefer text/plain
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                try:
                    return part.get_content()
                except Exception:
                    return (part.get_payload(decode=True) or b"").decode("utf-8", "replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html" and not part.get_filename():
                import re
                raw = (part.get_payload(decode=True) or b"").decode("utf-8", "replace")
                return re.sub(r"<[^>]+>", " ", raw)
        return ""
    try:
        return msg.get_content()
    except Exception:
        return (msg.get_payload(decode=True) or b"").decode("utf-8", "replace")


def _from_eml(path_or_stdin) -> tuple[str, str, str, str]:
    if path_or_stdin == "-":
        msg = message_from_string(sys.stdin.read())
    else:
        with open(path_or_stdin, "rb") as f:
            msg = message_from_binary_file(f)
    from_name, from_email = parseaddr(msg.get("From", ""))
    return from_name, from_email, msg.get("Subject", "") or "", _plain_body(msg)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eml", help="path to a raw .eml file, or - for stdin")
    ap.add_argument("--from", dest="from_", default="")
    ap.add_argument("--subject", default="")
    ap.add_argument("--body", default="")
    ap.add_argument("--body-file")
    ap.add_argument("--keyword", default=DEFAULT_KEYWORD)
    ap.add_argument("--live", action="store_true", help="actually write to Pipedrive")
    ap.add_argument("--no-keyword", action="store_true", help="skip the keyword gate")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    if args.eml or not sys.stdin.isatty() and not (args.from_ or args.body or args.body_file):
        from_name, from_email, subject, body = _from_eml(args.eml or "-")
    else:
        from_name, from_email = parseaddr(args.from_)
        subject = args.subject
        body = args.body
        if args.body_file:
            body = open(args.body_file).read()

    haystack = f"{subject}\n{body}".lower()
    if not args.no_keyword and args.keyword.lower() not in haystack:
        out = {"status": "skipped", "reason": f"keyword {args.keyword!r} not found"}
        print(json.dumps(out) if args.json else f"SKIP — keyword {args.keyword!r} not in email")
        return

    broker = BrokerExtractor().extract(
        subject=subject, body=body, from_name=from_name, from_email=from_email,
    )
    if not broker.is_actionable():
        out = {"status": "no_broker", "extractor": broker.extractor}
        print(json.dumps(out) if args.json else "NO BROKER — nothing to add")
        return

    result = upsert_broker(broker, dry_run=not args.live)

    if args.json:
        print(json.dumps({"broker": broker.as_dict(), "result": result}, indent=2))
        return

    print(f"\nExtracted via: {broker.extractor}")
    print(f"  name    : {broker.name}")
    print(f"  company : {broker.company}")
    print(f"  email   : {broker.email}")
    print(f"  cell    : {broker.cell}")
    print(f"  phone   : {broker.phone}")
    if broker.markets:
        print(f"  markets : {', '.join(broker.markets)}")
    if broker.deals:
        print(f"  deals   : {len(broker.deals)}")
        for d in broker.deals[:6]:
            print(f"            - {d.get('summary','')[:80]} {d.get('price') or ''}")
    print(f"\nPipedrive: {result['status'].upper()}")
    if result["status"] == "dry_run":
        print("  (dry run — nothing written. re-run with --live to create)")
        print("  payload:", json.dumps(result["would_create"]))
    elif result["status"] in ("created", "exists"):
        print(f"  person id {result['person_id']}  {result['url']}")
    elif result["status"] == "error":
        print(f"  ERROR: {result.get('error')}")


if __name__ == "__main__":
    main()
