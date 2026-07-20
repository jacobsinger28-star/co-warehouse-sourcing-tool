# PhoneBurner integration — setup

Single-line **power dialer + live human handoff**. No AI voice on cold calls
(Initiative #7 decision; FCC 24-17). This app pushes DNC-scrubbed contacts into
PhoneBurner, launches a browser dial session (embedded via SSO), and records call
outcomes via webhooks. The rep talks on every connect — the platform never dials
or speaks itself.

## Pieces
- `phoneburner.mjs` — API module (OAuth/personal-token, push contacts, dial session, outcome buffer)
- `server.mjs` — routes under `/api/phoneburner/*` (client routes behind `requireAuth`; webhooks gated by a path secret)
- `src/phoneBurner.js` — client helper (POST, same auth as `/api/data`)
- `src/modules/AICaller.jsx` — the "Power Dialer" screen (connect → push → launch)

## Env vars (set in Railway → Variables — never commit secrets)

**Auth — pick ONE mode:**
- **Personal token (recommended for our single company account):**
  - `PHONEBURNER_ACCESS_TOKEN` — PhoneBurner → My Account → Integration Settings → generate a Personal Access Token
- **OAuth app (only for multi-account/product use):**
  - `PHONEBURNER_CLIENT_ID`, `PHONEBURNER_CLIENT_SECRET`
  - `PHONEBURNER_REDIRECT_URI` = `{PUBLIC_BASE_URL}/api/phoneburner/oauth/callback`
  - one-time connect: open `{PUBLIC_BASE_URL}/api/phoneburner/oauth/start?k={PHONEBURNER_WEBHOOK_SECRET}`, approve, done. Refresh token persists to `DATA_DIR/phoneburner-token.json`.

**Webhooks / callbacks (optional but needed for the Recent column + Pipedrive sync):**
- `PHONEBURNER_WEBHOOK_SECRET` — any long random string
- `PUBLIC_BASE_URL` — e.g. `https://cowarehouse-sourcing-tool.up.railway.app`
- PhoneBurner posts to `{PUBLIC_BASE_URL}/api/phoneburner/hook/{SECRET}/{callbegin|calldone|contact-displayed}` (wired automatically into each dial session)

**Pipedrive sync (optional — warm outcomes → deal book):**
- `PIPEDRIVE_API_TOKEN` — reuses the deal book's token (already used by `dealsChat.mjs`)
- On a `calldone` whose disposition matches "warm/qualified/interested/callback/follow" (tunable via `PHONEBURNER_WARM_REGEX`), the server creates a Pipedrive **call activity** so the lead surfaces in the pipeline. Fire-and-forget — never blocks the call.

> API access requires the **Professional tier or higher** — the base plan won't issue tokens.

## Routes
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/phoneburner/status` | requireAuth | configured? connected? |
| POST | `/api/phoneburner/push` | requireAuth | push `{contacts:[...]}` |
| POST | `/api/phoneburner/dial` | requireAuth | `{contactIds}` → `{redirect_url}` |
| POST | `/api/phoneburner/recent` | requireAuth | recent call outcomes |
| GET | `/api/phoneburner/oauth/start?k=SECRET` | secret | begin OAuth connect |
| GET | `/api/phoneburner/oauth/callback` | — | OAuth redirect target |
| POST | `/api/phoneburner/hook/:secret/:event` | path secret | PhoneBurner callbacks |

## Test-first
You do **not** need this integration to trial PhoneBurner — just upload a CSV in
PhoneBurner and dial. Wire this up only after the head-to-head picks PhoneBurner.

## Before production
- **VERIFY field paths** in `phoneburner.mjs` against <https://www.phoneburner.com/developer/route_list> on the first live call (contact create body + dialsession response are coded defensively with fallbacks).
- Confirm the dial-session `redirect_url` is embeddable (iframe) for our account; the UI has a new-tab SSO fallback if it isn't.
- Replace the demo `CALL_QUEUE` staging in `AICaller.jsx` with real selected owners (DNC-scrubbed). Hook: pass the map/table's `selProps` into `<AICaller selected={…}/>` at the mount in `App.jsx` (line ~752) and prefer it over `CALL_QUEUE`. Left out here to avoid tangling with in-progress `App.jsx` edits in the shared tree.
- Confirm PhoneBurner's real disposition names map to `PHONEBURNER_WARM_REGEX` (Pipedrive sync trigger).
