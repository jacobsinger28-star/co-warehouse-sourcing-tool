// Phase 0 — tenant resolution. Runs with `npm test` (node:test, no live DB).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  _pickTenant, resolveTenant, DEFAULT_TENANT, _clearCache,
  resolveTenantByWebhookSecret, getTenantWebhookSecret,
} from '../tenants.mjs'

const T = (over = {}) => ({ id: 't1', slug: 'acme', name: 'Acme', status: 'active', ...over })

// Snapshot env keys and return a restore fn that DELETEs keys that were unset
// (assigning `undefined` would coerce to the truthy string "undefined").
function saveEnv(...keys) {
  const snap = keys.map((k) => [k, process.env[k]])
  return () => {
    for (const [k, v] of snap) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}

// ── _pickTenant (pure) ───────────────────────────────────────────────────────
test('_pickTenant: exact email beats a whole-domain match', () => {
  const rows = [
    { email: '@acme.com', role: 'member', tenants: T({ id: 'dom', slug: 'acme-dom' }) },
    { email: 'ceo@acme.com', role: 'owner', tenants: T({ id: 'exact', slug: 'acme' }) },
  ]
  const t = _pickTenant(rows, 'ceo@acme.com')
  assert.equal(t.id, 'exact')
  assert.equal(t.role, 'owner')
  assert.equal(t.source, 'db')
})

test('_pickTenant: falls back to the domain wildcard when no exact row', () => {
  const rows = [{ email: '@acme.com', role: 'member', tenants: T() }]
  assert.equal(_pickTenant(rows, 'newhire@acme.com').id, 't1')
})

test('_pickTenant: no matching row → null', () => {
  const rows = [{ email: '@other.com', role: 'member', tenants: T() }]
  assert.equal(_pickTenant(rows, 'x@acme.com'), null)
})

test('_pickTenant: a suspended tenant is refused', () => {
  const rows = [{ email: 'x@acme.com', role: 'owner', tenants: T({ status: 'suspended' }) }]
  assert.equal(_pickTenant(rows, 'x@acme.com'), null)
})

test('_pickTenant: empty / missing rows → null', () => {
  assert.equal(_pickTenant([], 'x@acme.com'), null)
  assert.equal(_pickTenant(undefined, 'x@acme.com'), null)
})

// ── resolveTenant legacy fallback (tenancy OFF) ──────────────────────────────
test('resolveTenant: tenancy off → allow-listed email gets the default tenant', async (t) => {
  const restore = saveEnv('SUPABASE_SERVICE_ROLE_KEY')
  delete process.env.SUPABASE_SERVICE_ROLE_KEY // → tenancyEnabled() false
  t.after(() => { restore(); _clearCache() })

  const yes = await resolveTenant('raz@simicap.com', { legacyAllowed: () => true })
  assert.equal(yes.source, 'legacy')
  assert.equal(yes.slug, DEFAULT_TENANT.slug)
  const no = await resolveTenant('stranger@evil.com', { legacyAllowed: () => false })
  assert.equal(no, null)
})

// ── resolveTenant DB path (tenancy ON) ───────────────────────────────────────
test('resolveTenant: tenancy on → resolves via the DB and caches', async (t) => {
  const restore = saveEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
  const savedFetch = globalThis.fetch
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test'
  _clearCache()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    const rows = [{ email: 'ceo@acme.com', role: 'owner', tenants: T() }]
    return { ok: true, json: async () => rows, text: async () => JSON.stringify(rows) }
  }
  t.after(() => { restore(); globalThis.fetch = savedFetch; _clearCache() })

  const first = await resolveTenant('ceo@acme.com')
  assert.equal(first.id, 't1')
  assert.equal(first.source, 'db')
  const second = await resolveTenant('ceo@acme.com') // cached → no second fetch
  assert.equal(second.id, 't1')
  assert.equal(calls, 1, 'second lookup should hit the cache, not the DB')
})

test('resolveTenant: a DB error fails closed (→ null, not a crash)', async (t) => {
  const restore = saveEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
  const savedFetch = globalThis.fetch
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test'
  _clearCache()
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'db down' })
  t.after(() => { restore(); globalThis.fetch = savedFetch; _clearCache() })

  assert.equal(await resolveTenant('someone@acme.com'), null)
})

// ── webhook-secret resolution (Phase 2c) ─────────────────────────────────────
test('resolveTenantByWebhookSecret: maps a secret to its tenant; unknown / empty → null', async (t) => {
  const restore = saveEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
  const savedFetch = globalThis.fetch
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test'
  let seenQuery = ''
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    seenQuery = u.search
    const secret = (u.searchParams.get('webhook_secret') || '').replace(/^eq\./, '')
    const rows = secret === 'goodsecret' ? [{ id: 't9', slug: 'acme', name: 'Acme' }] : []
    return { ok: true, json: async () => rows, text: async () => JSON.stringify(rows) }
  }
  t.after(() => { restore(); globalThis.fetch = savedFetch })

  const hit = await resolveTenantByWebhookSecret('goodsecret')
  assert.equal(hit.id, 't9')
  assert.equal(hit.source, 'db')
  assert.match(seenQuery, /webhook_secret=eq\.goodsecret/)
  assert.equal(await resolveTenantByWebhookSecret('nope'), null)
  assert.equal(await resolveTenantByWebhookSecret(''), null) // empty secret never resolves
})

test('getTenantWebhookSecret: returns the row secret; null when tenancy is off', async (t) => {
  const restore = saveEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
  const savedFetch = globalThis.fetch
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test'
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ webhook_secret: 'abc123' }], text: async () => '' })
  t.after(() => { restore(); globalThis.fetch = savedFetch })

  assert.equal(await getTenantWebhookSecret('t9'), 'abc123')
  delete process.env.SUPABASE_SERVICE_ROLE_KEY // tenancy off → no lookup
  assert.equal(await getTenantWebhookSecret('t9'), null)
})
