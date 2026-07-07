# Session log — email → Pipedrive intake watcher (`#broker` / `#track`)

**Date:** 2026-07-07
**Area:** `tools/email_to_pipedrive/` (new), Railway deploy, Outlook rules, Pipedrive
**Outcome:** a 24/7 autonomous pipeline — forward an email with a keyword, it lands
in Pipedrive on its own. Plus a deferred decision on real data in the frontend.

---

## What we set out to do

Started as "scrape all the brokers in Tampa and see if you can find one specific
person." That surfaced a bigger truth and led to building the intake tool.

### Broker search finding (the "why we couldn't find him")

- Reused the on-market Crexi/Colliers path to scrape brokers by metro.
- Tampa Bay: 1,532 listings → 955 brokers. Target ("Michael/Mike Correa") absent.
- Widened to his real markets — South Florida tri-county + SW FL — across Crexi +
  Colliers: **~7,000 listings, 4,556 brokers.** Still absent.
- **Conclusion:** he's an off-market intermediary (JMS Premier Builder's, NYC),
  not a marketplace listing broker. Listing-derived scraping is structurally blind
  to off-market principals — regardless of geography or source. His email
  (`jmsbuilders555@yahoo.com`) resolved his identity in seconds where 11k listings
  could not. **The gap this exposed is exactly what the intake tool fills.**

---

## The deliverable: `tools/email_to_pipedrive/`

Forward an email with a keyword → it's created in Pipedrive automatically, with no
manual step. Two flows, one watcher.

| Forward with | Creates | Where | Owner | Label |
|---|---|---|---|---|
| `#broker` | Person (broker) | contacts | Raz | `from-email` |
| `#track`  | Deal (passed but tracking) | **Tracking** pipeline (id 7 / stage 33) | Raz | `from-email` |

Both also: save the **full forwarded email as a note**, and **upload the email's
attachments** (flyers/OMs) as files on the record. Dedupe on person email / deal
title; an in-batch guard prevents duplicates from Pipedrive's search-index lag.

### Files
- `broker_extract.py` — extract broker + deals from a messy email (Claude via
  `ANTHROPIC_API_KEY`, regex fallback). Forward-aware: pulls the *original* sender,
  not the forwarder. Decodes HTML entities.
- `pipedrive_sync.py` — dedupe + create Person/Deal, owner Raz, `from-email` label
  (person + deal fields), source note with the full email, `upload_file()` for
  attachments. Mirrors `general-scraping/backend/pipedrive.py` conventions.
- `graph_watch.py` — the watcher. Reads the Outlook folders via **Microsoft Graph**
  (device-code auth, read-only `Mail.Read`), folder-driven so the keyword lives only
  in the Outlook rule. Polls every 30s. Loop + attachment upload + dedupe.
- `process_email.py`, `imap_watch.py` — CLI / IMAP alternatives.
- `README.md`, `DEPLOY.md` — usage + Railway deploy.

### Infra set up this session
- **Entra app registration** "SimiCapital Email to Pipedrive Watcher"
  (client `2d3783b0-9454-4b79-aad5-258c5f8f20ab`, tenant `25960412-…-cb1bac0280b8`,
  single-tenant, public client / device-code, `Mail.Read` delegated).
- **Outlook rules** on raz@simicap.com: `#broker` → "To Pipedrive" folder,
  `#track` → "Tracked Deals" folder.
- **Railway service** `content-celebration` in project `gracious-reprieve`
  (Singer's account), deploying `tools/email_to_pipedrive` from the
  `email-to-pipedrive-watcher` branch, `--loop 30`, restart-always. Secrets set as
  Railway variables: `GRAPH_TOKEN_CACHE`, `PIPEDRIVE_API_TOKEN`.

### Verified working (autonomously, not by hand)
- Broker: Michael Correa → person **5856** (owner Raz, `from-email`, note). One
  clean contact, dedupe confirmed.
- Deal: "Confidential Off-Market 100K SF Small Bay Industrial Portfolio" → deal
  **192** in Tracking (owner Raz, `from-email` applied). Note attached.
- Railway logs show the watcher polling both folders every 30s with no operator.

### Fixes along the way
- Frontend Railway service was failing to build — **Root Directory** was unset;
  set it to `frontend`. (Unrelated to the email tool; it just surfaced on redeploy.)
- Watcher first deployed from `main`, which lacked the new files → pointed the
  service at the `email-to-pipedrive-watcher` branch.
- `IndexError` on Railway: `Path(__file__).parents[2]` assumed the full repo
  layout; guarded the local-dev `.env` fallbacks for the shallow `/app` root.

---

## Open item (deferred, needs a decision): real data in the frontend

Goal was to make the deployed frontend (`cowarehouse-sourcing-tool.up.railway.app`)
show real data instead of the demo/synthetic dataset.

- **Root cause:** the frontend decrypts `data.enc.json` (AES-256-GCM, PBKDF2 250k)
  client-side behind the password Gate; locked/absent → demo fallback. That blob is
  **gitignored**, so it's not in the Railway build.
- **Blocker / policy:** `frontend/.gitignore` explicitly states *"Owner/broker PII
  must never be committed … The data reaches the deploy via a Railway volume /
  hosting env var, NOT git,"* and lists `data.enc.json` under PII. So committing it
  (even encrypted) violates the stated policy. **Not done** — surfaced for a
  decision rather than proceeding.
- **Options:** (1) policy-compliant — mount `data.enc.json` via a **Railway Volume**
  or serve it through the `/api/data` server path `crypto.js` already expects
  (3 MB, too big for an env var); or (2) explicitly override the policy and commit
  the encrypted blob via PR. **Pending Raz's call.**

## Other follow-ups
- The watcher branch (`email-to-pipedrive-watcher`) is what Railway deploys; merge
  it to `main` via PR when ready so the two stay in sync.
- `ANTHROPIC_API_KEY` is not set on the Railway watcher → extraction runs in regex
  mode (name/email/phone/firm from the signature). Set it for richer extraction.
- Railway filesystem is ephemeral: the watcher's `.graph_seen_ids.json` resets on
  restart → it re-reads the folder (dedupe catches it, no dup records). A Volume
  would make it persistent if desired.
