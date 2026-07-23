# Session Log — 2026-07-23 — Productization COMPLETE (Phase 3 + billing lifecycle + security review)

Closes out the multi-tenant BYOK productization. **All numbered architecture phases
are now implemented, reviewed, hardened, and on `origin/main`.** This log is the
handoff — read "What's left" for the (deferred, non-architecture) remainder.

## Milestone: architecture done
| Phase | Status |
|---|---|
| 0 tenant boundary · 1 secret layer | ✅ (earlier) |
| 2a dealsChat · 2b Pipedrive · **2c PhoneBurner** | ✅ (2c this arc) |
| **3 pluggable CRM adapters** | ✅ (this arc) |
| 4 Settings/Integrations UI | ✅ (earlier) |
| Billing/license lifecycle | ✅ (this arc) |

The backend BYOK milestone is complete: dealsChat, Pipedrive, and PhoneBurner all
run per-tenant with no env-token leak, and CRM is now pluggable (Pipedrive + Follow
Up Boss + GoHighLevel + webhook fallback behind one adapter interface).

## What shipped (on `origin/main`)
- **Billing/license lifecycle** — Stripe hosted **Customer Portal** ("Manage billing"),
  plan **entitlements** read-model, dormant-safe **trial AI cap**. (Reconciled to
  origin's `f745e99`, functionally identical.) Flow is a **full-page redirect** to
  Stripe-hosted checkout (button per plan in Settings → checkout → back to app active);
  no card data touches the server. `tools/stripe_preview.mjs` opens the real test pages.
- **Phase 2c — PhoneBurner BYOK** — per-tenant creds + webhook→tenant routing
  (migration `0004_webhook_secret`); closed the last cross-tenant leak.
- **Phase 3 — pluggable CRM** — `crm/{base,registry,pipedrive,followupboss,gohighlevel,
  webhook}.mjs`; per-tenant CRM resolution (first-configured wins, null → 503, never env);
  `/api/pipedrive/*` routes dispatch to the chosen CRM. HubSpot/Close/Zoho are storable
  fast-follows (no adapter yet). Dockerfile `COPY crm/`.
- **Deploy hardening restored** — the glob-copy + `check-imports` guard (lost in the
  `1970e17` trunk merge) + a boot-smoke build step. See [[deploy-image-hardening]].
- **Security/privacy review** — 3 parallel audit agents (auth/injection/SSRF, BYOK
  isolation, PII/robustness). Crown-jewel areas verified sound (crypto, tenant
  isolation, redaction, demo boundary). Fixes committed (`f08672a`): **SSRF guard**
  for the tenant webhook URL (`crm/safeUrl.mjs`), platform-env bleed gated to legacy
  (Pipedrive owner/stage), shared `isLegacyTenant()`, constant-time secret compares,
  PhoneBurner OAuth `state`, FUB/GHL dedup, timeouts, resilient `pushContacts`.

## What's left (NOT architecture — deferred / fast-follow / rollout)
- **Deferred security hardening** (documented in `f08672a`): metered-AI concurrent-race
  atomic counter (trial free-spend), password brute-force rate limit, error-body
  redaction, PhoneBurner webhook body signature, JWT verify-cache expiry cap.
- **CRM breadth**: HubSpot/Close/Zoho adapters (keys already storable).
- **memo §8 self-service** (never numbered phases): outreach identity (CAN-SPAM,
  fail-closed — needed before any tenant emails owners), notifications, data-&-privacy
  offboard/crypto-shred.
- **Rollout (Raz's)** — apply migrations `0001`→`0004`; set `SECRETS_KEK` +
  `SUPABASE_SERVICE_ROLE_KEY` (+ `STRIPE_*` for billing) in Railway; seed a tenant.
  Everything stays dormant until then; the legacy SimiCapital workspace is unchanged.

## Notes for whoever picks this up
- **Heavy multi-agent session.** The trunk diverged and was reconciled (reset to the
  canonical `origin/main` + cherry-pick unique work); the reconcile agents folded in
  lease-rate + added-date + UI changes on their side. Push via the fetch→ff-check→
  rebase flow; several `claude/*` worktrees may still be active — see [[concurrent-sessions-shared-worktree]].
- **`backup/local-main-bd0b4a3`** is this session's pre-reconcile safety net; its
  content is all on `origin` (reconciled), so it's redundant and safe to delete — left
  in place (unmerged by hash; not force-deleted).
- **Payment UX** is a redirect flow today; an embedded in-app popup is an option if a
  smoother experience is wanted (discussed, not built).
