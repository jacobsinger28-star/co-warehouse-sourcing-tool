# Billing / payments setup (Stripe)

The billing layer is a **template for future paying tenants** — SimiCapital's own
workspace is the legacy/house tenant and is exempt everywhere (its Settings shows
"Internal workspace — billing does not apply"). Billing is **dormant** until the
Stripe env vars below are set: with them unset, the summary route still renders
plan/usage, checkout returns `501`, and the webhook refuses everything.

Nothing here charges a card until you complete these steps with your own Stripe
account. Do it in **test mode** first (test keys + test cards); flipping to live
is just swapping the keys.

## 1. Apply the database migration

Run `supabase/migrations/0003_billing.sql` (Supabase Dashboard → SQL editor, or
`supabase db push`). It adds `plan` / `billing_status` / Stripe-linkage columns to
`tenants` and the append-only `usage_events` meter. Safe to apply anytime — every
column defaults to the free-trial state.

## 2. Create the products & prices in Stripe (test mode)

In the Stripe Dashboard (test mode), create one **recurring monthly** price per
paid plan and copy each `price_…` id:

| Plan    | Amount / mo | Env var to hold the price id |
|---------|-------------|------------------------------|
| Starter | $149        | `STRIPE_PRICE_STARTER`       |
| Pro     | $399        | `STRIPE_PRICE_PRO`           |

(The amounts must match `PLANS` in `billing.mjs` — that catalog is the source of
truth the UI renders; Stripe holds the actual charge.)

## 3. Set the env vars (Railway → Variables)

```
STRIPE_SECRET_KEY=sk_test_…        # presence flips billing "on"
STRIPE_WEBHOOK_SECRET=whsec_…      # from step 4
STRIPE_PRICE_STARTER=price_…
STRIPE_PRICE_PRO=price_…
```

Do **not** commit these — the server reads them from the environment only.

## 4. Register the webhook

Stripe Dashboard → Developers → Webhooks → Add endpoint:

- **URL:** `https://<your-domain>/api/billing/webhook`
- **Events:** `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`

Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET`. The server
verifies every webhook's HMAC signature over the raw body (with a 5-minute replay
window) — an unsigned or stale request is rejected with `400`.

## 5. Test the flow

1. Sign in as a **provisioned (non-legacy) tenant** → Settings → Plan & billing.
2. Click a plan → you're redirected to Stripe Checkout.
3. Pay with the test card `4242 4242 4242 4242` (any future expiry, any CVC/ZIP).
4. You return to `/?billing=success`; the webhook flips the tenant to `active`
   and the section shows the new plan. "Manage billing" opens the Stripe Customer
   Portal (card/invoices/cancel).

## How it works (for reference)

- **Routes** (`server.mjs`): `POST /api/tenant/billing` (plan + this month's
  usage), `…/checkout` (returns a Checkout URL; `501` while dormant), `…/portal`
  (Customer Portal URL; `409` if the tenant has never subscribed),
  `POST /api/billing/webhook` (signature-gated, no auth — the signature *is* the
  auth).
- **Metering** is live even while billing is dormant: each Deals-AI call made on
  SimiCapital's Anthropic key is recorded to `usage_events`, so there's real
  consumption history before pricing turns on. A tenant that brings its own LLM
  key is unmetered.
- **Entitlement enforcement**: only the unpaid free **trial** is capped — once its
  included AI calls are spent it gets `402 ai_quota_exceeded` (add your own key or
  upgrade). Paid plans meter-and-bill and are never cut off. This is the single
  `shouldDegradeAi()` policy lever in `billing.mjs`.

## Going live

Swap the four test values for live ones (`sk_live_…`, live price ids, a live
webhook signing secret) and re-register the webhook against the live endpoint.
No code changes.
