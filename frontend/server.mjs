// Railway server: serves the built SPA and gates the real data behind a REAL
// server-side password check. The PII (data.real.json) lives on the server and is
// returned ONLY by POST /api/data with the correct password — it is never a
// publicly downloadable static file (the whole point of going to Railway).
//
//   APP_PASSWORD  — the access password. REQUIRED: set it in Railway → Variables
//                   (or export it locally). If unset, the server FAILS CLOSED —
//                   /api/data refuses every request — so a missing/blank password
//                   can never leak PII. Never hardcode it: this file is committed,
//                   and a committed password is a public password.
//   DATA_DIR      — optional dir holding data.real.json (e.g. a mounted volume).
//                   Defaults to the app dir, where the Dockerfile bakes the file in.
import express from 'express'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { answerDealsQuestion } from './dealsChat.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8080
const PASSWORD = process.env.APP_PASSWORD || ''   // no default — unset = fail closed
// data.real.json is baked into the image by the Dockerfile (server-side only, NOT
// under dist/); point DATA_DIR at a mounted volume to refresh it without a rebuild.
const DATA_PATH = join(process.env.DATA_DIR || __dirname, 'data.real.json')
const DIST = join(__dirname, 'dist')

// load the data once at boot (it never leaves the server except via the authed route)
let DATA = null
if (existsSync(DATA_PATH)) {
  try { DATA = JSON.parse(readFileSync(DATA_PATH, 'utf8')) } catch (e) { console.error('bad data.real.json', e) }
}
console.log(`[server] data ${DATA ? `loaded (${DATA.props?.length || 0} props, ${DATA.brokers?.length || 0} brokers)` : 'absent → app falls back to sample'}`)
if (!PASSWORD) console.warn('[server] ⚠ APP_PASSWORD unset — /api/data will refuse every request (fail closed). Set it in Railway → Variables.')

const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

// naive in-memory rate limit on the auth endpoint (per-IP, per-minute) so the
// password can't be brute-forced quickly even though it's short.
const hits = new Map()
const rateLimit = (max) => (req, res, next) => {
  const ip = req.ip || 'x'
  const now = Date.now()
  const w = hits.get(ip)?.filter((t) => now - t < 60_000) || []
  if (w.length >= max) return res.status(429).json({ error: 'too many attempts' })
  w.push(now); hits.set(ip, w); next()
}
app.use('/api/data', rateLimit(20))
app.use('/api/deals-chat', rateLimit(20))

// the ONLY way to get the real data: correct password, server-checked.
app.post('/api/data', (req, res) => {
  if (!PASSWORD) return res.status(503).json({ error: 'server not configured (APP_PASSWORD unset)' })
  if (!DATA) return res.status(404).json({ error: 'no real data on this server' })
  if ((req.body?.password || '') !== PASSWORD) return res.status(401).json({ error: 'wrong password' })
  res.json(DATA)
})

// Deals DB RAG chat: plain-English Q&A over the Pipedrive deal book. Same
// password gate as /api/data — nothing here is reachable without it.
app.post('/api/deals-chat', async (req, res) => {
  if (!PASSWORD) return res.status(503).json({ error: 'server not configured (APP_PASSWORD unset)' })
  if ((req.body?.password || '') !== PASSWORD) return res.status(401).json({ error: 'wrong password' })
  const question = String(req.body?.question || '').trim().slice(0, 2000)
  if (!question) return res.status(400).json({ error: 'question required' })
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : []
  try {
    res.json(await answerDealsQuestion(question, history))
  } catch (e) {
    console.error('[deals-chat]', e)
    res.status(502).json({ error: e?.message || 'deals chat failed' })
  }
})

// static SPA + client-side routing fallback
app.use(express.static(DIST))
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')))

app.listen(PORT, () => console.log(`[server] listening on :${PORT} (auth=${PASSWORD ? 'configured' : 'UNSET → fail-closed'})`))
