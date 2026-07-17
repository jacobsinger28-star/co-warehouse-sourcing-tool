# Sourcing Console — frontend

The unified operator console, built as a **Vite + React** SPA from the Claude Design
handoff (`../design/unified-operator-console-for-cre-sourcing/`). One page, no routing —
module switching, the Map/Properties/Brokers view toggle, the detail drawer, and the bulk
bar are all in-page state.

## Run

```bash
npm install
npm run dev      # http://localhost:3001
npm run build    # → dist/  (verified: 37 modules, ~205 KB JS)
```

## What's here

- `src/App.jsx` — the shell (top bar + Keep Sourcing + module switcher) **and** the
  Properties module (filter rail, table, brokers table, faux map, detail drawer, bulk bar,
  empty state). Holds all top-level state.
- `src/modules/SupplyModel.jsx` — CoStar supply model with a live new-development calc.
- `src/modules/AICaller.jsx` — call queue + active call + compliance banner + recents.
- `src/modules/DealsDB.jsx` — NL search, cited answer, deals table, dedupe guardrail.
- `src/data.js` — **SAMPLE data only** (synthetic; not real SimiCapital deals).
- `src/css.js` — tiny CSS-string → React-style-object parser, so the design's inline
  styles port near-verbatim. `src/helpers.js` — formatting + shared style fragments.
- `src/index.css` — design tokens (`:root`), dark/light themes, teal/bronze accents.

Interactivity wired: module + view switching, channel + score filtering, live "Keep
Sourcing" simulation, multi-select + bulk bar, drawer, map popups, supply calc, deals
dedupe, theme/accent toggles.

## Before this is production — the wiring punch-list

These are deliberately stubbed (mirrors the design-feedback list):

1. **Real map.** The Map view is a faux CSS grid with pins at hardcoded `x/y`. Swap for
   Leaflet/Mapbox + geocoded `lat/lng` (the on-market backend already geocodes).
2. **Backend data.** Replace `src/data.js` with live calls — properties/brokers from the
   merged store, `Keep Sourcing` → the scrape job queue, `Send to Pipedrive` → the API.
   Add a `server.proxy` block in `vite.config.js` for `/api` etc.
3. **Mark sample data** clearly until real data lands (esp. Deals DB answers).
4. ~~**Auth** before exposing off-market owner PII~~ — **done**: Supabase per-person
   login with a server-side JWT + email-allowlist check (see below), with the legacy
   shared password as a fallback until the Supabase env vars are set.
5. **a11y polish** — the unicode glyph icons (⌕ ◐ ⊘ ›) and placeholder-only inputs should
   move to a real icon set + labels; add focus states.

## Auth (Supabase login)

The Gate (`src/Gate.jsx`) picks its mode from `GET /api/config` at load:

- **Supabase mode** (real login, preferred): each person signs in with their own
  email + password against a Supabase project. The server (`server.mjs`) re-verifies
  the JWT with Supabase **and** checks the email against `ALLOWED_EMAILS` on every
  data route (`/api/data`, `/api/deals`, `/api/deals-chat`) — a login alone is not
  authorization, so open Supabase signups can't reach the PII. Allowlist entries:
  `@simicap.com` admits the whole domain, `raz@x.com` an exact address (mix with
  commas). **Default when unset: `@simicap.com`.** Unconfirmed-email accounts are
  refused, so a domain entry can't be spoofed by signing up with a claimed address.
- **Legacy mode** (fallback): the old shared `APP_PASSWORD`, shown only when no
  Supabase project is configured. Unset `APP_PASSWORD` once Supabase is live to
  retire the shared password.

To turn on Supabase mode, set in Railway → Variables (service restarts pick them up;
no rebuild needed — config reaches the client at runtime):

```bash
railway variables \
  --set 'SUPABASE_URL=https://<project-ref>.supabase.co' \
  --set 'SUPABASE_ANON_KEY=<anon public key>' \
  --set 'ALLOWED_EMAILS=raz@…,andrew@…,nate@…'
```

Supabase setup (dashboard): create a project (or reuse an existing one — the
allowlist keeps other apps' users out) → Authentication → disable public signups →
Users → **Add user** for each teammate (email + password, "auto-confirm"). Local dev
without the node server: put `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in
`frontend/.env.local`.

No auth configured at all → the server fails closed (every `/api/*` request refused).

## Verified

`npm run build` passes clean; a full server-render of `<App/>` mounts with no runtime
errors and all modules present (build + SSR smoke, 2026-06-25).

> Data persistence: the Railway volume at /data keeps the real dataset across
> GitHub auto-deploys (see server.mjs DATA_DIR); refresh it with deploy.sh.
