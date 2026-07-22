# Session Log — 2026-07-22 — Keep Sourcing live-scrape backend (deploy + `/live/rows`)

Client asked "Does the Keep Sourcing button work now?" The frontend + proxy were
already built (`startSourcing`→`liveScrape`→`POST /api/live/scrape`, status
polling, per-source progress), but every call 502'd with "live scrape service
unavailable" because the backend scraper service was never deployed and
`LIVE_API_URL` was unset. This session deployed it and closed a route-contract
gap the frontend assumed existed.

Note on scope: the task framing was "only deployment is missing." That was
inaccurate — the scraper did **not** implement `/live/rows` or `/live/import`.
It had `GET /live/listings` (raw `{listings}`, wrong shape) and
`POST /pipedrive/import`. So this was code **and** deploy.

## What shipped

All code changes are in the sibling repo **`../general-scraping`** (GitHub
`korteraz/simicap-onmarket-scrapping`), the FastAPI scraper service. No changes
to this repo (`sourcing-platform`) — its proxy route table already expected
`/live/rows` + `/live/import`.

**New endpoints (`general-scraping/backend/main.py`)**
- `GET /live/rows` → returns the app's on-market `{props, brokers, counts}`
  shape. It is the **runtime twin of this repo's `tools/build_real_data.py`**
  (`load_onmarket` + `build_brokers`): the offline builder reads the scraper's
  SQLite to bake `data.real.json`; this endpoint returns the identical shape
  over HTTP so Keep Sourcing hydrates Properties live without a laptop rebuild.
  Transform extracted to a new `backend/listings_view.py` (`to_props`/`to_brokers`,
  same `SOURCE_FIRM`/`CAT_NOMINAL`/`smart_title`/`parse_city_state` constants).
  **Keep the two in sync.**
- `POST /live/import` → aliases `/pipedrive/import` so the proxy's fixed route
  table (`/api/live/import`) resolves. Frontend doesn't call it yet.

**`first_seen` tracking (`general-scraping/backend/database.py`)**
- The frontend was already built to render an "Added" date and the "+N new" NEW
  badges from a backend `first_seen` (`PropTable.jsx:50`, `helpers.js:11`), but
  the scraper DB had no such column, so those never populated for on-market rows.
- Added `first_seen TEXT` to the `listings` schema + a `_MIGRATIONS` entry;
  `upsert_listing` stamps it **on insert only** (left out of the `ON CONFLICT DO
  UPDATE` clause) so a re-scrape never overwrites the original discovery time.
  `/live/rows` emits it as `firstSeen`.

**Railway deploy fixes (`general-scraping/Dockerfile`, `railway.toml`)**
- Dockerfile CMD binds `uvicorn --host ::` (was `0.0.0.0`): Railway private
  networking is IPv6-only, and the scraper is reached privately.
- `railway.toml`: removed the `/health` healthcheck — Railway's deploy
  healthcheck can't resolve a target port on a domain-less service and reported
  "service unavailable" even though uvicorn was up on `[::]:8000`. Reachability
  is verified through the app proxy instead.

## Deploy topology (all on the client's `gracious-reprieve` Railway project)

- New service **`simicap-onmarket-scraper`** (id `0afad105…`), same project as
  the app `co-warehouse-sourcing-tool`. Persistent volume at `/data`,
  `DATA_DIR=/data`, `PORT=8000`.
- **Private-only — no public domain**, deliberately: `/live/rows` returns broker
  emails/phones, so it must not be publicly reachable.
- App wiring: set `LIVE_API_URL=http://simicap-onmarket-scraper.railway.internal:8000`
  on `co-warehouse-sourcing-tool` (not hardcoded). Without it the proxy 502s.
- Deployed via `railway up` (local working-tree upload). Had to `railway link`
  the `general-scraping` dir itself first — the parent `SimiCapital/` dir was
  linked to the app service, and `railway up` uploads from the *linked* root.

## Verification (end-to-end through the live app proxy, legacy-password auth)

- `POST /api/live/status` → `{"status":"idle",...}` (was 502) — proxy reaches the
  scraper over IPv6 private net (`fd12:…` source IP in scraper logs).
- `POST /api/live/scrape` → `{"status":"started","job_id":1}`; a real scrape
  pulled live listings from **JLL + Cushman & Wakefield** from the cloud IP (CBRE
  selector no longer matches — skipped gracefully; not fully bot-blocked).
- `POST /api/live/rows` → **15 real props, `firstSeen` populated 15/15**, correct
  keys, real markets/geocodes/firms. brokers=0 (JLL/Cushman rows carry no broker
  contact; only the Colliers/RCM scraper does — consistent with the offline build).
- `POST /api/live/stop` → `stopping` → confirmed `stopped` (19 stored). All five
  proxy routes (scrape/stop/status/rows/import) exercised.
- No PII shipped: fresh volume DB starts empty; `make deploy` / Vercel untouched.

## Git / deploy state — ⚠ ACTION NEEDED

- **This repo:** no code changes. This session log is the only file; committed on
  the worktree branch, not pushed.
- **`general-scraping`:** changes to `database.py`, `main.py`, `listings_view.py`
  (new), `Dockerfile`, `railway.toml` are **deployed but NOT committed/pushed**
  (deployed straight from the working tree via `railway up`, repo on `main`). A
  GitHub-based redeploy would lose `/live/rows` etc. → **commit on a branch +
  push, and optionally connect the service to GitHub for reproducible redeploys.**
  Left for user go-ahead (branch-first; not yet approved).

## Update — autorun (make it run nonstop, no button)

Client: "make it work nonstop without me clicking the sourcing button."

- `main.py`: `_start_scrape_job()` factored out of the `/live/scrape` endpoint and
  shared with a new `_autorun_loop()` daemon thread (started at import when
  `AUTORUN` is truthy). Loop = run a scrape → wait for it to finish → cool down →
  repeat, forever. Incremental by default (14-day cache) so cycles are cheap and
  gentle on the broker sites; the button and autorun share the same lock so they
  never double-start.
- Env: `AUTORUN=1` (set on the scraper service), `AUTORUN_INTERVAL_HOURS` (default
  4, cooldown between runs), `AUTORUN_STARTUP_DELAY_SECONDS` (45), `AUTORUN_FORCE_REFRESH`.
- **Verified live:** after deploy, status flipped to `running` with no button
  click; the hands-off run stored 80+ nationwide listings.

## Update — nationwide markets (all over the US)

Client: "make it run all over the US … store all of the data it finds, just show
our target markets [Jake Diamond's list] on the default view … adjust the filters
and search." The scraper was already nationwide (`markets=[]`); the app was
*hiding* everything outside the buy-box via a hard `onlyAllowed()` cut.

- `propertiesShared.js`: `ALLOWED_MARKETS` is now a **default scope, not a hard
  cut**; added `marketOptions(props, canonicalOrder)` → `{buy, rest}` (target
  markets first, then every other US market present, alphabetical). Removed
  `onlyAllowed`.
- `App.jsx`: dataset keeps the **full nationwide universe** (no `onlyAllowed`);
  header market picker lists all US markets (targets + "Other US markets · N");
  empty state relabelled "Target markets".
- `Properties.jsx` `visibleProps`: market scope applied at view time — explicit
  selection wins; **a search is global** (reaches any US market); otherwise
  default to the buy-box. Filter-rail chips list targets + a collapsible
  "+N other US markets".
- **Verified:** build clean (122 modules), 38/38 tests pass, `marketOptions`
  logic unit-checked; `/api/live/rows` returns 67 props across 49 markets, all 49
  non-buybox US metros present, `firstSeen` 67/67. Committed on branch
  `claude/funny-heyrovsky-86d93c` (`7e02e8b`); **NOT merged/deployed** (see Git state).

## Git state (updated at close-out)

- **`general-scraping`:** all scraper changes (incl. autorun) committed on `main`
  (`8aea329`) and **pushed** to `korteraz/simicap-onmarket-scrapping`. Pushing does
  NOT deploy (the service runs from `railway up`, not GitHub) — this is durability.
- **`sourcing-platform` frontend:** committed on branch
  `claude/funny-heyrovsky-86d93c` (`7e02e8b`) and pushed to origin (branch only —
  Railway deploys from `main`, so no deploy). **Merge into `main` + app redeploy
  is DEFERRED**: `main` is being actively churned by another agent (concurrent
  commits/reset at 17:36 discarded an earlier doc commit of mine), and deploying
  needs an explicit go-ahead. Branch left intact (unmerged), not deleted.
- This session log lives on the branch (not `main`) to survive that churn.

## Open follow-ups

1. **Deploy the US-wide frontend change**: merge `claude/funny-heyrovsky-86d93c`
   into `main` + push (Railway auto-deploys). Coordinate with the other agent on
   `main` first; needs deploy go-ahead.
2. `off-market-os-scrapers` — investigated: it's the LIVE off-market backend
   feeding `build_real_data` (own IP, not NextAutomation's). Keep it. Same for the
   `content-celebration` service (= the email→Pipedrive Graph watcher, own IP).
3. CBRE scraper selectors no longer match its site — separate fix if CBRE
   coverage matters.
4. No healthcheck on the scraper now → Railway won't auto-restart a hung
   container. Re-add once a target port / domain strategy is settled.
