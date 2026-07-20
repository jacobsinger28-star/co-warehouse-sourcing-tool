# Session Log — 2026-07-20 (pt 2) · Drawer fix · AI filter chat · legacy-listing recovery

*Follow-ups after Keep Sourcing went real: fix the clipped detail drawer, add a chat that drives
the filters, and recover + relevance-check the old EasyBay records.*

## Drawer fix (b795e64)

- Bug: at narrow widths the property drawer opened **off-screen right** (user screenshot at
  ~1080px; reproduced fully-invisible locally). Root cause: the properties-module wrapper
  (`App.jsx`) had `min-height:0` but no **`min-width:0`**, so the table's content width (~1570px)
  blew the drawer's `position:absolute; right:0` parent past the viewport.
- Fix: one flex declaration. Verified at 1080×863 — drawer fully visible, all sections intact.

## AI filter chat (b795e64 + 1b46f1a)

- `FilterChat.jsx` (top of the filter rail) → authed `POST /api/filter-chat` → `filterChat.mjs`:
  Haiku with a forced `set_filters` tool; **server-side sanitizer whitelists/clamps every value**
  before the client applies it to channel/score/filters/search/view. Handles reset, relative
  changes (current state is sent), clear-height-is-a-MAX rule, and the new previous-sale screens.
- Verified: sanitizer unit-tested; UI apply-path proven with a stubbed response (map 2,298 → 5
  Actionable Nashville props). **Live LLM leg blocked on `ANTHROPIC_API_KEY` in Railway
  Variables** — same missing key as Deals-chat Ask AI; until set, the box replies with a notice.

## Prod outage + fix (d556b33)

- Every deploy after b795e64 **crashlooped**: `server.mjs` imports `filterChat.mjs` but the
  Dockerfile runtime stage never COPY'd it → healthcheck failures, including the parallel
  session's Orlando/Stage-1 GitHub deploy and its `railway up` attempts; the public URL 000'd
  during the churn. Lesson: **new server-side .mjs modules must be added to the runtime COPY
  list** (build stage `COPY . .` does not carry into the runtime stage).
- Fixed + pushed; deploy green, all new routes live and failing closed unauthed.

## Legacy EasyBay records: recovered → relevance-checked → imported

- Old records live in `general-scraping/backend/live_listings.db` (188 rows w/ URLs — the same
  data the pre-override Railway app served; NOT on Vercel/localStorage).
- `tools/import_legacy_listings.py`: liveness-checks every `listing_url` (browser UA, redirect
  heuristic), then uploads survivors via authed `POST /api/live/import` with `mark_cached=1`
  (UI 📦 badge; `prune_stale_listings` skips cached rows; a fresh scrape auto-clears the flag).
- Verdicts: **63 alive** (Cushman 22 — all alive; Colliers 32 of 120 — 88 dead/redirected;
  Newmark ~9), 88 redirected (sold/delisted since June), 37 unverifiable (JLL blocks plain
  HTTP entirely — left for the real scraper to re-confirm).
- Uploaded 63 to prod; `/api/live/rows` now returns **57 geocoded props** (6 rows lack lat/lng).

## Coordination note

A parallel session was working the same repo/service this session (previous-sale filter screens,
Orlando/Raleigh Stage-1 ingest, CLI deploys). Its 13:31 commit swept up this session's
uncommitted files (incl. a temporary test PW_HASH, reverted at HEAD); its deploys failed on the
missing-COPY bug above, not its own changes. Filter chat was taught the new sale screens.

## Open

- `ANTHROPIC_API_KEY` on Railway → activates filter chat + deals Ask AI (Raz).
- JLL's 23 legacy listings unverified (bot-blocked) — next real JLL scrape resolves them.
- Consider `railway.toml` healthcheckTimeout > 60s if cold boots ever get slower.
