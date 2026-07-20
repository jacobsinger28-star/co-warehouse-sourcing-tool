# Session log — 2026-07-17: Supabase login live, self-registration, volume-backed data, Deals DB AI chat

**Ask:** "implement supabase login to secure the site" → grew into full auth rollout,
registration, broker-list restore, Deals-DB/Pipedrive verification + AI chat UI, and
fixing the deploy pipeline's data-wipe race.

**Live result:** https://cowarehouse-sourcing-tool.up.railway.app — per-person Supabase
login (self-registration enabled, data gated to @simicap.com), 2,453 props + 37 brokers
on persistent storage, Deals DB live against Pipedrive (53 deals).

## What shipped (commits `73971db`…`9249b38`)

1. **Supabase auth** (`73971db`) — `Gate.jsx` dual-mode (Supabase email/password when
   configured via runtime `GET /api/config`, legacy `APP_PASSWORD` otherwise);
   `src/supabaseAuth.js` hand-rolls GoTrue REST (no SDK dep) with auto token refresh;
   `server.mjs` re-verifies the JWT with Supabase **on every data route** plus an
   `ALLOWED_EMAILS` allowlist (`@domain` or exact entries; **default `@simicap.com`**;
   unconfirmed-email accounts refused so a domain entry can't be spoofed). Fail-closed
   when nothing is configured. Legacy password kept as transition fallback.
2. **Self-registration** (`3505525`) — "Create an account" mode on the Gate (Supabase
   signup + confirmation email); `/api/config` exposes `allowedDomains` (domains only,
   never exact-email entries) so the form warns non-simicap registrants live.
3. **Ask AI deals chat** (`8b7c3f5`) — wired the orphaned `/api/deals-chat` RAG backend
   into the DealsDB UI: answer + Pipedrive citations + rolling follow-up context.
   Graceful notice until `ANTHROPIC_API_KEY` is set.
4. **Volume persistence** (`eef2bd3`) — Railway volume mounted at `/data`
   (`DATA_DIR=/data`): a non-empty baked `data.real.json` refreshes the volume at boot;
   an empty bake (GitHub auto-deploys can't include the gitignored file) falls back to
   the volume copy. **Verified live**: a docs-only push auto-deployed and kept all data
   ("baked data empty → using volume copy"). `deploy.sh` fixed: explicit non-interactive
   `railway link` (project `gracious-reprieve`, service `co-warehouse-sourcing-tool`)
   and the stage now nests `frontend/` to match the service's Root Directory.

## Infra/config done outside git

- **Supabase project** `pxcqmoqbtzxmjyrhuzly` ("simicap-sourcing", korteraz's Org):
  Railway vars `SUPABASE_URL` + `SUPABASE_ANON_KEY` (new-style `sb_publishable_` key)
  set; Site URL + Redirect URL (`…up.railway.app/**`) pointed at the console (was
  localhost:3000 — confirmation links used to dead-end). Raz's `raz@simicap.com`
  account registered, confirmed, working.
- **Broker list restored:** the Jul-7 data build had only 13 brokers; the Jun-29
  encrypted Vercel snapshot had a fully disjoint 24. Decrypted the old snapshot, merged
  (dedupe by email; zero overlap) → **37 brokers**, deployed. Root cause note:
  `tools/pull_pipedrive_brokers.py` regenerates from Pipedrive each rebuild — something
  changed there between Jun 29 and Jul 7; the source-side filter was NOT fixed.
- **Railway CLI** authorized (razkorte@gmail.com) via browser pairing.

## Gotchas learned (cost real time)

- **Railway staged changes:** `railway variables --set` can leave values *staged* until
  "Apply/Deploy changes" is clicked in the dashboard — deployments meanwhile run without
  them (looked like env vars silently ignored).
- **Root Directory applies to `railway up`:** the service builds from `/frontend`, so a
  CLI upload with the app at tarball root silently loses `public/data.real.json` (build
  bakes `{}` → "data loaded (0 props)"). Stage must mirror the repo layout.
- **GitHub auto-deploy races `railway up`:** a push right before/after an up can
  activate the data-less build last. The volume fallback now makes this harmless.
- Supabase confirmation links are often consumed by mail-scanner prefetch — the user
  sees "otp_expired" but the account IS confirmed; check Users table before re-issuing.

## Open items (deliberately not done)

- **`ANTHROPIC_API_KEY`** missing on Railway → Ask AI shows its "not enabled" notice.
  Raz adds it (agent must not handle keys).
- **Retire `APP_PASSWORD`** (=the known shared password) once team login is proven.
- **Take down the Vercel static deploy** (sourcing-console.vercel.app) — its
  `data.enc.json` (weak password, offline-brute-forceable) is now the weakest link.
  Both are one-step actions awaiting Raz's go-ahead.
- Pipedrive broker-pull filter drift (why the 24 dropped) — unfixed at the source.
