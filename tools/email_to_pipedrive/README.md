# email → Pipedrive (intake pilot)

Tag or forward an email with a **hashtag**, and it lands in Pipedrive
automatically — no manual data entry. Built for the off-market broker intros (the
deal sheets brokers email over) that never show up on Crexi/Colliers, so the
scrapers can't catch them.

## Flows

One hashtag per intake type. An Outlook rule on the simicap account matches the
hashtag and moves the mail into a folder; the watcher (`graph_watch.py`) acts on
the folder. Tag an email and it's in Pipedrive a couple of minutes later.

| Hashtag     | Outlook folder   | Creates in Pipedrive                                       |
|-------------|------------------|------------------------------------------------------------|
| `#broker`   | To Pipedrive     | **Person** (broker contact) — deduped, owned by Raz        |
| `#track`    | Tracked Deals    | **Deal** in the **Tracking** pipeline (passed, watching)   |
| `#deal`     | Deals            | **Deal** in the **Tracking** pipeline — same as `#track`   |
| `#pipeline` | Pipeline Deals   | **Deal** in the **main deal pipeline** (an active deal)     |

Deals take the subject as the title, the first dollar amount as the value, and
the whole email as the deal note (any attachments upload onto the record). Folder
names are overridable via env (`GRAPH_FOLDER`, `TRACK_FOLDER`, `DEAL_FOLDER`,
`PIPELINE_FOLDER`); pipeline/stage ids via `PIPELINE_ID` / `PIPELINE_STAGE_ID` /
`TRACK_STAGE_ID`. The main-pipeline ids (pipeline 5, "Screened" stage 22) match
what `general-scraping/backend/pipedrive.py` pushes scored deals into.

**Turning the two new flows on** (one-time, in the raz@simicap.com Outlook — the
watcher needs no redeploy, it picks up the folders on its next poll):
1. Create two folders: **Deals** and **Pipeline Deals**.
2. Add two "move to folder" rules mirroring the existing `#broker` / `#track`
   ones: subject or body contains `#deal` → *Deals*; contains `#pipeline` →
   *Pipeline Deals*. (`#deal` can instead point at the existing *Tracked Deals*
   folder — both folders map to the same action.)

## How it works (broker flow shown; deals follow the same path)

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

Watch your mailbox automatically (the "without asking" mode). On Microsoft 365
use the **Graph watcher** (set up below). The IMAP watcher is only for mailboxes
that allow an app password (e.g. Gmail):

```bash
python graph_watch.py --live --loop 30       # your M365 mailbox via Graph
# or an app-password mailbox:
IMAP_HOST=imap.gmail.com IMAP_USER=you@x.com IMAP_PASS='app-password' \
  python imap_watch.py --live --loop 60
```

`--live` is required to write; leave it off to watch in dry run first.

## Piloting on raz@simicap.com  (set up 2026-07-01)

Both pieces are live:

1. **Outlook rule "Send to Pipedrive"** (server-side, on the simicap account):
   subject or body contains `#pipedrive` → move to the **To Pipedrive** folder.
   Change the keyword anytime by editing the rule — the watcher is folder-driven
   and doesn't care what it is.

2. **Graph watcher** (`graph_watch.py`) reads that folder straight from your own
   mailbox: no forwarding, no spare inbox. It signs in once via device code
   (Mail.Read, read-only); the token caches to `.graph_token_cache.json`
   (gitignored) so later runs are silent.

   Entra app registration — single tenant, public client, Mail.Read. These are
   public IDs (not secrets), baked in as defaults in `graph_watch.py`:
   - client id `2d3783b0-9454-4b79-aad5-258c5f8f20ab`
   - tenant    `25960412-5a50-44b0-879b-cb1bac0280b8`

   Needs `pip install msal`. Run `python graph_watch.py --live --loop 30`. To
   keep it running unattended, wrap it in a launchd/systemd service or cron loop.

## Safety

- Dry run is the default everywhere; `--live` is the only thing that writes.
- Dedupe runs before every create, so re-processing an email won't duplicate a
  person.
- Every created Person gets a note tagging it `email-intake-tool` with the firm,
  markets, and deals, so intake is auditable.
