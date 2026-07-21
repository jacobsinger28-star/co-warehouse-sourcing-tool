# Productization Handoff — Scaling the Sourcing Console to Other Companies

*Written 2026-07-21 as a handoff to a fresh agent working in this repo. Goal: take the
SimiCapital Sourcing Console (this app) and make it a multi-tenant product other companies can
run against their own API keys and their own CRM. This doc carries the design + context so you
don't start cold.*

---

## 0. Repo map — read this first (it caused real confusion)

Three sibling folders under `SimiCapital/`; only ONE is the product to productize:

| Folder | What it is | Productize? |
|---|---|---|
| **`sourcing-platform/`** (THIS repo) | `simicapital-sourcing-console` — React/Vite + Express (`frontend/server.mjs`) + Supabase, deploys to Railway (remote `jacobsinger28-star/co-warehouse-sourcing-tool`) | **YES — this is the product** |
| `offmarket-scraping/` | SimiCap's internal Postgres data pipeline (the engine that produces the sourcing data) | No — internal engine, not the SaaS |
| `off-market-operating-system/` | **NextAutomation's** kit (a competitor's demo, docs signed "By: NextAutomation") + a small FIND replica | No — not ours; do not reproduce their kit content (copyright) |

The productization work lands **here, in `sourcing-platform/`.**

---

## 1. The goal

Let other companies run this console — **multi-tenant**, each **bringing their own keys** (Anthropic
for the LLM, their CRM, their PhoneBurner) and **their own CRM**, plus a **Settings / Integrations**
surface and **billing**. The strategic framing (license/scale) is in the design memos below; this
doc is the technical how.

---

## 2. Current architecture (what exists to build on — the good news)

Most of the plumbing is already here; multi-tenancy is *extending* it, not greenfield:

- **Supabase** — auth already wired (`frontend/src/supabaseAuth.js`, `src/session.js`; `server.mjs`
  `requireAuth` + `SUPABASE_ENABLED`/`SUPABASE_URL`). This is the natural home for **tenants**,
  **per-tenant BYOK secrets**, and **RLS** isolation.
- **`frontend/server.mjs`** (~322 lines) — single Express backend. Routes: `/api/config`,
  `/api/data`, `/api/deals`, `/api/deals-chat`, `/api/live/:action`, `/api/phoneburner/*`. This is
  where per-tenant routing + a Settings/secrets API get added.
- **`frontend/phoneburner.mjs`** — the AI-caller (power dialer) integration. **Today it reads
  single-tenant env vars** (`PHONEBURNER_ACCESS_TOKEN` or the OAuth trio). This is the #1 thing to
  make bring-your-own-key.
- **Pipedrive** integration (`tools/email_to_pipedrive/`) — the seed to generalize into a
  **pluggable CRM adapter** interface.
- **`frontend/tools/encrypt_data.mjs`** — existing encryption tooling; a starting point for the
  envelope encryption of stored secrets.
- Deploy: Dockerfile + `railway.toml` → Railway.

**Single-tenant assumptions to unwind:** env-var keys (`PHONEBURNER_*`, `PIPEDRIVE_*`, LLM key) are
process-global; auth identifies a *user*, not a *tenant*; data/config aren't tenant-scoped.

---

## 3. The design to implement (from the memos — adapt to JS/Supabase)

Two detailed design memos already exist (Python/Pipedrive-grounded, but the **architecture
transfers directly** — reimplement in Node/Supabase):

- `/Users/razkorteran/Desktop/code/SimiCapital/docs/memos/MEMO_2026-07-20_multitenant-byok-crm-architecture.md`
  — the full **BYOK + pluggable-CRM + §8 Settings/self-service** design. This is the primary reference.
- `/Users/razkorteran/Desktop/code/SimiCapital/docs/memos/MEMO_2026-07-20_offmarket-productization-strategy.md`
  — strategy/licensing analysis (some of it competitor/visa-specific; treat as background, not gospel).

Transferable design pillars:

1. **BYOK secret layer.** Envelope encryption: a master **KEK** (Railway env var, never in the DB)
   wraps a **per-tenant DEK**; each secret field encrypted with its tenant's DEK. Store encrypted
   secrets in **Supabase** (`tenant_secrets`, RLS-scoped); KEK in Railway. A **resolver** is the only
   thing that decrypts; **never-leak** rules (write-only in the UI, redacted in logs, masked in
   dry-run). Offboarding a tenant = drop its DEK (crypto-shred). In Node: `crypto` (AES-GCM) or build
   on `encrypt_data.mjs`.
2. **Pluggable CRM adapters.** A canonical lead/contact/property model → an adapter interface each
   CRM implements (`upsertContact/Org/Deal`, `attachNote`). Idempotent **get→create→set** against a
   **tenant-scoped** link table (two tenants sharing an APN must NOT collide). v1 CRMs: keep
   **Pipedrive**, add **Follow Up Boss** + **GoHighLevel** (both static-auth, no OAuth) + a
   **CSV/Zapier webhook** fallback for no-API CRMs (REsimpli, REIPro). HubSpot fast-follow;
   Salesforce/Podio later.
3. **PhoneBurner (AI caller) = BYO.** For multi-tenant, use **OAuth** (each tenant connects their own
   PhoneBurner **Professional-tier** account), not the personal token. It's their own subscription →
   **not metered by you**. It's a power dialer with **live human handoff — no AI voice on cold calls**
   (FCC 24-17). Contacts pushed DNC-scrubbed.
4. **Per-tenant config.** Deal box + markets + CRM choice + secret references (not values).
5. **Settings / self-service (memo §8).** Integrations (API-key entry; render **per auth model** —
   paste field for static keys, "Connect" for OAuth; **Anthropic BYO-vs-metered**; write-only +
   validate-on-save), Outreach identity (CAN-SPAM sender profile + opt-out, **fail-closed**),
   Notifications (the "movers" digest), Billing (**Stripe portal, no card capture**; meter per-market
   + LLM-if-metered; dialer/CRM are the tenant's own subscriptions), Data & privacy (retention +
   crypto-shred offboard).
6. **Deployment model:** shared-multi-tenant on Supabase (RLS + per-tenant DEK) as default;
   clone-per-tenant only as a "dedicated" tier for a regulated customer.

---

## 4. Reference implementation (patterns, not code to copy)

In `offmarket-scraping/` (branch `feat/crm-multitenant-byok`, pushed) there's a **Python** reference
of these exact patterns, built + tested this session:
- `lib/secrets.py` — `EnvelopeCipher` (KEK→DEK), `SecretResolver`, `RedactionFilter`, `EnvBackend`/`PgBackend`.
- `sync/crm/{base,links,pipedrive,registry}.py` — `BaseCrmAdapter` (idempotent `_upsert`), tenant-scoped `DbLinks`, registry.
- Migrations `008` (tenants + tenant_secrets + RLS) and `009` (tenant-scoped link PK).

**That repo is the wrong stack + not the product** — but the *shapes* (envelope crypto, resolver,
adapter interface, tenant-scoped idempotency, never-leak) are proven and translate cleanly to
Node/Supabase. Read it for the pattern if useful; reimplement here idiomatically.

---

## 5. Suggested first steps (for you, the new agent)

1. **Map the real thing before touching it** (the lesson from last session): read `server.mjs` end
   to end, `supabaseAuth.js`/`session.js`, `phoneburner.mjs`, `tools/email_to_pipedrive/`, and the
   **actual Supabase schema** (tables, RLS, whatever migration/seed exists). Write down the current
   single-tenant assumptions.
2. **Confirm the tenancy model with Raz:** shared-multi-tenant on Supabase RLS (recommended) vs
   clone-per-tenant. And confirm scope of the first milestone (backend BYOK first, or Settings UI too).
3. **Implement incrementally, tested, small commits — this repo HAS a remote, so push each phase:**
   a. Supabase `tenants` + `tenant_secrets` (RLS) + envelope crypto (KEK in Railway).
   b. A secret resolver; migrate `phoneburner.mjs` + Pipedrive off env vars onto per-tenant keys
      (stub-safe when a key is absent).
   c. Generalize Pipedrive into the first CRM adapter behind the interface; add Follow Up Boss.
   d. Settings/Integrations UI in the React app.

---

## 6. Constraints & lessons (don't repeat these)

- **Productize `sourcing-platform`** — not the internal `offmarket-scraping` pipeline, not the
  NextAutomation kit.
- **BYOK:** companies bring their own keys. You don't meter their CRM or dialer (their own
  subscriptions); the LLM (Anthropic) can be BYO **or** metered-by-you.
- **Never-leak secrets:** write-only in the UI, encrypted at rest (envelope), redacted in logs,
  masked in dry-run. The Integrations page must render per auth model (paste vs OAuth Connect).
- **Don't reproduce NextAutomation's kit** (`off-market-operating-system/00-09*.md`) — it's theirs.
- This is a **shared repo** (Jacob's remote). Keep sensitive strategy/licensing content in the
  private root memos, not committed here.
