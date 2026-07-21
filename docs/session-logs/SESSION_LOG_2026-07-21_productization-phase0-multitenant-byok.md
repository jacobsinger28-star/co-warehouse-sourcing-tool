# Session Log — 2026-07-21 — Productization Phase 0: multi-tenant tenant boundary

Started from the productization handoff (`docs/PRODUCTIZATION_HANDOFF.md`) + the two
`SimiCapital/docs/memos/` design memos: turn the single-tenant Sourcing Console into a
multi-tenant BYOK product other companies run on their own keys + CRM. Ran on branch
`feat/multitenant-byok`. This session = **map first, then confirm, then Phase 0 only**.

## Map — the current single-tenant assumptions

Read `server.mjs`, `src/supabaseAuth.js` + `src/session.js`, `phoneburner.mjs`,
`dealsChat.mjs`, `tools/email_to_pipedrive/`, the SPA, and the deploy. Findings:

- **Auth = a user, never a tenant.** `requireAuth` verifies a Supabase JWT → email →
  checks one process-global allowlist (`ALLOWED_EMAILS`, default `@simicap.com`).
  Everyone who passes is implicitly SimiCapital; nothing tenant-scoped rides `req`.
- **Supabase is auth-only.** No product tables, SQL, migrations, RLS, no
  `@supabase/supabase-js`, no service-role key. The tenant data layer is greenfield.
- **One global dataset** (`data.real.json`, baked/volume) served to any authed user.
- **Provider keys are process-global env vars** — the BYOK targets: `PIPEDRIVE_API_TOKEN`
  (dealsChat + phoneburner + the Python seed, token in the URL query string = a leak
  surface), the PhoneBurner PAT/OAuth trio + a single `PHONEBURNER_WEBHOOK_SECRET`
  (webhooks can't be attributed to a tenant), one `ANTHROPIC_API_KEY`, one deal `corpus`.
- **Deploy is one image / one Railway service / one env set** — single-tenant by build.
- In our favor: `tools/encrypt_data.mjs` already does AES-256-GCM via `node:crypto` (no new
  dep for envelope crypto); the SPA has no router (a Settings page is a `useState` switch
  insertion); `email_to_pipedrive/pipedrive_sync.py` isolates the CRM upsert shape.

## Decisions confirmed with Raz (see private memo `productization-tenancy-decision`)

1. **Tenancy = shared multi-tenant** (Supabase RLS + per-tenant DEK envelope crypto, master
   KEK in Railway). Clone-per-tenant deferred to a later "dedicated" tier.
2. **Secret trust = service-role key in Express** (server-only `SUPABASE_SERVICE_ROLE_KEY`;
   Express is the sole DB client + sole decryptor; RLS as defense-in-depth). PostgREST over
   `fetch`, no supabase-js — matches the hand-rolled GoTrue style.
3. **First milestone = backend BYOK foundation + Settings/Integrations UI** (Phases 0,1,2,4).
   The pluggable CRM adapter (Phase 3) trails.

## Phase 0 shipped (commit `daf5ead`)

The tenant concept, **gated so it's a no-op until `SUPABASE_SERVICE_ROLE_KEY` is set** — until
then `requireAuth` keeps using the legacy allowlist, so behavior is byte-identical.

- `supabase/migrations/0001_tenants.sql` — `tenants` + `tenant_members` (+ RLS; the anon key /
  user JWTs read nothing, only the service role reaches them).
- `db.mjs` — minimal PostgREST-over-`fetch` client (service-role only, env read live).
- `tenants.mjs` — `resolveTenant(email)`: exact-over-domain membership match, 5-min cache,
  fail-closed on DB error, legacy-allowlist fallback when tenancy is off.
- `server.mjs` — `requireAuth` resolves + attaches `req.tenant` on both auth paths (nothing
  consumes it yet — Phase 2 does).
- `tools/seed_tenant.mjs` — one-time migrate SimiCapital as tenant-1 from `ALLOWED_EMAILS`.
- `test/tenants.test.mjs` + `npm test` (node:test, no live DB) → 8/8 green. Dockerfile ships the
  new modules; `supabase/README.md` documents the lockout-free rollout (seed BEFORE setting the
  key; unset to roll back).

## Open / next

- **Phases 1, 2, 4 remain** (secret layer + envelope crypto; point providers at the resolver;
  Settings/Integrations UI). Tracked.
- **Rollout is Raz's to run when ready:** apply `0001_tenants.sql` → `seed_tenant.mjs` with
  today's `ALLOWED_EMAILS` → set `SUPABASE_SERVICE_ROLE_KEY` in Railway. No rush — the app runs
  as-is with tenancy off.
- **Flag:** `docs/methodology/` (added this day by a concurrent session, commits `f69a571`/
  `466b01f`) vendors the attributed **NextAutomation** kit. The productization handoff §6 says
  keep that kit out of this shared repo — so at close-out those two commits were **held off
  `main`** pending Raz's call; Phase 0 went to `main` without them.
