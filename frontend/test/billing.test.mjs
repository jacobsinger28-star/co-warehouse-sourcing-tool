// Billing skeleton — plan catalog sanity, usage folding, webhook signature
// verification, and event → tenant-state application against an in-memory
// PostgREST mock (same style as secrets.test.mjs; no live DB, no Stripe).
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  PLANS, billingEnabled, summarizeUsage, monthStartIso,
  verifyStripeSignature, handleStripeEvent, getBillingSummary, recordUsage,
} from '../billing.mjs'

const WHSEC = 'whsec_testsecret'
const sign = (body, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex')}`

// Minimal in-memory PostgREST for `tenants` + `usage_events`.
function installMockDb() {
  const tenants = new Map([['T1', { id: 'T1', plan: 'trial', billing_status: 'trialing', stripe_subscription_id: 'sub_1' }]])
  const usage = []
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url)
    const table = u.pathname.split('/rest/v1/')[1]
    const val = (k) => (u.searchParams.get(k) || '').replace(/^(eq|gte)\./, '')
    const body = opts.body ? JSON.parse(opts.body) : null
    const ok = (rows) => ({ ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) })

    if (table === 'tenants') {
      if (opts.method === 'PATCH') {
        const id = val('id') || [...tenants.values()].find((t) => t.stripe_subscription_id === val('stripe_subscription_id'))?.id
        tenants.set(id, { ...(tenants.get(id) || {}), ...body })
        return ok([tenants.get(id)])
      }
      const bySub = u.searchParams.get('stripe_subscription_id')
      if (bySub) return ok([...tenants.values()].filter((t) => t.stripe_subscription_id === val('stripe_subscription_id')))
      return ok(tenants.has(val('id')) ? [tenants.get(val('id'))] : [])
    }
    if (table === 'usage_events') {
      if (opts.method === 'POST' || !opts.method && opts.body) { usage.push(...body); return ok(body) }
      if (opts.body) { usage.push(...body); return ok(body) }
      return ok(usage.filter((r) => r.tenant_id === val('tenant_id')))
    }
    throw new Error(`unmocked table ${table}`)
  }
  return { tenants, usage }
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test'
})
afterEach(() => { delete process.env.STRIPE_SECRET_KEY })

test('plan catalog is coherent and billing defaults off', () => {
  assert.equal(billingEnabled(), false)
  for (const p of Object.values(PLANS)) {
    assert.ok(p.id && p.label)
    assert.ok(Number.isFinite(p.priceMonthly))
    assert.ok(p.meteredAiCalls > 0)
  }
  assert.equal(PLANS.trial.priceMonthly, 0)
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  assert.equal(billingEnabled(), true)
})

test('summarizeUsage folds rows by kind', () => {
  assert.deepEqual(summarizeUsage([
    { kind: 'llm.deals_chat', qty: 1 }, { kind: 'llm.deals_chat', qty: '2' }, { kind: 'other', qty: 5 },
  ]), { 'llm.deals_chat': 3, other: 5 })
  assert.deepEqual(summarizeUsage([]), {})
  assert.ok(monthStartIso(new Date('2026-07-22T10:00:00Z')).startsWith('2026-07-01T00:00:00'))
})

test('webhook signature: valid passes, tampered/stale/garbage fail', () => {
  const body = JSON.stringify({ type: 'x' })
  assert.equal(verifyStripeSignature(body, sign(body), WHSEC), true)
  assert.equal(verifyStripeSignature(body + ' ', sign(body), WHSEC), false)          // tampered body
  assert.equal(verifyStripeSignature(body, sign(body), 'whsec_other'), false)        // wrong secret
  const stale = Math.floor(Date.now() / 1000) - 3600
  assert.equal(verifyStripeSignature(body, sign(body, stale), WHSEC), false)         // replay
  assert.equal(verifyStripeSignature(body, 'not-a-header', WHSEC), false)
  assert.equal(verifyStripeSignature(body, '', WHSEC), false)
})

test('checkout.session.completed activates the tenant plan', async () => {
  const { tenants } = installMockDb()
  const r = await handleStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: 'T1', customer: 'cus_9', subscription: 'sub_9', metadata: { plan: 'pro' } } },
  })
  assert.equal(r.ok, true)
  const t = tenants.get('T1')
  assert.equal(t.plan, 'pro')
  assert.equal(t.billing_status, 'active')
  assert.equal(t.stripe_customer_id, 'cus_9')
})

test('subscription.deleted cancels; unknown events are ignored, not errors', async () => {
  const { tenants } = installMockDb()
  const r = await handleStripeEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } })
  assert.equal(r.ok, true)
  assert.equal(tenants.get('T1').billing_status, 'canceled')
  const ignored = await handleStripeEvent({ type: 'invoice.finalized', data: { object: {} } })
  assert.equal(ignored.ignored, true)
})

test('getBillingSummary: legacy is internal; real tenant reports plan + usage', async () => {
  installMockDb()
  const legacy = await getBillingSummary({ id: 'default', source: 'legacy' })
  assert.equal(legacy.internal, true)
  await recordUsage('T1', 'llm.deals_chat', 1)
  await recordUsage('T1', 'llm.deals_chat', 1)
  const s = await getBillingSummary({ id: 'T1', source: 'db' })
  assert.equal(s.internal, false)
  assert.equal(s.plan, 'trial')
  assert.equal(s.usage.aiCalls, 2)
  assert.equal(s.usage.aiCallsIncluded, PLANS.trial.meteredAiCalls)
})

test('recordUsage refuses the legacy/default tenant', async () => {
  const { usage } = installMockDb()
  await recordUsage('default', 'llm.deals_chat', 1)
  await recordUsage(null, 'llm.deals_chat', 1)
  assert.equal(usage.length, 0)
})
