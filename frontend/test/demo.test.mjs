// Tests for the public demo surface (demo.mjs). These lock the security-relevant
// guarantees: the demo routes need NO auth, and everything they serve is
// structurally synthetic (555 phones, @example.com emails) — so the public /demo
// link can never leak a real owner/broker phone or email.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { demoRouter, demoLoaded } from '../demo.mjs'

// spin up a throwaway server that mounts ONLY the demo router (no auth, no real data)
function startServer() {
  const app = express()
  app.use(express.json())
  app.use('/api/demo', demoRouter)
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }))
  })
}
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })

test('demo dataset is present (run tools/build_demo_data.mjs first)', () => {
  assert.ok(demoLoaded(), 'demo-data.json must be built and flagged synthetic')
})

test('POST /api/demo/data — no auth, synthetic, no PII shapes', async () => {
  const { srv, base } = await startServer()
  try {
    const r = await post(base, '/api/demo/data') // note: NO Authorization header, NO password
    assert.equal(r.status, 200)
    const d = await r.json()
    assert.equal(d.synthetic, true)
    assert.ok(Array.isArray(d.props) && d.props.length > 0)
    assert.equal(d.deals, undefined, 'deals must be served via /deals, not embedded in the data payload')

    // Structural syntheticness: every phone is a reserved 555 number and every
    // email is @example.com — a real contact cannot pass these.
    const phoneOk = /^\(\d{3}\) 555-\d{4}$/
    for (const p of d.props) {
      for (const ph of p.phones || []) assert.match(ph, phoneOk, `non-555 phone leaked: ${ph}`)
      for (const em of p.emails || []) assert.ok(em.endsWith('@example.com'), `non-example email leaked: ${em}`)
    }
    for (const b of d.brokers || []) {
      assert.match(b.phone, phoneOk)
      assert.ok(b.email.endsWith('@example.com'))
    }
  } finally { srv.close() }
})

test('POST /api/demo/deals + deals-chat — public, canned, never throws', async () => {
  const { srv, base } = await startServer()
  try {
    const all = await (await post(base, '/api/demo/deals')).json()
    assert.ok(all.results.length > 0 && all.dealCount > 0)

    const preset = await (await post(base, '/api/demo/deals', { preset: 'open' })).json()
    assert.equal(preset.mode, 'preset')

    const chat = await post(base, '/api/demo/deals-chat', { question: 'how many open deals?' })
    assert.equal(chat.status, 200)
    const c = await chat.json()
    assert.ok(typeof c.answer === 'string' && c.answer.length > 0)
    assert.match(c.answer, /Demo/, 'answer must be marked as a demo/canned response')
  } finally { srv.close() }
})

test('POST /api/demo/phoneburner + live — simulated, no real integration', async () => {
  const { srv, base } = await startServer()
  try {
    const status = await (await post(base, '/api/demo/phoneburner/status')).json()
    assert.deepEqual(status, { configured: true, mode: 'demo', connected: true })

    const dial = await (await post(base, '/api/demo/phoneburner/dial')).json()
    assert.ok(dial.redirect_url.startsWith('data:text/html'), 'dialer must be an inline data: URL, never a real PhoneBurner URL')

    const live = await (await post(base, '/api/demo/live/status')).json()
    assert.ok(live.source_counts && typeof live.source_counts === 'object')

    const rows = await (await post(base, '/api/demo/live/rows')).json()
    assert.deepEqual(rows, { props: [], brokers: [] })
  } finally { srv.close() }
})
