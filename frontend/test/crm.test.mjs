// Phase 3 — pluggable CRM adapters. Registry resolution + each adapter, mocked.
// The guarantees under test: the registry picks a tenant's first-configured CRM
// and returns null when none is set (never an env fallback for a real tenant);
// each adapter authenticates with ITS creds; dryRun writes nothing.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { CRM_REGISTRY, CRM_PROVIDERS, crmFor, legacyCrm, resolveTenantCrm } from '../crm/registry.mjs'
import { PipedriveAdapter } from '../crm/pipedrive.mjs'
import { FollowUpBossAdapter } from '../crm/followupboss.mjs'
import { GoHighLevelAdapter } from '../crm/gohighlevel.mjs'
import { WebhookAdapter } from '../crm/webhook.mjs'
import { splitName, brokerLines, leadLines, dealTitle, leadContact } from '../crm/base.mjs'

const savedFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = savedFetch; delete process.env.PIPEDRIVE_API_TOKEN })

test('base helpers: splitName / dealTitle / leadContact / lines', () => {
  assert.deepEqual(splitName('Jane Doe'), { firstName: 'Jane', lastName: 'Doe' })
  assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '' })
  assert.deepEqual(splitName(''), { firstName: '', lastName: '' })
  assert.equal(dealTitle({ addr: '123 Main', mkt: 'Tampa', st: 'FL' }), '123 Main · Tampa, FL')
  assert.equal(leadContact({ channel: 'on', broker: 'B', phone: '5551212' }).name, 'B')
  assert.equal(leadContact({ channel: 'off', owner: 'O' }).name, 'O')
  assert.ok(brokerLines({ firm: 'X' }).some((l) => l.includes('Firm: X')))
  assert.ok(leadLines({ addr: '1 A St', apn: '99' }).some((l) => l.includes('APN: 99')))
})

test('registry: providers coherent; crmFor builds the right adapter type', () => {
  assert.deepEqual(CRM_PROVIDERS, ['crm.pipedrive', 'crm.followupboss', 'crm.gohighlevel', 'crm.webhook'])
  for (const e of CRM_REGISTRY) assert.ok(e.provider && e.fields.length && typeof e.make === 'function')
  assert.ok(crmFor('crm.followupboss', { api_key: 'k' }) instanceof FollowUpBossAdapter)
  assert.ok(crmFor('crm.gohighlevel', { api_key: 'k' }) instanceof GoHighLevelAdapter)
  assert.ok(crmFor('crm.webhook', { url: 'https://x' }) instanceof WebhookAdapter)
  assert.equal(crmFor('crm.unknown', {}), null)
  assert.equal(legacyCrm().provider, 'crm.pipedrive')
  assert.ok(legacyCrm().adapter instanceof PipedriveAdapter)
})

test('resolveTenantCrm: first configured CRM wins; none configured → null (never env)', async () => {
  const mk = (store) => ({ get: async (p, f) => store[`${p}/${f}`] ?? null }) // like a real tenant's SecretResolver
  const fub = await resolveTenantCrm(mk({ 'crm.followupboss/api_key': 'FUB_KEY' }))
  assert.equal(fub.provider, 'crm.followupboss')
  assert.ok(fub.adapter instanceof FollowUpBossAdapter)
  const pd = await resolveTenantCrm(mk({ 'crm.pipedrive/api_token': 'T', 'crm.webhook/url': 'https://x' }))
  assert.equal(pd.provider, 'crm.pipedrive') // registry order: pipedrive before webhook
  assert.equal(await resolveTenantCrm(mk({})), null) // nothing → null, the isolation guarantee
})

test('WebhookAdapter: dryRun previews; send POSTs canonical JSON; unconfigured throws', async () => {
  const wh = new WebhookAdapter({ url: 'https://hook.test/x' })
  assert.equal(wh.configured(), true)
  const dry = await wh.pushLead({ addr: '1 A St', channel: 'off', owner: 'O' }, { dryRun: true })
  assert.equal(dry.status, 'dry_run')
  assert.equal(dry.would_send.type, 'lead')
  assert.ok(dry.would_send.note.includes('Off-market'))

  let sent = null
  globalThis.fetch = async (url, opts) => { sent = { url: String(url), body: JSON.parse(opts.body) }; return { ok: true, status: 200, text: async () => '' } }
  const r = await wh.syncBroker({ name: 'Jane', firm: 'Acme' })
  assert.equal(r.status, 'sent')
  assert.equal(sent.url, 'https://hook.test/x')
  assert.equal(sent.body.type, 'broker')
  assert.equal(sent.body.broker.name, 'Jane')

  assert.equal(new WebhookAdapter({}).configured(), false)
  await assert.rejects(() => new WebhookAdapter({}).syncBroker({ name: 'X' }), /not configured/i)
})

test('FollowUpBossAdapter: Basic auth, get→create→note; dryRun previews', async () => {
  const fub = new FollowUpBossAdapter({ api_key: 'FUB_KEY' })
  assert.equal(fub.configured(), true)
  assert.equal((await fub.syncBroker({ name: 'Jane Doe', email: 'j@x.com' }, { dryRun: true })).status, 'dry_run')

  const calls = []
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', auth: opts.headers?.authorization })
    const u = String(url)
    if (u.includes('/people?')) return { ok: true, status: 200, json: async () => ({ people: [] }) } // not found
    if (u.endsWith('/people')) return { ok: true, status: 200, json: async () => ({ id: 42 }) }        // created
    return { ok: true, status: 200, json: async () => ({ id: 7 }) }                                     // note
  }
  const r = await fub.syncBroker({ name: 'Jane Doe', email: 'j@x.com', firm: 'Acme' })
  assert.equal(r.status, 'created')
  assert.equal(r.id, 42)
  const expectAuth = 'Basic ' + Buffer.from('FUB_KEY:').toString('base64')
  assert.ok(calls.every((c) => c.auth === expectAuth), 'FUB Basic auth on every call')
  assert.ok(calls.some((c) => c.url.includes('/people?')), 'searched before creating')
  assert.ok(calls.some((c) => c.url.endsWith('/notes')), 'attached a note')
})

test('GoHighLevelAdapter: Bearer auth; upsert contact + note', async () => {
  const ghl = new GoHighLevelAdapter({ api_key: 'GHL_KEY' })
  const calls = []
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), auth: opts.headers?.authorization })
    if (String(url).endsWith('/contacts/') && opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ contact: { id: 'c1' }, new: true }) }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const r = await ghl.syncBroker({ name: 'Jane Doe', email: 'j@x.com' })
  assert.equal(r.id, 'c1')
  assert.equal(r.status, 'created')
  assert.ok(calls.every((c) => c.auth === 'Bearer GHL_KEY'), 'GHL Bearer auth on every call')
})

test('PipedriveAdapter: real-tenant token is strict; legacy (no token key) uses env', () => {
  assert.equal(new PipedriveAdapter({ token: 'T' }).configured(), true)
  process.env.PIPEDRIVE_API_TOKEN = 'ENV'
  assert.equal(new PipedriveAdapter({ token: null }).configured(), false) // real tenant w/ null token never borrows env
  assert.equal(new PipedriveAdapter({}).configured(), true)               // legacy uses env
})
