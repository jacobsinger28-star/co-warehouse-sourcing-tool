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

// ── entitlements — turn the plan catalog into concrete this-cycle limits ──────
// The one place plan limits are interpreted, so the server (enforcement), the
// Settings summary, and the tests all agree on what a plan actually grants.

/**
 * Pure: the entitlement snapshot for a tenant row + its folded usage. No I/O.
 * `paid` = a live subscription (active, or past_due while Stripe dunning runs) —
 * those meter-and-bill and are never blocked; the free trial has no card, so its
 * included AI calls are a hard cap, not just a soft meter.
 */
export function entitlementsFor(row, usage = {}) {
  const plan = PLANS[row?.plan] || PLANS.trial
  const status = row?.billing_status || 'trialing'
  const paid = status === 'active' || status === 'past_due'
  const used = Number(usage['llm.deals_chat'] || 0)
  const included = plan.meteredAiCalls
  return {
    plan: plan.id, seats: plan.seats, status, paid,
    aiCalls: { used, included, remaining: Math.max(0, included - used), over: used >= included },
  }
}

/**
 * Whether a metered tenant must stop riding SimiCapital's Anthropic key. Only the
 * unpaid free trial degrades once its included calls are spent (no card on file to
 * bill overage to); paid plans meter-and-bill and are never cut off. This single
 * line is the block-vs-bill policy lever.
 */
export const shouldDegradeAi = (ent) => Boolean(ent && !ent.paid && ent.aiCalls.over)

// Shared read: a tenant's billing row + this month's folded usage.
async function loadTenantBilling(tenantId) {
  const rows = await dbSelect('tenants',
    `select=plan,billing_status,current_period_end,stripe_customer_id&id=eq.${enc(tenantId)}&limit=1`)
  const usage = summarizeUsage(await dbSelect('usage_events',
    `select=kind,qty&tenant_id=eq.${enc(tenantId)}&created_at=gte.${enc(monthStartIso())}&limit=10000`))
  return { row: rows[0] || null, usage }
}

/**
 * Live entitlement snapshot for server-side enforcement. Returns null for the
 * legacy/default house workspace and when tenancy is off (both unmetered), and
 * fails OPEN on a lookup error — a metering hiccup must never deny a user their AI.
 */
export async function aiEntitlement(tenant) {
  if (!tenancyEnabled() || !tenant || tenant.source === 'legacy' || tenant.id === 'default') return null
  try {
    const { row, usage } = await loadTenantBilling(tenant.id)
    return entitlementsFor(row, usage)
  } catch (e) { console.error('[billing] entitlement lookup failed', e.message); return null }
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
    try { ({ row, usage } = await loadTenantBilling(tenant.id)) }
    catch (e) { console.error('[billing] summary lookup failed', e.message) }
  }
  const ent = entitlementsFor(row, usage)
  return {
    enabled: billingEnabled(),
    internal: false,
    plan: ent.plan,
    status: ent.status,
    renewsAt: row?.current_period_end || null,
    hasPaymentMethod: Boolean(row?.stripe_customer_id),
    canManage: billingEnabled() && Boolean(row?.stripe_customer_id),
    usage: {
      period: monthStartIso(),
      aiCalls: ent.aiCalls.used,
      aiCallsIncluded: ent.aiCalls.included,
      aiCallsRemaining: ent.aiCalls.remaining,
    },
    entitlements: ent,
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

/**
 * Deep-link to Stripe's hosted Customer Portal so a subscribed tenant can update
 * its payment method, download invoices, or cancel — the "Manage billing" button.
 * We store only the customer id; Stripe hosts the rest, so no card data ever
 * touches this server. Throws {code:'not_enabled'} until Stripe is wired, and
 * {code:'no_customer'} for a tenant that hasn't completed a checkout yet.
 */
export async function createPortalSession(tenant, { returnUrl }) {
  if (!billingEnabled()) { const e = new Error('billing is not enabled on this server'); e.code = 'not_enabled'; throw e }
  let customerId = tenant?.stripe_customer_id || null
  if (!customerId && tenancyEnabled()) {
    const rows = await dbSelect('tenants', `select=stripe_customer_id&id=eq.${enc(tenant.id)}&limit=1`)
    customerId = rows[0]?.stripe_customer_id || null
  }
  if (!customerId) { const e = new Error('no active subscription to manage yet'); e.code = 'no_customer'; throw e }
  const session = await stripePost('billing_portal/sessions', { customer: customerId, return_url: returnUrl })
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
