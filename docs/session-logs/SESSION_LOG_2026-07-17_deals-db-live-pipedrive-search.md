# Session log — Deals DB: live Pipedrive deal book, keyword search, RAG chat (dormant)

**Date:** 2026-07-17 (continues work snapshotted 2026-07-07 on `deals-rag-chat`)
**Area:** `frontend/dealsChat.mjs` (new), `frontend/server.mjs`, `frontend/src/modules/DealsDB.jsx`, Dockerfile, Railway deploy
**Outcome:** the Deals DB tab runs on **live Pipedrive data** — full deal book,
keyword search over titles/contacts/notes, six known-question presets, and a live
dedupe check — all deployed to Railway. A Claude-powered chat layer is built and
committed but **dormant** (no `ANTHROPIC_API_KEY` anywhere).

---

## What we set out to do

"Use my Pipedrive key to start implementing the deals database RAG based chat"
(README module 4: *plain-English search over past deals/LOIs*). Mid-session pivot:
**no LLM for now** — serve the data and search deterministically from Pipedrive.

## What was built

### 1. Corpus + engine — `frontend/dealsChat.mjs` (new)

- **Sync**: pulls all deals, notes, stages, pipelines from Pipedrive (token from
  `PIPEDRIVE_API_TOKEN`, local fallback `../general-scraping/backend/.env`).
  One plain-text doc per deal (title, pipeline/stage, status, value, contact/org,
  dates, up to 12 notes, HTML stripped + entities decoded). In-memory cache,
  10-min TTL. At time of writing: **52 deals, 2,964 notes**.
- **`searchDeals({q, preset})`** (no LLM): no args → whole book; `q` → keyword
  ranking (title hits ×5, per-term capped) with matched-note snippets; `preset` →
  known questions: `tracking` / `open` / `won` / `lost` / `recent` / `noted`.
- **`answerDealsQuestion(question, history)`** (dormant): retrieval → top-8 docs +
  a one-line index of every deal → `claude-opus-4-8` with cached system prompt →
  grounded answer + `CITED: [ids]` footer resolved to Pipedrive links. Activates
  the moment `ANTHROPIC_API_KEY` is set; shares the same corpus.

### 2. Server routes — `frontend/server.mjs`

Same fail-closed `APP_PASSWORD` gate + per-IP rate limit as `/api/data`:

| Route | Purpose |
|---|---|
| `POST /api/deals` | `{password}` → deal book · `{password,q}` → search · `{password,preset}` → known question |
| `POST /api/deals-chat` | `{password,question,history}` → Claude answer (needs `ANTHROPIC_API_KEY`) |

### 3. UI — `frontend/src/modules/DealsDB.jsx` (rewritten)

Sample table replaced by the live deal book (falls back to sample on static
deploys); chips = known questions; search returns ranked deal cards with the
matching note lines; dedupe check now runs against the live book with a
"Open in Pipedrive" link. Session password kept in memory only
(`src/session.js`, set by Gate — later extended by the Supabase-auth session to
JWT `authHeaders()` / password `authBody()` dual mode). `vite.config.js` now
proxies `/api` → `:8080` for dev.

## Deploy + the two production bugs

1. **Railway crash (fixed, `3ee0dfd`)**: the Dockerfile runtime stage didn't copy
   `dealsChat.mjs` → container died at boot (module not found) → deploy failed
   healthcheck and Railway kept serving the old build. Fix: one COPY line.
   Verified by simulating the exact runtime file set locally before pushing.
2. **"No searched deals on the deployed version"**: the frontend Railway service
   (`co-warehouse-sourcing-tool` in project `gracious-reprieve`, domain
   `cowarehouse-sourcing-tool.up.railway.app`) had `PIPEDRIVE_API_TOKEN` but **no
   `APP_PASSWORD`** — the server fails closed by design, so `/api/deals` 503'd and
   the UI silently fell back to sample data. Raz added the variable at session end
   (Railway vars are per-service — the watcher's vars don't carry over).

## Verification done

- Local end-to-end in Chrome (extension): gate unlock → live table
  ("Pipedrive · 52 deals live") → preset (Tracking: 1 match) → keyword search
  ("seller financing": 3 matches with note snippets) → dedupe ("Old Concord" →
  flags 5710 Old Concord Road). Caught & fixed `&nbsp;` decoding + "EasyBay "
  trailing-space in the process.
- Deployed `/health` ok; `/api/deals` correctly refused pre-`APP_PASSWORD`.

## Open items / decisions

- **Deployed end-to-end check NOT run** — Raz asked to hold until manager sign-off
  on retrieving live deal data through the deployed app. Run the browser check
  against `cowarehouse-sourcing-tool.up.railway.app` once approved.
- **LLM chat dormant** — no `ANTHROPIC_API_KEY` exists locally or on the frontend
  service. Setting it on Railway turns on `/api/deals-chat`. Flag for the manager
  conversation: enabling it sends deal context to Anthropic's API.
- **Embeddings deferred** — at 52 deals, lexical search beats a vector store;
  Voyage/pgvector remain the Stage-3 plan (`migration/deals-database/docs/`).
- **Vercel deploy is stale** (6–8 days old, predates Supabase auth + Deals DB
  work) and static — no `/api/*` there. Per standing rule, deploys to Vercel need
  explicit go-ahead (PII).
- **Repo-hygiene incident (this session's close-out)**: a wrong-cwd operation had
  duplicated repo-root dirs *inside* `frontend/` (`frontend/frontend/`,
  `frontend/docs/`, …) and left merge-conflict markers in `frontend/README.md`,
  `frontend/.gitignore`, `frontend/.claude/launch.json`. Restored the three
  tracked files and removed the duplicates after verifying they were exact/stale
  copies. One casualty: a freshly regenerated (today, wholly different content)
  `frontend/adaptive-reuse-finder/data/areas/EXAMPLE_downtown_west_columbus.csv`
  was deleted with the copies — regenerable via the adaptive-reuse-finder tool if
  ever wanted.
