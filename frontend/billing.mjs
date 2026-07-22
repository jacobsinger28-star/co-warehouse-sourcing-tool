// billing.mjs — the billing skeleton: plan catalog, per-tenant usage metering,
// and a Stripe integration shaped for later "go live" with zero refactoring.
//
// Deliberately dependency-free (no stripe SDK): Stripe's REST API is plain
// form-encoded POSTs, and webhook signatures are HMAC-SHA256 via node:crypto —
// same lean style as db.mjs/secrets.mjs.
//
// Off by default: billingEnabled() is false until STRIPE_SECRET_KEY is set, and
// every route degrades to a friendly "billing isn't live yet" state. The one part
// that IS live immediately is usage metering (usage_events), so by the time
// pricing is turned on there's real consumption history to bill against.
//
// Env (all optional until launch):
//   STRIPE_SECRET_KEY      — sk_live_… / sk_test_…; presence flips billingEnabled()
//   STRIPE_WEBHOOK_SECRET  — whsec_…; required to accept webhook events
//   STRIPE_PRICE_STARTER   — price_… id for the Starter subscription
//   STRIPE_PRICE_PRO       — price_… id for the Pro subscription
import { createHmac, timingSafeEqual } from 'node:crypto'
import { tenancyEnabled, dbSelect, dbUpsert, dbPatch } from './db.mjs'

const enc = encodeURIComponent

// ── plan catalog — the single source of truth the UI + checkout both read ─────
// meteredAiCalls = Deals-AI calls/month included while the tenant runs on
// SimiCapital's Anthropic key; a tenant that brings its own LLM key is unmetered.
export const PLANS = {
  trial: { id: 'trial', label: 'Trial', priceMonthly: 0, seats: 2, meteredAiCalls: 50, priceEnv: null },
  starter: { id: 'starter', label: 'Starter', priceMonthly: 149, seats: 5, meteredAiCalls: 500, priceEnv: 'STRIPE_PRICE_STARTER' },
  pro: { id: 'pro', label: 'Pro', priceMonthly: 399, seats: 20, meteredAiCalls: 3000, priceEnv: 'STRIPE_PRICE_PRO' },
}

/** Billing goes live only when the server holds a Stripe secret key. */
export const billingEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY)

// ── usage metering (live today, billed later) ─────────────────────────────────

/** First instant of the current calendar month, ISO (UTC) — the metering window. */
export const monthStartIso = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

/**
 * Append one usage event for a real tenant. Fire-and-forget at call sites — a
 * metering hiccup must never fail the user's actual request.
 */
export async function recordUsage(tenantId, kind, qty = 1, meta = {}) {
  if (!tenancyEnabled() || !tenantId || tenantId === 'default') return
  try {
    await dbUpsert('usage_events', { tenant_id: tenantId, kind, qty, meta })
  } catch (e) {
    console.error('[billing] usage write failed', e.message)
  }
}

/** Pure: fold usage rows [{kind, qty}] into {kind: total}. Unit-testable, no I/O. */
export function summarizeUsage(rows) {
  const out = {}
  for (const r of rows || []) out[r.kind] = (out[r.kind] || 0) + Number(r.qty || 0)
  return out
}

/**
 * The billing state the Settings UI renders for req.tenant. The legacy/default
 * tenant is the house workspace — billing does not apply to it.
 * Never throws on a missing row: falls back to the trial defaults.
 */
export async function getBillingSummary(tenant) {
  const legacy = !tenant || tenant.source === 'legacy' || tenant.id === 'default'
  if (legacy) return { enabled: billingEnabled(), internal: true, plans: PLANS }
  let row = null, usage = {}
  if (tenancyEnabled()) {
    try {
      const rows = await dbSelect('tenants',
        `select=plan,billing_status,current_period_end,stripe_customer_id&id=eq.${enc(tenant.id)}&limit=1`)
      row = rows[0] || null
      usage = summarizeUsage(await dbSelect('usage_events',
        `select=kind,qty&tenant_id=eq.${enc(tenant.id)}&created_at=gte.${enc(monthStartIso())}&limit=10000`))
    } catch (e) {
      console.error('[billing] summary lookup failed', e.message)
    }
  }
  const plan = PLANS[row?.plan] || PLANS.trial
  return {
    enabled: billingEnabled(),
    internal: false,
    plan: plan.id,
    status: row?.billing_status || 'trialing',
    renewsAt: row?.current_period_end || null,
    hasPaymentMethod: Boolean(row?.stripe_customer_id),
    usage: { period: monthStartIso(), aiCalls: usage['llm.deals_chat'] || 0, aiCallsIncluded: plan.meteredAiCalls },
    plans: PLANS,
  }
}

// ── Stripe REST (form-encoded fetch — no SDK) ─────────────────────────────────

async function stripePost(path, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`stripe ${path} -> ${r.status} ${data?.error?.message || ''}`.trim())
  return data
}

/**
 * Start a subscription checkout for `planId` and return { url } to redirect to.
 * client_reference_id carries the tenant id so the webhook can link the
 * subscription back without any lookup table.
 */
export async function createCheckout(tenant, planId, { successUrl, cancelUrl }) {
  const plan = PLANS[planId]
  if (!plan || !plan.priceEnv) throw new Error(`plan '${planId}' is not purchasable`)
  const price = process.env[plan.priceEnv]
  if (!billingEnabled()) { const e = new Error('billing is not enabled on this server'); e.code = 'not_enabled'; throw e }
  if (!price) { const e = new Error(`no Stripe price configured for ${plan.label} (set ${plan.priceEnv})`); e.code = 'not_enabled'; throw e }
  const session = await stripePost('checkout/sessions', {
    mode: 'subscription',
    client_reference_id: tenant.id,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    'metadata[tenant_id]': tenant.id,
    'metadata[plan]': plan.id,
    'subscription_data[metadata][tenant_id]': tenant.id,
    'subscription_data[metadata][plan]': plan.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
  })
  return { url: session.url }
}

// ── webhook: signature check + the few events that change tenant state ────────

/**
 * Verify a Stripe-Signature header against the raw request body.
 * Format: "t=<unix>,v1=<hmac>[,v1=…]" where v1 = HMAC-SHA256(secret, `${t}.${body}`).
 * Constant-time compare; rejects stale timestamps (>5 min) to stop replays.
 */
export function verifyStripeSignature(rawBody, sigHeader, secret, nowMs = Date.now()) {
  if (!rawBody || !sigHeader || !secret) return false
  const parts = Object.create(null)
  for (const kv of String(sigHeader).split(',')) {
    const i = kv.indexOf('=')
    if (i < 1) continue
    const k = kv.slice(0, i).trim()
    ;(parts[k] ||= []).push(kv.slice(i + 1).trim())
  }
  const t = Number(parts.t?.[0])
  if (!t || Math.abs(nowMs - t * 1000) > 5 * 60_000) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const exp = Buffer.from(expected)
  return (parts.v1 || []).some((sig) => {
    const got = Buffer.from(String(sig))
    return got.length === exp.length && timingSafeEqual(got, exp)
  })
}

/**
 * Apply one verified Stripe event to tenant billing state. Idempotent patches —
 * replaying an event re-writes the same columns. Unknown events are ignored
 * (return {ignored:true}) so new Stripe event types never 500 the webhook.
 */
export async function handleStripeEvent(event) {
  const type = event?.type || ''
  const obj = event?.data?.object || {}
  if (type === 'checkout.session.completed') {
    const tenantId = obj.client_reference_id || obj.metadata?.tenant_id
    if (!tenantId) return { ignored: true, reason: 'no tenant reference' }
    await dbPatch('tenants', `id=eq.${enc(tenantId)}`, {
      plan: obj.metadata?.plan || 'starter',
      billing_status: 'active',
      stripe_customer_id: obj.customer || null,
      stripe_subscription_id: obj.subscription || null,
    })
    return { ok: true, tenantId }
  }
  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const rows = await dbSelect('tenants', `select=id&stripe_subscription_id=eq.${enc(obj.id)}&limit=1`)
    if (!rows.length) return { ignored: true, reason: 'unknown subscription' }
    const deleted = type.endsWith('deleted')
    const patch = deleted
      ? { billing_status: 'canceled' }
      : {
          billing_status: obj.status === 'past_due' ? 'past_due' : obj.status === 'canceled' ? 'canceled' : 'active',
          plan: obj.metadata?.plan || undefined,
          current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
        }
    if (patch.plan === undefined) delete patch.plan
    await dbPatch('tenants', `id=eq.${enc(rows[0].id)}`, patch)
    return { ok: true, tenantId: rows[0].id }
  }
  return { ignored: true, reason: `unhandled event ${type}` }
}
