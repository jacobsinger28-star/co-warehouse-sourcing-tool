# email → Pipedrive (broker intake pilot)

Forward or flag a broker email with a **keyword**, and the broker lands in
Pipedrive automatically — no manual data entry. Built for the off-market broker
intros (the deal sheets brokers email over) that never show up on Crexi/Colliers, so the
scrapers can't catch them.

## How it works

```
email (contains KEYWORD) ─► extract broker (Claude, regex fallback)
                          ─► dedupe in Pipedrive (email → cell → phone)
                          ─► create Person owned by Raz + a source note
```

It mirrors `general-scraping/backend/pipedrive.py` (`_find_or_create_broker_person`):
same dedupe order, same owner, same "never overwrite an existing contact" rule.
Consolidate into that module when the platforms merge.

## Setup

- **Pipedrive token** — reused automatically from `general-scraping/backend/.env`
  (or set `PIPEDRIVE_API_TOKEN`). Already working.
- **Claude key** (optional but recommended) — `export ANTHROPIC_API_KEY=...`.
  Without it, a regex fallback still pulls name/email/phone/firm from the
  signature; with it, Claude also parses the deals and messier sheets.
- **Keyword** — `export KEYWORD='#pipedrive'` (default). This is the opt-in: only
  emails containing it are processed.

## Run it

Single email (safe **dry run** by default — reads Pipedrive to dedupe, writes nothing):

```bash
python process_email.py --eml samples/sample_deal_sheet.eml          # shows what it WOULD create
python process_email.py --eml samples/sample_deal_sheet.eml --live    # actually create the Person
```

Watch a mailbox and add them automatically (the "without asking" mode):

```bash
IMAP_HOST=imap.gmail.com IMAP_USER=you@x.com IMAP_PASS='app-password' \
  python imap_watch.py --live --loop 60      # poll every 60s
```

`--live` is required to write; leave it off to watch in dry run first.

## Piloting on raz@simicap.com

The keyword rule Andrew described maps to an **Outlook rule**:

1. Pick a keyword (e.g. `#pipedrive`).
2. Rule: when a message contains the keyword → move it to a folder (say `To Pipedrive`).
3. Point the watcher at that folder: `python imap_watch.py --folder "To Pipedrive" --live --loop 120`.

**Microsoft 365 caveat:** most M365 tenants disable basic-auth IMAP, so
`imap_watch.py` can't log into `raz@simicap.com` directly with a password. Two
ways around it:

- **Easiest for the pilot:** have the Outlook rule *auto-forward* keyword'd mail
  to a mailbox that allows an app password (a Gmail with 2FA app password), and
  point the watcher there.
- **Production:** swap the IMAP poller for a Microsoft Graph subscription (watches
  the inbox server-side via OAuth, no forwarding). Same `extract → upsert` core;
  only the ingestion changes.

## Safety

- Dry run is the default everywhere; `--live` is the only thing that writes.
- Dedupe runs before every create, so re-processing an email won't duplicate a
  person.
- Every created Person gets a note tagging it `email-intake-tool` with the firm,
  markets, and deals, so intake is auditable.
