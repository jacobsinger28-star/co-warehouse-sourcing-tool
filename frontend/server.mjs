// Railway server: serves the built SPA and gates the real data behind REAL
// server-side auth. The PII (data.real.json) lives on the server and is returned
// ONLY by authed POST /api/data — it is never a publicly downloadable static
// file (the whole point of going to Railway).
//
// Two auth methods, checked per request (either passes; both fail closed):
//
//  1. SUPABASE LOGIN (preferred) — per-person email/password accounts.
//       SUPABASE_URL       — https://<project-ref>.supabase.co
//       SUPABASE_ANON_KEY  — the project's anon/public key
//       ALLOWED_EMAILS     — comma-separated allowlist, e.g. "raz@x.com,andrew@y.com".
//                            REQUIRED for Supabase mode: a valid JWT whose email is
//                            not listed is refused (Supabase projects may have open
//                            signup — a login alone is NOT authorization).
//     The client gets {url, anonKey} from GET /api/config, signs in against
//     Supabase, and sends the JWT as an Authorization: Bearer header; this server
//     re-verifies the token against Supabase on every data route.
//
//  2. LEGACY shared password.
//       APP_PASSWORD  — the access password, checked against req.body.password.
//     Unset it once Supabase is configured to retire the shared password.
//
// If NEITHER method is configured the server FAILS CLOSED — /api/* refuses every
// request — so a missing/blank credential can never leak PII. Never hardcode
// secrets: this file is committed, and a committed password is a public password.
//
//   DATA_DIR      — optional mounted-volume dir for data.real.json persistence.
//                   A non-empty baked dataset refreshes the volume at boot; an
//                   empty bake (GitHub auto-deploys) falls back to the volume
//                   copy, so pushes no longer wipe the real data.
import express from 'express'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { answerDealsQuestion, searchDeals } from './dealsChat.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8080
const PASSWORD = process.env.APP_PASSWORD || ''   // no default — unset = fail closed
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
// Who may enter, comma-separated. Two kinds of entry:
//   "@simicap.com"  → any account on that email domain
//   "raz@x.com"     → that exact address
// Defaults to the company domain; override with ALLOWED_EMAILS to widen/narrow.
const ALLOWED_ENTRIES = (process.env.ALLOWED_EMAILS ?? '@simicap.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const ALLOWED_EXACT = new Set(ALLOWED_ENTRIES.filter((e) => !e.startsWith('@')))
const ALLOWED_DOMAINS = new Set(ALLOWED_ENTRIES.filter((e) => e.startsWith('@')))
const emailAllowed = (email) =>
  ALLOWED_EXACT.has(email) || ALLOWED_DOMAINS.has(email.slice(email.lastIndexOf('@')))
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
// data.real.json is baked into the image by a private `railway up` (server-side
// only, NOT under dist/). GitHub auto-deploys can't include it (gitignored), so
// with DATA_DIR set to a mounted volume the server keeps the LAST real dataset
// across those data-less rebuilds: a baked dataset refreshes the volume; an
// empty bake ('{}') falls back to the volume copy.
const DATA_DIR = process.env.DATA_DIR || ''
const BAKED_PATH = join(__dirname, 'data.real.json')
const DIST = join(__dirname, 'dist')

const readJson = (p) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null }
  catch (e) { console.error(`bad json at ${p}`, e); return null }
}
const hasData = (d) => Array.isArray(d?.props) && d.props.length > 0

let DATA = readJson(BAKED_PATH)
if (DATA_DIR) {
  const volPath = join(DATA_DIR, 'data.real.json')
  if (hasData(DATA)) {
    try { writeFileSync(volPath, JSON.stringify(DATA)); console.log('[server] volume refreshed from baked data') }
    catch (e) { console.error('[server] volume write failed', e) }
  } else {
    const vol = readJson(volPath)
    if (hasData(vol)) { DATA = vol; console.log('[server] baked data empty → using volume copy') }
  }
}
console.log(`[server] data ${hasData(DATA) ? `loaded (${DATA.props.length} props, ${DATA.brokers?.length || 0} brokers)` : 'absent → app falls back to sample'}`)
if (SUPABASE_ENABLED && ALLOWED_ENTRIES.length === 0)
  console.warn('[server] ⚠ Supabase configured but ALLOWED_EMAILS is empty — every Supabase login will be refused (fail closed). Set ALLOWED_EMAILS in Railway → Variables.')
if (!SUPABASE_ENABLED && !PASSWORD)
  console.warn('[server] ⚠ no auth configured (SUPABASE_URL+SUPABASE_ANON_KEY or APP_PASSWORD) — /api/* will refuse every request (fail closed). Set them in Railway → Variables.')

// ── auth ─────────────────────────────────────────────────────────────────────
// Verify a Supabase access token by asking Supabase who it belongs to, then
// check that email against the allowlist. Verified tokens are cached briefly so
// each API call doesn't cost a round-trip to Supabase.
const tokenCache = new Map() // token → { email, exp }
async function verifySupabaseToken(token) {
  const hit = tokenCache.get(token)
  if (hit && hit.exp > Date.now()) return hit.email
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    const email = (u?.email || '').toLowerCase()
    if (!email) return null
    // Domain-gated entry is only meaningful if the address is PROVEN: refuse
    // accounts that never confirmed their email (with open signups + confirmation
    // off, anyone could claim any@simicap.com — this closes that hole).
    if (!u.email_confirmed_at && !u.confirmed_at) return null
    if (tokenCache.size > 500) tokenCache.clear() // crude bound; entries are tiny
    tokenCache.set(token, { email, exp: Date.now() + 5 * 60_000 })
    return email
  } catch {
    return null // Supabase unreachable → treat as unauthenticated (fail closed)
  }
}

// Either auth method passes: a Bearer JWT from an allow-listed Supabase account,
// or the legacy shared password in the body. Routes behind this middleware can
// assume the caller is authorized.
async function requireAuth(req, res, next) {
  if (!SUPABASE_ENABLED && !PASSWORD)
    return res.status(503).json({ error: 'server not configured (set SUPABASE_URL + SUPABASE_ANON_KEY + ALLOWED_EMAILS, or APP_PASSWORD)' })
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1]
  if (bearer && SUPABASE_ENABLED) {
    const email = await verifySupabaseToken(bearer)
    if (email && emailAllowed(email)) return next()
    return res.status(401).json({ error: email ? 'account not on the allowed list' : 'invalid or expired session — sign in again' })
  }
  if (PASSWORD && (req.body?.password || '') === PASSWORD) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

// Public client config: which sign-in method to show. The anon key is a public
// client key by design (it ships in every Supabase app bundle) — authorization
// is the server-side JWT + allowlist check above, never the key itself.
// allowedDomains lets the Gate warn someone registering with an email that
// won't have access. Domains only — never the exact-email entries (team PII).
app.get('/api/config', (_req, res) =>
  res.json({
    supabase: SUPABASE_ENABLED
      ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, allowedDomains: [...ALLOWED_DOMAINS] }
      : null,
  }))

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
app.use('/api/deals', rateLimit(60))

// the ONLY way to get the real data: authed (Supabase JWT + allowlist, or password).
app.post('/api/data', requireAuth, (req, res) => {
  if (!hasData(DATA)) return res.status(404).json({ error: 'no real data on this server' })
  res.json(DATA)
})

// Deals DB, no-LLM path: the live deal book + keyword search + known-question
// presets, straight from Pipedrive. Same password gate as /api/data.
//   {password}                    -> every deal (for the table)
//   {password, q: "meeting st"}   -> keyword search with matched-note snippets
//   {password, preset: "tracking"}-> a known question (tracking/open/won/lost/recent/noted)
app.post('/api/deals', requireAuth, async (req, res) => {
  try {
    res.json(await searchDeals({
      q: String(req.body?.q || '').slice(0, 500),
      preset: String(req.body?.preset || ''),
    }))
  } catch (e) {
    console.error('[deals]', e)
    res.status(502).json({ error: e?.message || 'deals lookup failed' })
  }
})

// Deals DB RAG chat: plain-English Q&A over the Pipedrive deal book. Same
// password gate as /api/data — nothing here is reachable without it.
app.post('/api/deals-chat', requireAuth, async (req, res) => {
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

const authDesc = [
  SUPABASE_ENABLED ? `supabase(allowed: ${ALLOWED_ENTRIES.join(' ') || 'NONE'})` : null,
  PASSWORD ? 'password' : null,
].filter(Boolean).join('+') || 'NONE → fail-closed'
app.listen(PORT, () => console.log(`[server] listening on :${PORT} (auth=${authDesc})`))
