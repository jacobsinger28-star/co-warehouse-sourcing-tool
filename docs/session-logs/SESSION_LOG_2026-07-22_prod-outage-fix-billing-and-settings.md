# Session Log — 2026-07-22 — Prod outage fix + Stripe payments + Settings UI

Started as "add more BYOK LLM/CRM connectors + scaffold billing," which shipped
fine — then the next deploy took the **live site down (502)**. Diagnosed and
fixed the outage, hardened the deploy pipeline so that class of failure can't
recur, then completed the payments integration to test-mode-ready and fixed two
Settings-page issues. All work landed on `main` and is deployed healthy.

Commits (in order, all on `origin/main`):
- `2040143` Billing skeleton + more BYOK connectors (OpenAI/Gemini, HubSpot/Close/Zoho)
- `f5d1673` Fix prod outage: Dockerfile dropped billing.mjs → harden image assembly
- `f745e99` Payments (Stripe) code-complete + test-mode ready; commit leaseRate module
- `61ce027` Settings: fix non-scrolling page + add disabled billing preview for clients

## The outage — what happened

The billing skeleton added `frontend/billing.mjs`, which `server.mjs` imports.
The Dockerfile's runtime stage copied server modules **by an explicit per-file
list** (`COPY server.mjs`, `COPY secrets.mjs`, …) and no one added `COPY
billing.mjs`. So the built image was missing that file.

Why every check passed anyway:
- `vite build` only bundles the **frontend** — it never touches server `.mjs`.
- `docker build` copies files + builds the frontend; it never **runs** the server.
- The failure only appeared at container **startup**: `node server.mjs` hit
  `import … from './billing.mjs'` → `ERR_MODULE_NOT_FOUND` → exited before it
  could listen → Railway healthcheck never answered → the crash-looping container
  **502'd** the single replica. Every commit stacked on top inherited the same
  broken image, so several deploys failed in a row.

## The fix + hardening (`f5d1673`)

1. **Restore first:** redeployed the last-good pre-billing deployment via the
   Railway dashboard (⋮ → Redeploy) to bring the site back up.
2. **Glob copy:** the Dockerfile now does `COPY --from=build /app/*.mjs ./`
   instead of naming each module — a new sibling can never be left behind. Tests
   live in `test/` and are excluded.
3. **Build-time import guard:** `frontend/tools/check-imports.mjs` runs as a
   Dockerfile `RUN` step. It walks `server.mjs`'s local import graph and **fails
   the build** if any imported module is absent from the image. This converts the
   failure from "server crashes in prod after cutover" into "bad build rejected,
   last healthy deploy keeps serving." Verified: passes on the full set (10
   modules), exits 1 with a clear message when `billing.mjs` is removed.

Rollback procedure (documented for next time): Railway dashboard → last
successful deployment → ⋮ → **Redeploy**. Railway's rollout is health-gated, so a
failed deploy does not replace the running one.

## Payments — code-complete, test-mode ready (`f745e99`)

Still **dormant** until `STRIPE_SECRET_KEY` is set. SimiCapital's own workspace is
the legacy/house tenant and is exempt everywhere.
- `billing.mjs`: plan catalog, usage metering (`usage_events`), entitlements
  (`entitlementsFor` / `aiEntitlement` / `shouldDegradeAi`), Stripe Checkout,
  Customer Portal (`createPortalSession`), and HMAC-SHA256 webhook verification
  with a 5-minute replay window — all dependency-free (no Stripe SDK).
- `server.mjs`: routes `POST /api/tenant/billing` (summary), `…/checkout` (501
  dormant), `…/portal` (501 dormant / 409 no customer), `POST /api/billing/webhook`
  (signature-gated), plus AI-quota enforcement in deals-chat (`402
  ai_quota_exceeded`) that fires only for a provisioned tenant over its trial cap.
- Policy: only the **unpaid trial** is capped; paid plans meter-and-bill and are
  never cut off (`shouldDegradeAi` is the single lever).
- `Settings.jsx`: "Manage billing" button + one-time checkout-return banner.
- `supabase/migrations/0003_billing.sql`: plan/Stripe columns on `tenants` +
  `usage_events` meter (RLS-locked). **Must be applied manually** before go-live.
- `frontend/BILLING_SETUP.md`: exact go-live steps (migration, Stripe
  products/prices, env vars, webhook endpoint + events, test-card flow).

## Settings UI (`61ce027`)

- **Scroll fix:** the module container in `App.jsx` is `overflow:hidden` and each
  module owns its own scroll; `Settings` was plain flow content, so billing + the
  lower connector cards got clipped. Wrapped its body in a
  `flex:1;height:100%;overflow-y:auto` scroll container (self-contained; no risky
  `App.jsx` edits).
- **Disabled billing preview:** extracted a reusable `BillingCard` and render it
  disabled with sample data in the internal workspace under "Preview · how a
  client workspace sees billing [Sample]" — so we can see the paying-client
  surface even though the house workspace isn't billed.
- Verified in a local build (browser: logged in, page scrolls to the CRM/Outreach
  connectors, preview renders). 50 tests pass, import guard clean, build clean.

## Also this session

- **Lease-rate module** (`f745e99`): `leaseRate.mjs` (`parseLeaseRate` /
  `leaseRepRate`) was imported by `server.mjs` but **never committed** — a latent
  repeat of the outage. Committed the standalone server-side module + test so the
  import resolves. Its consuming UI (`Properties.jsx` / `propertiesShared.js`) was
  left for its owning concurrent session — see "In-flight / leftovers."
- **Connector catalog** (`2040143`): added OpenAI, Google Gemini (AI/LLM) and
  HubSpot, Close, Zoho CRM to the write-only BYOK Settings surface, with matching
  log-redaction patterns. Notes stay honest that the Deals AI runs on Claude today.

## In-flight / leftovers

- **Lease-rate display UI** (`Properties.jsx`, `propertiesShared.js`, `PropTable.jsx`,
  `helpers.js`) is being built by a concurrent session and stays uncommitted in the
  shared working tree. The server now attaches `p.lease.rate`; the UI to show it
  lands with that session. The build guard will block any deploy of a `server.mjs`
  that imports an uncommitted module, so this is now safe-by-default.
- Local `main` has **diverged** from `origin/main` (concurrent sessions committed
  locally without pushing). My work all went to `origin/main` via worktrees, so
  nothing of mine is unpushed. Local `main` should be reconciled by whoever owns
  those local commits — not force-pushed.
- Several concurrent-session branches/worktrees exist
  (`claude/busy-pike-*`, `claude/clever-dijkstra-*`, `claude/funny-heyrovsky-*`,
  `phoneburner-integration`, `reconcile-lease`). **Not touched** — they belong to
  parallel sessions and may hold unmerged work.

## Go-live checklist for payments (owner action)

See `frontend/BILLING_SETUP.md`. In short: apply `0003_billing.sql`; create the
Starter/Pro prices in Stripe (test mode); set `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` on Railway;
register the webhook at `/api/billing/webhook` for `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted`; test with card
`4242 4242 4242 4242`.
