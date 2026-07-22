// Phase 2c — phoneburner.mjs on per-tenant creds. PhoneBurner + Pipedrive mocked.
// The guarantees under test: a real tenant runs on ITS OWN access token and Pipedrive
// token and never borrows the process-env credentials; the warm-disposition writer
// uses only the token it is handed (the cross-tenant leak is closed at the source);
// and the call-outcome buffer is isolated per tenant.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  pbConfigured, pbMode, pbConnected, pbStatus, pushContacts, createDialSession,
  recordCallEvent, recentCalls, isWarm, pushWarmDisposition,
} from '../phoneburner.mjs'

const savedFetch = globalThis.fetch
let auth = [] // bearer tokens seen on PhoneBurner calls
let pd = []   // api_token seen on Pipedrive calls

const okJson = (data) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data, text: async () => '' })

beforeEach(() => {
  auth = []; pd = []
  delete process.env.PIPEDRIVE_API_TOKEN
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url)
    if (u.hostname.includes('phoneburner.com')) {
      auth.push((opts.headers?.authorization || '').replace(/^Bearer /, ''))
      const p = u.pathname
      if (p.endsWith('/members')) return okJson({ members: [{ id: 1 }] })
      if (p.endsWith('/contacts')) return okJson({ contacts: [{ contact_id: 555 }] })
      if (p.endsWith('/dialsession')) return okJson({ dialsession: { redirect_url: 'https://pb/launch', dialsession_id: 9 } })
      return okJson({})
    }
    if (u.hostname.includes('pipedrive.com')) { pd.push(u.searchParams.get('api_token')); return okJson({ success: true, data: { id: 1 } }) }
    throw new Error(`unmocked ${url}`)
  }
})
afterEach(() => {
  globalThis.fetch = savedFetch
  delete process.env.PIPEDRIVE_API_TOKEN
  delete process.env.PHONEBURNER_ACCESS_TOKEN
})

test('pbConfigured/pbMode/pbConnected: a real tenant counts only with its own token', () => {
  assert.equal(pbConfigured({ accessToken: 'X' }), true)
  assert.equal(pbMode({ accessToken: 'X' }), 'byok')
  assert.equal(pbConnected({ accessToken: 'X' }), true)
  assert.equal(pbConfigured({ accessToken: null }), false) // real tenant, no key → not configured
  assert.equal(pbMode({ accessToken: null }), null)
})

test('status / push / dial all run on the tenant access token', async () => {
  const creds = { accessToken: 'TENANT_PB', pipedriveToken: 'TENANT_PD' }
  const st = await pbStatus(creds)
  assert.equal(st.connected, true)
  assert.equal(st.mode, 'byok')
  const pushed = await pushContacts(creds, [{ first_name: 'A', phone: '555', external_id: 'APN1' }])
  assert.equal(pushed[0].id, 555)
  const ds = await createDialSession(creds, { contactIds: [555], callbackBase: 'https://app/api/phoneburner/hook/SEKRET' })
  assert.equal(ds.redirect_url, 'https://pb/launch')
  assert.ok(auth.length >= 3 && auth.every((t) => t === 'TENANT_PB'), 'every PhoneBurner call used the tenant token')
})

test('a real tenant without a token never calls out and never uses the env token', async () => {
  process.env.PHONEBURNER_ACCESS_TOKEN = 'ENV_LEAK' // must never be used for a real tenant
  await assert.rejects(() => pushContacts({ accessToken: null }, [{ phone: '1' }]), /not connected/i)
  assert.equal(auth.length, 0, 'no PhoneBurner call should have been made')
})

test('pushWarmDisposition writes with the token it is handed — and never an env token', async () => {
  process.env.PIPEDRIVE_API_TOKEN = 'ENV_LEAK'
  await pushWarmDisposition({ name: 'Lead', disposition: 'warm', phone: '555' }, { pipedriveToken: 'TENANT_PD' })
  assert.deepEqual(pd, ['TENANT_PD'], 'the tenant Pipedrive token was used')

  pd = []
  const r = await pushWarmDisposition({ name: 'Lead' }, {}) // no token (tenant hasn't connected Pipedrive)
  assert.ok(r.skipped, 'no token → skipped, not written')
  assert.equal(pd.length, 0)
  assert.ok(!pd.includes('ENV_LEAK'), 'the module must never read the Pipedrive env token')
})

test('the call-outcome buffer is isolated per tenant', () => {
  recordCallEvent('T1', 'calldone', { contact: { first_name: 'Ann' }, result: 'warm' })
  recordCallEvent('T2', 'calldone', { contact: { first_name: 'Bob' }, result: 'no answer' })
  recordCallEvent('default', 'calldone', { contact: { first_name: 'Env' }, result: 'warm' })
  assert.equal(recentCalls('T1').length, 1)
  assert.equal(recentCalls('T1')[0].name, 'Ann')
  assert.equal(recentCalls('T2')[0].name, 'Bob')
  assert.equal(recentCalls('T1').find((r) => r.name === 'Bob'), undefined, 'T1 must not see T2 outcomes')
  assert.equal(recentCalls('unknown').length, 0)
})

test('isWarm matches qualified dispositions only', () => {
  for (const d of ['warm', 'Qualified', 'interested', 'callback later', 'follow up']) assert.equal(isWarm(d), true)
  for (const d of ['no answer', 'voicemail', 'DNC', '', null]) assert.equal(isWarm(d), false)
})

test('legacy path (null creds) runs on the env token — fresh module instance', async () => {
  process.env.PHONEBURNER_ACCESS_TOKEN = 'ENV_PAT'
  const mod = await import('../phoneburner.mjs?legacy=1') // cache-busted → ENV re-read with the token set
  assert.equal(mod.pbConfigured(null), true)
  assert.equal(mod.pbMode(null), 'personal')
  await mod.pbStatus(null)
  assert.ok(auth.length > 0 && auth.every((t) => t === 'ENV_PAT'), 'legacy calls used the env token')
})
