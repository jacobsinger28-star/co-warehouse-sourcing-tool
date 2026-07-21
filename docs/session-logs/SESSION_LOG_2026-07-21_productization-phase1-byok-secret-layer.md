# Session Log — 2026-07-21 — Productization Phase 1: BYOK secret layer

Continues the multi-tenant productization (see the Phase 0 log). Built on branch
`feat/byok-secret-layer` off `main` (which already has Phase 0). This session: **Phase 1
only — the never-leak secret layer — then tested + documented.**

## What shipped (commit `4fe8fd4`)

Per-tenant provider credentials, envelope-encrypted at rest, decrypted only by the
server. **No-op until `SECRETS_KEK` is set** — until then every provider keeps using its
process env var via the resolver's legacy fallback, so this ships with zero behavior change.

- `supabase/migrations/0002_tenant_secrets.sql` — `tenant_secrets` (RLS, service-role-only,
  base64 ciphertext in TEXT so it round-trips over PostgREST) + `tenants.dek_wrapped`/`kek_version`.
- `secrets.mjs` — the crux:
  - AES-256-GCM `seal`/`open` via `node:crypto` (no new dependency; reuses the scheme in
    `tools/encrypt_data.mjs`). Envelope: KEK (Railway env, never in DB) → random per-tenant DEK
    (wrapped by KEK on the tenant row) → each field encrypted with the DEK.
  - `SecretResolver(tenant, {dryRun})` — the ONLY decryptor. `.get` / `.getProvider` /
    `.configured`. Dry-run returns `****` and never decrypts.
  - `writeSecret()` — write-only; creates the DEK on first write; refuses the legacy tenant.
  - **Isolation:** the env-var fallback is scoped to the legacy/default tenant ONLY. A real
    tenant with no key resolves to `null` (its integration stubs) — it can never borrow another
    tenant's env credentials. Directly tested.
  - `redact()` / `installRedaction()` — wrap all console output, scrubbing decrypted values and
    `api_token=` / `sk-ant-` / `Bearer` shapes (kills the Pipedrive query-string leak in logs).
- `db.mjs` — added `dbPatch` (persist a wrapped DEK). `server.mjs` — `installRedaction()` at boot
  + a BYOK-status boot log. `tools/seed_secret.mjs` — migrate a key into `tenant_secrets` (value
  read from an env var, never argv). Dockerfile ships `secrets.mjs`; `supabase/README.md` documents
  KEK generation + the seed step.

## Tests

`test/secrets.test.mjs` (10) against an in-memory PostgREST mock — envelope round-trip, ciphertext
is not plaintext, **tenant isolation + no-env-leak to a real tenant**, legacy env fallback, dry-run
masking, `getProvider`, stub-safe absence, and redaction. With Phase 0's suite: **18/18 green,
`node:test`, no live DB.**

## Concurrency + close-out notes

- A **concurrent agent** built a public-demo feature in the same working tree this session
  (`demo.mjs`, `demo-data.json`, `src/DemoGate.jsx`, `src/demo.js`, `tools/build_demo_data.mjs`, plus
  edits to `server.mjs`/`App.jsx`/`main.jsx`/`DealsDB.jsx`/`phoneBurner.js`/`crypto.js`/`liveApi.js`).
  That work was **left uncommitted and untouched** here — it is the other session's to finish/commit.
- **`main`-merge of this branch was deferred**, not done: checking out `main` with the other agent's
  uncommitted changes in the shared tree risks clobbering them. Merge once the tree is clean.
- Open: Phases 2 (point providers at the resolver) + 4 (Settings/Integrations UI) remain. The
  `docs/methodology/` NextAutomation-kit question is still Raz's call (recommend: drop `00–09` +
  `README.txt`, keep `deal-box-simicapital.md`).
