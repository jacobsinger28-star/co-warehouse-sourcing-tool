# Session Log — 2026-07-21 — Live-scrape engine overhaul + source audit/revival

Backend-only work (`frontend/backend/`), committed straight to `main` alongside a
concurrent session that owned the frontend (App.jsx, PhoneBurner, Crexi broker
enrichment). Started from "when I open a record the drawer is clipped" and grew
into a full rework of the on-market "Keep Sourcing" engine.

## The arc, by commit

### Map popup flicker (earlier) — `995fdae` region
The map popup faded in/out on a ~3s cycle: the live-status poller re-rendered the
app every tick, handing Leaflet fresh `visibleProps` + fresh divIcons, so markers
were torn down/re-added. Fix: `useMemo` on `visibleProps`, `React.memo(DealMap)`,
cache divIcons per (channel, category). Also `isolation:isolate` on `.map-view`
so the detail drawer (z-index 26) stacks above Leaflet's internal panes.

### `5a9e23c` — parallel sites + markets, market-scoped search, prompt stop
- 7 sites scrape CONCURRENTLY (bounded queue → single consumer keeps
  scoring/geocode/SQLite-upsert serialized; `SITE_CONCURRENCY=4`; API-only runs
  skip Chromium). Crexi scans its per-metro bboxes in parallel too.
- `/live/scrape` gained an optional `markets=[...]`; added Nashville, Orlando,
  Cleveland to `scrapers/markets.py` TARGET_MARKETS (they weren't being scanned).
- **Stop was broken (never halted).** Two causes: the UI poller bounced the
  button back to "Sourcing", and the backend only checked the stop flag between
  listings. Fixed both: a `stopping` latch in App.jsx (poller can't un-stop it),
  and the drain polls the stop flag every 0.5s + cancels site tasks.
- `/live/rows` maps each listing to its metro (bbox→address) so suburbs surface;
  force-refresh prune is per-source + fail-safe (a bot-walled site can't wipe its
  own inventory).

### `9ecec9c` — non-blocking geocode + teardown deadlock fix
`geocode_sync` (Nominatim 1 req/sec + sync HTTP) ran inline in the async loop,
freezing every parallel task. Moved to `run_in_executor`. That exposed a DEADLOCK:
each site/market task posted its `_DONE` sentinel with a BLOCKING `queue.put()` in
a finally; once the consumer stopped draining, that put hung forever (Stop took
>15s on a cold cache). Fixed: drains track completion via `task.done()` not
sentinels; `_DONE` is `put_nowait`.

### `2c8c4ad` — US Census batch geocoder (free, no rate limit)
Two-phase: phase 1 stores each listing immediately with cache-only coords (never
blocks); phase 2 resolves all new addresses in ONE Census batch request
(`geocoding.geo.census.gov/.../addressbatch`, keyless, ~10k/req) + bounded
Nominatim fallback. Cold 3-metro/64-listing run: batch-geocoded 59/64 (92%) in
~1s vs ~64s inline; whole run 25s (was ~85s).

### `90e4208` — Dockerfile: copy phoneburner.mjs (prod was 502)
The concurrent session's PhoneBurner commit imported `./phoneburner.mjs` in
server.mjs but didn't add it to the runtime-stage COPY list → ERR_MODULE_NOT_FOUND
crashloop, prod down. Same recurring gotcha as filterChat.mjs. One-line fix.

### `d6edbf8` — backend test suite (35 → now 70 with later additions)
`frontend/backend/tests/`, no network/browser. Includes a Stop-teardown-no-leak
regression that reproduces the deadlock (verified it FAILS if the blocking `_DONE`
put is reintroduced). Run: `cd frontend/backend && python3 -m pytest tests/`.

## Source audit — the real story

Audited every source end-to-end (API sources locally; Playwright sources via the
`general-scraping/backend/.venv` python which has playwright 1.61 + chromium — the
console backend has none). **No account is needed for any source; the production
button is 100% headless server-side, no Chrome extension in the loop.**

| Source | State | Notes |
|---|---|---|
| Crexi | ✅ strong (255 buy-box across 10 metros) | JSON API, coord bbox scoping |
| CBRE | ✅ **revived** `3b17ed1` (42 in-market) | see below |
| Colliers | ✅ fixed `15bbf8b` | see below |
| JLL | ✅ fixed `9079c64` | see below |
| Newmark | ✅ works (8+) | Playwright |
| Cushman | ❌ **dropped** (this session) | see below |
| NAI | ❌ **dropped** (this session) | see below |

- **`15bbf8b` Colliers** was emitting 0 despite a healthy 1,733-listing national
  feed: its market filter matched the bare metro NAME as an address substring, so
  every suburb (Lebanon→Nashville, Huntersville→Charlotte, Gahanna→Columbus) was
  dropped. Switched to `market_for_address`. Colliers carries broker contacts.
- **`9079c64` JLL** worked but crashed the whole site's run: `_re_sf`'s `[\d,]+`
  group can capture a lone comma → `float('')`. Added a `_num()` guard. JLL now
  runs clean (in-market: Holly Springs, Concord NC).
- **`3b17ed1` CBRE revived** — it drove Playwright over
  `cbre.com/properties/properties-for-sale/*` which now 404 (URL rot, NOT
  bot-blocking). Found the public JSON API behind the SPA:
  `GET cbre.com/listings-api/propertylistings/query?...&Common.Aspects=isSale&Common.UsageType=Industrial`
  (~1,230 industrial-for-sale; each has full address, EXACT lat/lon, SF, and
  broker name/email/phone). New browserless `scrapers/cbre.py` (like crexi/colliers).

## This session — extension test + dropping Cushman & NAI

Per the request, tested whether the Chrome extension is actually needed for the
two dead sources.

- **NAI** — loaded its BuildOut inventory in the REAL browser (Chrome extension):
  renders fine, **11,439 listings**, fetched via `POST buildout.com/plugins/{id}/inventory`.
  So the data exists, but that POST needs the browser's session/CSRF — which the
  headless server-side scraper cannot reproduce (it gets HTML, not JSON, every
  run). The extension can *see* NAI but **can't make production scrape it** (prod
  is headless, no extension). → **dropped.**
- **Cushman** — has NO JSON API (server-renders HTML; only Google ads/analytics in
  the network). Its failure was the `networkidle` wait hanging on ad beacons, not
  blocking; it's revivable headless (domcontentloaded + scroll; verified 3/3
  detail pages parse). But it's fragile Playwright HTML scraping with **no broker
  contacts** for a modest coverage bump. → **dropped** (revival recipe preserved
  in the `_BUILTIN_SITES` comment).

Removed both from `scrapers/brokerage.py::_BUILTIN_SITES` (stops the wasted
scraping) and from `frontend/src/data.js::SCRAPE_SOURCES` (removes the UI chips),
each with an inline note explaining why + how to revive. **Bottom line: the
extension confirmed the diagnosis but was not needed — every fix that helped
production was done headlessly, and the 5 remaining sources (Crexi + CBRE +
Colliers + JLL + Newmark) give strong, contact-bearing coverage across all 10
metros.**

## For future agents
- When a browser source dies, FIRST check for a JSON API behind the SPA
  (`page.on("response")` filter for json). Crexi, CBRE, Colliers all have one; an
  httpx API scraper beats Playwright scroll-scraping every time.
- The production button is headless server-side. Any fix must work HEADLESSLY —
  the Chrome extension is a diagnosis tool only, never a runtime path.
- `live_api.py` + `database.py` are shared with the concurrent session; `scrapers/`
  + `geocoder.py` were this session's. `crexi.py` got concurrent broker-contact
  enrichment (`broker_contact.py`) — not touched here.
