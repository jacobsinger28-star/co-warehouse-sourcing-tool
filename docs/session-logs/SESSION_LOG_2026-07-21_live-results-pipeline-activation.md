# Session Log — 2026-07-21 — Live /results pipeline activation (handoff items 1–4)

Continuation of the same session as `methodology-consolidation`. Started from the
user's "of course do it" on the standing handoff items 1–4 (activate the live
off-market feed: scraper serves the corrected Wake list → console pulls it).
Documented/closed out 2026-07-22. Ran on `feat/multitenant-byok`, since merged to `main`.

## What was done

### Item 2 — scraper deployed + Wake re-run → /results = 164 ✅
- `railway up --ci --service 146c20bf…` from `../off-market-operating-system/service/`
  (Railway CLI authed as razkorte@gmail.com; link intact; tests 78 pass; the Wake
  heated-SF rescue is commit `3ed1bde`). Deploy succeeded.
- **Deploying code isn't enough:** results persist on the Railway volume and only
  auto-refresh when >30 days old (Wake was 1 day old). `/results/raleigh-wake-nc.csv`
  still served the stale **57**. Triggered a manual re-run: `POST /run/raleigh-wake-nc`
  (Bearer header, token from `.results-token.local`, never in a URL) → regenerated →
  **verified 164** rows.

### Items 1 & 3 — the handoff was inaccurate; corrected here
The handoff said "set `RESULTS_TOKEN` in the console's Railway env; the Railway build
pulls /results." **Not how it works.** The console `Dockerfile` never runs the data
build — it only moves a pre-existing `public/data.real.json` into place (or writes `{}`
→ synthetic fallback). The real pipeline is **local**:
- `tools/build_real_data.py` (writes `frontend/public/data.real.json`; calls
  `load_stage1` → pulls `/results`) — so **`RESULTS_TOKEN` is a LOCAL build var**, and
  `OFFMARKET_SERVICE_URL` defaults to the scraper prod URL. Setting it in Railway is a no-op.
- `tools/pull_pipedrive_brokers.py` (auto-reads its own token from
  `general-scraping/backend/.env`) — **replaces** `data["brokers"]` with the real
  Pipedrive set. This is the source of the console's 26 brokers (the on-market DB alone
  yields 13; a build-only rebuild would have *regressed* brokers 26→13).
- Deploy = `frontend/deploy.sh` step 3: stage `frontend/` (no `.gitignore`, so
  `data.real.json` uploads) → `railway up` to `gracious-reprieve / co-warehouse-sourcing-tool`.
  PII lands behind the console's Supabase/password auth (served only via authed
  `/api/data`) — the **private** path, not the `make deploy`/Vercel public path.

### data.real.json rebuilt + verified (no regression) ✅
Ran both scripts locally (token from file, never printed). Result on disk:

| | Live console (before) | Rebuilt |
|---|---|---|
| Total props | 2,612 | **2,719** (+107) |
| Raleigh (Wake) | 57 | **164** |
| Brokers | 26 | **26** (preserved) |

Only the Wake slice changed; bulk sources (`offmarket-scraping/exports/map_data.json`,
`general-scraping/backend/live_listings.db`, both Jun 23) unchanged. Live console logs
before the change: `data loaded (2612 props, 26 brokers)` — so no synthetic regression
from the earlier `main` merge-push (the console's real data rides the last `railway up`,
which survives git pushes).

## Item 3 (ship) & Item 4 (verify) — BLOCKED for the agent, PENDING the user
The final `railway up` (shipping `data.real.json` PII) is **hard-blocked by the harness
safety classifier** — same as `SESSION_LOG_2026-07-01` ("the final deploy keystrokes were
run by the user, with the agent building and verifying everything else"). Not worked
around. The Chrome extension can't substitute — a dashboard redeploy rebuilds from git
(no `data.real.json`); only a local `railway up` uploads the freshly-built file.

**Handed the user the exact one-liner** (surgical staged `railway up`, needs no secrets —
Railway already holds the auth vars). `frontend/public/data.real.json` (2,719/164/26) is
built and waiting on disk. After they run it, verify: Railway logs `data loaded (2719 props,
26 brokers)` + Raleigh shows 164 in the console UI.

## Caveat for whoever runs the deploy
Since this work, `main` advanced `7e5cb00 → 2040143` (concurrent sessions: Phase 2a/2b
BYOK, Phase 4 Settings, new-listing tracking, billing skeleton). The staged `railway up`
uploads the **current** `frontend/` — so it will ship `2040143` code **plus** this Wake-164
data, not the `7e5cb00` code originally verified. Confirm that's intended before shipping.
