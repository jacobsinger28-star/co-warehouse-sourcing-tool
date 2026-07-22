// Phase 2b — pipedrive.mjs write client on per-tenant tokens. Pipedrive is mocked.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { syncBroker, pdConfigured } from '../pipedrive.mjs'

let tokens = []
const savedFetch = globalThis.fetch

beforeEach(() => {
  tokens = []
  delete process.env.PIPEDRIVE_API_TOKEN
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    tokens.push(u.searchParams.get('api_token'))
    const p = u.pathname
    const data = p.endsWith('/users/me') ? { id: 7, name: 'Owner' }
      : p.includes('/search') ? { items: [] }
      : { id: 99 }
    return { ok: true, json: async () => ({ success: true, data }), text: async () => '' }
  }
})
afterEach(() => { globalThis.fetch = savedFetch; delete process.env.PIPEDRIVE_API_TOKEN })

test('pdConfigured: explicit opts token decides; null (real tenant) is false', () => {
  assert.equal(pdConfigured({ token: 'X' }), true)
  assert.equal(pdConfigured({ token: null }), false) // real tenant, no key → not configured
  process.env.PIPEDRIVE_API_TOKEN = 'ENV'
  assert.equal(pdConfigured({}), true)               // legacy → env token
})

test('syncBroker runs against the tenant-supplied token', async () => {
  const r = await syncBroker({ name: 'Broker A', email: 'a@x.com' }, { token: 'TOKEN_A', dryRun: true })
  assert.equal(r.status, 'dry_run')
  assert.equal(r.would_create.owner_id, 7)
  assert.ok(tokens.length > 0 && tokens.every((t) => t === 'TOKEN_A'), 'every Pipedrive call used the tenant token')
})

test('a real tenant with no token throws — never falls back to the env token', async () => {
  process.env.PIPEDRIVE_API_TOKEN = 'ENV_LEAK'
  await assert.rejects(() => syncBroker({ name: 'C' }, { token: null, dryRun: true }), /not configured/i)
  assert.ok(!tokens.includes('ENV_LEAK'), 'the platform env token must never be used for a real tenant')
})

test('legacy path (no token key) uses the env token', async () => {
  process.env.PIPEDRIVE_API_TOKEN = 'ENV_TOKEN'
  await syncBroker({ name: 'L', email: 'l@x.com' }, { dryRun: true })
  assert.ok(tokens.length > 0 && tokens.every((t) => t === 'ENV_TOKEN'))
})
