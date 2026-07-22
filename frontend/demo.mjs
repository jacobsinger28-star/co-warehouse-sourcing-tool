// demo.mjs — the PUBLIC, FAKE-ONLY API surface for /demo.
//
// SECURITY BOUNDARY: this module is the entire demo backend. It serves ONLY the
// synthetic demo-data.json and simulated integration responses. It imports
// NOTHING from the real providers (no data.real.json, no dealsChat.mjs / Pipedrive,
// no phoneburner.mjs, no scraper sidecar, no Anthropic). There is deliberately no
// code path from here to any real data or external service — so the demo routes
// are safe to expose without authentication. The real /api/* routes are untouched
// and stay behind requireAuth; a demo visitor has no credential and can't reach them.
import express from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load the committed synthetic dataset (props/brokers/deals). Never data.real.json.
let DEMO = null
try {
  DEMO = JSON.parse(readFileSync(join(__dirname, 'demo-data.json'), 'utf8'))
  if (!DEMO?.synthetic) { console.warn('[demo] demo-data.json missing synthetic:true — refusing to serve'); DEMO = null }
} catch (e) { console.warn('[demo] demo-data.json absent — run tools/build_demo_data.mjs', e?.message) }
const DEALS = DEMO?.deals || []

export const demoLoaded = () => Boolean(DEMO?.props?.length)
// The dataset the app renders (deals[] is served via /api/demo/deals, not here).
const dataPayload = () => { const { deals: _d, ...rest } = DEMO || {}; return rest }

// ── deals: keyword/preset search over the fake book (no Pipedrive, no LLM) ───
const summarize = (d) => ({
  id: d.id, title: d.title, status: d.status, stage: d.stage, pipeline: d.pipeline,
  value: d.value, currency: d.currency, added: d.added, updated: d.updated,
  person: d.person, org: d.org, notesCount: d.notesCount, url: d.url,
})
const byRecency = (a, b) => (b.updated || '').localeCompare(a.updated || '')
const PRESETS = {
  tracking: { label: 'Tracking pipeline', match: (d) => d.pipeline.toLowerCase() === 'tracking' },
  open: { label: 'Open deals', match: (d) => d.status === 'open' },
  won: { label: 'Won deals', match: (d) => d.status === 'won' },
  lost: { label: 'Lost deals', match: (d) => d.status === 'lost' },
  recent: { label: 'Recently updated', match: () => true, limit: 10 },
  noted: { label: 'Most discussed', match: (d) => d.notesCount > 0, sort: (a, b) => b.notesCount - a.notesCount, limit: 10 },
}
const tokenize = (s) => (String(s).toLowerCase().match(/[a-z0-9]{2,}/g) || [])
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'we', 'our', 'is', 'are', 'was', 'were', 'did', 'do', 'have', 'has', 'ever', 'any', 'what', 'who', 'when', 'how', 'many', 'deal', 'deals'])
function rankDeals(question) {
  const terms = tokenize(question).filter((t) => !STOP.has(t))
  return DEALS
    .map((d) => {
      const doc = `${d.title} ${d.org} ${d.person} ${d.doc}`.toLowerCase()
      let score = 0
      for (const t of terms) { if (d.title.toLowerCase().includes(t)) score += 5; score += Math.min((doc.split(t).length - 1), 4) }
      return { deal: d, score }
    })
    .sort((a, b) => b.score - a.score)
}
function snippetsFor(deal, terms) {
  const out = []
  for (const line of String(deal.doc).split('\n').slice(1)) {
    if (terms.some((t) => line.toLowerCase().includes(t))) { out.push(line.length > 220 ? `${line.slice(0, 220)}…` : line); if (out.length >= 3) break }
  }
  return out
}
function searchDemoDeals({ q = '', preset = '' } = {}) {
  const base = { dealCount: DEALS.length, syncedAt: Date.now() }
  if (preset && PRESETS[preset]) {
    const p = PRESETS[preset]
    const matched = DEALS.filter(p.match).sort(p.sort || byRecency).slice(0, p.limit || 100)
    return { ...base, mode: 'preset', label: p.label, results: matched.map((d) => ({ ...summarize(d), snippets: [] })) }
  }
  const question = String(q || '').trim()
  if (!question) return { ...base, mode: 'all', results: [...DEALS].sort(byRecency).map(summarize) }
  const terms = tokenize(question).filter((t) => !STOP.has(t))
  const results = rankDeals(question).filter((r) => r.score > 0).slice(0, 20)
    .map((r) => ({ ...summarize(r.deal), score: r.score, snippets: snippetsFor(r.deal, terms) }))
  return { ...base, mode: 'search', results }
}

// ── deals-chat: canned answers over the fake book (NO LLM) ──────────────────
function answerDemoChat(question) {
  const q = String(question || '').toLowerCase()
  const n = DEALS.length
  const open = DEALS.filter((d) => d.status === 'open')
  const won = DEALS.filter((d) => d.status === 'won')
  const lost = DEALS.filter((d) => d.status === 'lost')
  const cite = (list) => list.slice(0, 3).map((d) => ({ id: d.id, title: d.title, url: d.url }))
  let answer, citations
  const ranked = rankDeals(q).filter((r) => r.score > 0)
  if (/how many|count|total/.test(q) && /open/.test(q)) { answer = `There are ${open.length} open deals across the demo book (of ${n} total).`; citations = cite(open) }
  else if (/won|closed/.test(q)) { answer = `${won.length} deals are marked won/closed. Most recent: ${won.slice(0, 3).map((d) => d.title).join('; ') || '—'}.`; citations = cite(won) }
  else if (/lost|why.*pass|passed/.test(q)) { answer = lost.length ? `${lost.length} deals were lost. Reasons on file include: ${[...new Set(lost.map((d) => d.why).filter(Boolean))].slice(0, 3).join('; ')}.` : 'No lost deals in the demo book.'; citations = cite(lost) }
  else if (ranked.length) { const d = ranked[0].deal; answer = `Closest match: ${d.title} — ${d.pipeline}/${d.stage}, ${d.status}${d.why ? ` (${d.why})` : ''}, offer $${(d.value / 1e6).toFixed(1)}M, updated ${d.updated}.`; citations = cite(ranked.map((r) => r.deal)) }
  else { answer = `Across ${n} demo deals: ${open.length} open, ${won.length} won, ${lost.length} lost. Ask about a specific owner, address, or status.`; citations = cite([...DEALS].sort(byRecency)) }
  return { answer: `${answer}\n\n(Demo — canned answer over synthetic deals; no live model or CRM.)`, citations, dealCount: n, syncedAt: Date.now() }
}

// ── live-scrape simulation (no real scraper) ────────────────────────────────
const TARGET = { cbre: 41, jll: 33, colliers: 22, newmark: 15, crexi: 58 }
const RUN_MS = 9000
let run = null            // { startedAt } while a sim run is in progress
let lastFound = 0         // "new listings" surfaced by the last completed run
const scaleCounts = (p) => Object.fromEntries(Object.entries(TARGET).map(([k, v]) => [k, Math.round(v * p)]))
const sitesOf = (counts, running) => Object.fromEntries(Object.keys(TARGET).map((k) => [k, { status: running ? 'running' : 'done', found: counts[k] }]))
function demoLiveStatus() {
  if (run) {
    const prog = Math.min(1, (Date.now() - run.startedAt) / RUN_MS)
    if (prog >= 1) { lastFound = 6; run = null } // run finished → fall through to idle
    else {
      const counts = scaleCounts(0.6 + 0.4 * prog)
      return { status: 'running', source_counts: counts, sites: sitesOf(counts, true), listings_found: 0, started_at: new Date(run.startedAt).toISOString() }
    }
  }
  return { status: 'idle', source_counts: TARGET, sites: sitesOf(TARGET, false), listings_found: lastFound, finished_at: new Date().toISOString() }
}
function demoLive(action) {
  switch (action) {
    case 'scrape': run = { startedAt: Date.now() }; return { ok: true, status: 'running' }
    case 'stop': run = null; return { ok: true, status: 'stopped' }
    case 'status': return demoLiveStatus()
    case 'rows': return { props: [], brokers: [] } // no-op: the /api/demo/data payload is the source of truth
    case 'import': return { ok: true, imported: 0 }
    default: return null
  }
}

// ── PhoneBurner simulation (no real dialer, no real calls) ──────────────────
const DIALER_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo dialer</title><style>html,body{margin:0;height:100%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1512;color:#e8efe9;display:flex;align-items:center;justify-content:center}.c{text-align:center;max-width:420px;padding:32px}.d{width:52px;height:52px;border-radius:50%;border:3px solid #1f2a24;border-top-color:#39d98a;margin:0 auto 20px;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}h1{font-size:17px;margin:0 0 8px}p{font-size:13px;color:#9fb3a8;line-height:1.6;margin:6px 0}.b{display:inline-block;margin-top:14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#39d98a;border:1px solid #234;border-radius:6px;padding:4px 10px}</style></head><body><div class="c"><div class="d"></div><h1>Connecting the power dialer…</h1><p>Simulated single-line dialer — a live rep would be handed each answered call.</p><p>No phone call is placed in the demo.</p><span class="b">Demo mode</span></div></body></html>`
function demoPhoneburner(action, body) {
  switch (action) {
    case 'status': return { configured: true, mode: 'demo', connected: true }
    case 'push': { const contacts = Array.isArray(body?.contacts) ? body.contacts : []; return { pushed: contacts.map((c, i) => ({ external_id: c.external_id, phone: c.phone, id: `demo-${i}` })) } }
    case 'dial': return { redirect_url: `data:text/html;charset=utf-8,${encodeURIComponent(DIALER_HTML)}` }
    case 'recent': return {
      calls: [
        { event: 'calldone', name: 'Riley Vance', phone: '(704) 555-0132', disposition: 'Warm — wants a callback', external_id: '1420 Commerce Rd' },
        { event: 'calldone', name: 'Morgan Ellis', phone: '(614) 555-0188', disposition: 'Left voicemail', external_id: '5500 Westbelt Dr' },
        { event: 'calldone', name: 'Avery Marsh', phone: '(407) 555-0119', disposition: 'Not interested', external_id: '603 Landstreet Rd' },
      ],
    }
    default: return null
  }
}

// ── router ───────────────────────────────────────────────────────────────────
// Public (no auth) on purpose — see the security note at the top of the file.
export const demoRouter = express.Router()

// light per-IP rate limit so the public surface can't be trivially hammered
const hits = new Map()
demoRouter.use((req, res, next) => {
  const ip = req.ip || 'x'; const now = Date.now()
  const w = (hits.get(ip) || []).filter((t) => now - t < 60_000)
  if (w.length >= 240) return res.status(429).json({ error: 'too many requests' })
  w.push(now); hits.set(ip, w); next()
})

const guard = (res) => { if (!demoLoaded()) { res.status(503).json({ error: 'demo dataset not built — run tools/build_demo_data.mjs' }); return false } return true }

demoRouter.post('/data', (_req, res) => { if (guard(res)) res.json(dataPayload()) })
demoRouter.post('/deals', (req, res) => res.json(searchDemoDeals({ q: String(req.body?.q || '').slice(0, 500), preset: String(req.body?.preset || '') })))
demoRouter.post('/deals-chat', (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 2000)
  if (!question) return res.status(400).json({ error: 'question required' })
  res.json(answerDemoChat(question))
})
demoRouter.post('/live/:action', (req, res) => { const out = demoLive(req.params.action); out ? res.json(out) : res.status(404).json({ error: 'unknown live action' }) })
demoRouter.post('/phoneburner/:action', (req, res) => { const out = demoPhoneburner(req.params.action, req.body || {}); out ? res.json(out) : res.status(404).json({ error: 'unknown action' }) })
