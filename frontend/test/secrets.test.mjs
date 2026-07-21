// Phase 1 — BYOK secret layer. Proves the envelope round-trip, tenant isolation,
// dry-run masking, and redaction against an in-memory PostgREST mock (no live DB).
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { SecretResolver, writeSecret, redact, registerSecret, secretsEnabled, _resetForTest } from '../secrets.mjs'

const KEK = Buffer.alloc(32, 7).toString('base64') // deterministic 32-byte test KEK

// Minimal in-memory PostgREST for `tenants` + `tenant_secrets`.
function installMockDb(seedTenantIds = ['A', 'B']) {
  const tenants = new Map(seedTenantIds.map((id) => [id, { dek_wrapped: null, kek_version: 1 }]))
  const secrets = new Map() // `${tid}|${provider}|${field}` -> { field, ciphertext }
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url)
    const table = u.pathname.split('/rest/v1/')[1]
    const val = (k) => (u.searchParams.get(k) || '').replace(/^eq\./, '')
    const body = opts.body ? JSON.parse(opts.body) : null
    const ok = (rows) => ({ ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) })

    if (table === 'tenants') {
      const id = val('id')
      if (opts.method === 'PATCH') { tenants.set(id, { ...(tenants.get(id) || {}), ...body }); return ok([tenants.get(id)]) }
      return ok(tenants.has(id) ? [{ dek_wrapped: tenants.get(id).dek_wrapped }] : [])
    }
    if (table === 'tenant_secrets') {
      if (opts.method === 'POST') {
        for (const r of body) secrets.set(`${r.tenant_id}|${r.provider}|${r.field}`, { field: r.field, ciphertext: r.ciphertext })
        return ok(body)
      }
      const tid = val('tenant_id'), provider = val('provider'), field = u.searchParams.get('field')
      const rows = []
      for (const [key, row] of secrets) {
        const [ktid, kprov, kfield] = key.split('|')
        if (ktid !== tid || kprov !== provider) continue
        if (field && kfield !== field.replace(/^eq\./, '')) continue
        rows.push(row)
      }
      return ok(rows)
    }
    throw new Error(`unmocked table ${table}`)
  }
  return { tenants, secrets }
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test'
  process.env.SECRETS_KEK = KEK
  _resetForTest()
})
afterEach(() => {
  delete process.env.SECRETS_KEK
  _resetForTest()
})

test('secretsEnabled reflects KEK + tenancy', () => {
  assert.equal(secretsEnabled(), true)
  delete process.env.SECRETS_KEK
  assert.equal(secretsEnabled(), false)
})

test('envelope round-trip: writeSecret then resolve returns the plaintext', async () => {
  installMockDb(['A'])
  await writeSecret('A', 'crm.pipedrive', 'api_token', 'pd-secret-123456')
  const r = new SecretResolver({ id: 'A', source: 'db' })
  assert.equal(await r.get('crm.pipedrive', 'api_token'), 'pd-secret-123456')
})

test('ciphertext at rest is not the plaintext (actually encrypted)', async () => {
  const db = installMockDb(['A'])
  await writeSecret('A', 'llm.anthropic', 'api_key', 'sk-ant-supersecretvalue')
  const stored = db.secrets.get('A|llm.anthropic|api_key').ciphertext
  assert.ok(!stored.includes('supersecret'), 'stored ciphertext must not contain the plaintext')
  assert.ok(db.tenants.get('A').dek_wrapped, 'a wrapped DEK should have been created on first write')
})

test('tenant isolation: tenant B never reads tenant A key, and never falls back to env', async () => {
  installMockDb(['A', 'B'])
  process.env.PIPEDRIVE_API_TOKEN = 'legacy-env-token' // must NOT leak to a real tenant
  await writeSecret('A', 'crm.pipedrive', 'api_token', 'tenant-A-only')
  const rB = new SecretResolver({ id: 'B', source: 'db' })
  assert.equal(await rB.get('crm.pipedrive', 'api_token'), null, 'B has no key → null, not env, not A')
  delete process.env.PIPEDRIVE_API_TOKEN
})

test('legacy/default tenant uses the env-var fallback', async () => {
  installMockDb([])
  process.env.PIPEDRIVE_API_TOKEN = 'legacy-env-token'
  const r = new SecretResolver({ id: 'default', source: 'legacy' })
  assert.equal(await r.get('crm.pipedrive', 'api_token'), 'legacy-env-token')
  assert.equal(await r.get('crm.pipedrive', 'missing_field'), null)
  delete process.env.PIPEDRIVE_API_TOKEN
})

test('dry-run masks the value but still reports configured', async () => {
  installMockDb(['A'])
  await writeSecret('A', 'crm.pipedrive', 'api_token', 'pd-secret-123456')
  const r = new SecretResolver({ id: 'A', source: 'db' }, { dryRun: true })
  assert.equal(await r.get('crm.pipedrive', 'api_token'), '****')
  assert.equal(await r.configured('crm.pipedrive'), true)
  assert.equal(await r.configured('dialer.phoneburner'), false)
})

test('getProvider returns all fields for a provider', async () => {
  installMockDb(['A'])
  await writeSecret('A', 'dialer.phoneburner', 'client_id', 'cid-123456')
  await writeSecret('A', 'dialer.phoneburner', 'client_secret', 'csecret-123456')
  const r = new SecretResolver({ id: 'A', source: 'db' })
  const bundle = await r.getProvider('dialer.phoneburner')
  assert.deepEqual(bundle, { client_id: 'cid-123456', client_secret: 'csecret-123456' })
})

test('a real tenant with no key resolves to null (stub-safe), not a throw', async () => {
  installMockDb(['A'])
  const r = new SecretResolver({ id: 'A', source: 'db' })
  assert.equal(await r.get('crm.pipedrive', 'api_token'), null)
})

test('redact scrubs registered secrets + credential-shaped strings', () => {
  registerSecret('pd-secret-123456')
  assert.equal(redact('token is pd-secret-123456 done'), 'token is ***REDACTED*** done')
  assert.equal(redact('GET /deals?api_token=abc123XYZ&start=0'), 'GET /deals?api_token=***REDACTED***&start=0')
  assert.match(redact('key sk-ant-abcdef0123456789'), /sk-ant-abcdef…REDACTED/)
})

test('resolving a real secret registers it for redaction', async () => {
  installMockDb(['A'])
  await writeSecret('A', 'crm.pipedrive', 'api_token', 'zzz-live-secret-987654')
  const r = new SecretResolver({ id: 'A', source: 'db' })
  await r.get('crm.pipedrive', 'api_token')
  assert.equal(redact('leaked zzz-live-secret-987654 here'), 'leaked ***REDACTED*** here')
})
