// Railway server: serves the built SPA and gates the real data behind a REAL
// server-side password check. The PII (data.real.json) lives on the server and is
// returned ONLY by POST /api/data with the correct password — it is never a
// publicly downloadable static file (the whole point of going to Railway).
//
//   APP_PASSWORD  — the access password (set in Railway → Variables). Defaults to
//                   SimiCap1170! for local runs. Safe to keep simple here: there's
//                   no offline ciphertext to crack — guesses must hit the live
//                   server, which rate-limits and never returns data without it.
import express from 'express'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8080
const PASSWORD = process.env.APP_PASSWORD || 'SimiCap1170!'
// data lives on a mounted Railway VOLUME (DATA_DIR) so the PII never goes in git;
// falls back to a local file for dev. Server-side only — NOT under dist/.
const DATA_PATH = join(process.env.DATA_DIR || __dirname, 'data.real.json')
const DIST = join(__dirname, 'dist')

// load the data once at boot (it never leaves the server except via the authed route)
let DATA = null
if (existsSync(DATA_PATH)) {
  try { DATA = JSON.parse(readFileSync(DATA_PATH, 'utf8')) } catch (e) { console.error('bad data.real.json', e) }
}
console.log(`[server] data ${DATA ? `loaded (${DATA.props?.length || 0} props, ${DATA.brokers?.length || 0} brokers)` : 'absent → app falls back to sample'}`)

const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

// naive in-memory rate limit on the auth endpoint (per-IP, per-minute) so the
// password can't be brute-forced quickly even though it's short.
const hits = new Map()
app.use('/api/data', (req, res, next) => {
  const ip = req.ip || 'x'
  const now = Date.now()
  const w = hits.get(ip)?.filter((t) => now - t < 60_000) || []
  if (w.length >= 20) return res.status(429).json({ error: 'too many attempts' })
  w.push(now); hits.set(ip, w); next()
})

// the ONLY way to get the real data: correct password, server-checked.
app.post('/api/data', (req, res) => {
  if (!DATA) return res.status(404).json({ error: 'no real data on this server' })
  if ((req.body?.password || '') !== PASSWORD) return res.status(401).json({ error: 'wrong password' })
  res.json(DATA)
})

// static SPA + client-side routing fallback
app.use(express.static(DIST))
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')))

app.listen(PORT, () => console.log(`[server] listening on :${PORT} (auth=${PASSWORD === 'SimiCap1170!' ? 'default' : 'env'})`))
