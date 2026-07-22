// Phase 2a — dealsChat on per-tenant credentials. Pipedrive fetch is mocked.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { searchDeals } from '../dealsChat.mjs'

let tokens = [] // api_token values seen by the mocked Pipedrive fetch
const savedFetch = globalThis.fetch

beforeEach(() => {
  tokens = []
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    tokens.push(u.searchParams.get('api_token'))
    const p = u.pathname
    const rows = p.endsWith('/deals')
      ? [{ id: 1, title: 'Deal A', status: 'open', stage_id: 1, pipeline_id: 1, value: 100, currency: 'USD', add_time: '2026-01-01', update_time: '2026-01-02' }]
      : []
    const body = p.endsWith('/deals') || p.endsWith('/notes')
      ? { data: rows, additional_data: { pagination: { more_items_in_collection: false } } }
      : { data: [] }
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
  }
})
afterEach(() => { globalThis.fetch = savedFetch; delete process.env.PIPEDRIVE_API_TOKEN })

test('searchDeals uses the tenant-supplied Pipedrive token', async () => {
  const r = await searchDeals({}, { pipedriveToken: 'TOKEN_A', cacheKey: 'tenantA' })
  assert.equal(r.results[0].title, 'Deal A')
  assert.ok(tokens.includes('TOKEN_A'), 'the fetch must have used the tenant token')
})

test('a second call for the same tenant is cached (no refetch)', async () => {
  await searchDeals({}, { pipedriveToken: 'TOKEN_A', cacheKey: 'tenantCache' })
  tokens = []
  await searchDeals({}, { pipedriveToken: 'TOKEN_A', cacheKey: 'tenantCache' })
  assert.equal(tokens.length, 0, 'the corpus should be served from cache')
})

test('different tenants get separate corpora keyed by cacheKey', async () => {
  await searchDeals({}, { pipedriveToken: 'TOKEN_X', cacheKey: 'tenantX' })
  tokens = []
  await searchDeals({}, { pipedriveToken: 'TOKEN_Y', cacheKey: 'tenantY' })
  assert.ok(tokens.includes('TOKEN_Y'), 'tenant Y builds its own corpus with its own token')
  assert.ok(!tokens.includes('TOKEN_X'), 'tenant Y never reuses tenant X token or corpus')
})

test('a real tenant with no token throws — never falls back to the env token', async () => {
  process.env.PIPEDRIVE_API_TOKEN = 'ENV_LEAK_TOKEN'
  await assert.rejects(
    () => searchDeals({}, { pipedriveToken: null, cacheKey: 'tenantNoKey' }),
    /not configured/i,
  )
  assert.ok(!tokens.includes('ENV_LEAK_TOKEN'), 'the platform env token must never be used for a real tenant')
})

test('legacy path (no creds) uses the env token, tenant "default"', async () => {
  process.env.PIPEDRIVE_API_TOKEN = 'ENV_TOKEN'
  const r = await searchDeals({}) // no creds → today's single-tenant behavior
  assert.equal(r.results[0].title, 'Deal A')
  assert.ok(tokens.includes('ENV_TOKEN'))
})
