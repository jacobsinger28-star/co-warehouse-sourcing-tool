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
import {
  pbConfigured, pbMode, pbStatus, pushContacts, createDialSession,
  oauthAuthorizeUrl, oauthExchange, recordCallEvent, recentCalls,
  isWarm, pushWarmDisposition,
} from './phoneburner.mjs'
import { resolveTenant, DEFAULT_TENANT } from './tenants.mjs'
import { tenancyEnabled } from './db.mjs'
import { pdConfigured, pdStatusInfo, syncBroker, pushLead } from './pipedrive.mjs'
import { demoRouter, demoLoaded } from './demo.mjs'
import { installRedaction, secretsEnabled, SecretResolver } from './secrets.mjs'

// Route all console output through the secret redactor before anything can log —
// so a decrypted key can never reach the logs, a traceback, or summary output.
installRedaction()

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

// LoopNet lease overlay — committed alongside the code (holds only county-APN
// ids + public LoopNet listing facts, no owner PII). Merged at serve time so
// GitHub auto-deploys (which carry no dataset) still flag lease-listed props
// once the baked/volume dataset loads. Refresh: rerun the LoopNet sweep and
// regenerate lease-overlay.json.
const LEASE_OVERLAY = readJson(join(__dirname, 'lease-overlay.json'))
if (hasData(DATA) && LEASE_OVERLAY?.props) {
  let leaseN = 0
  for (const p of DATA.props) {
    const l = LEASE_OVERLAY.props[p.id]
    if (l) { p.lease = l; leaseN++ }
  }
  console.log(`[server] lease overlay: ${leaseN} of ${Object.keys(LEASE_OVERLAY.props).length} flagged props present in dataset`)
}
if (SUPABASE_ENABLED && ALLOWED_ENTRIES.length === 0)
  console.warn('[server] ⚠ Supabase configured but ALLOWED_EMAILS is empty — every Supabase login will be refused (fail closed). Set ALLOWED_EMAILS in Railway → Variables.')
if (!SUPABASE_ENABLED && !PASSWORD)
  console.warn('[server] ⚠ no auth configured (SUPABASE_URL+SUPABASE_ANON_KEY or APP_PASSWORD) — /api/* will refuse every request (fail closed). Set them in Railway → Variables.')
console.log(`[server] tenancy ${tenancyEnabled()
  ? 'ENABLED — DB-backed tenants + members (email → tenant)'
  : 'off — legacy global allowlist (set SUPABASE_SERVICE_ROLE_KEY to enable multi-tenant)'}`)
console.log(`[server] BYOK secrets ${secretsEnabled()
  ? 'ENABLED — envelope-encrypted per-tenant keys'
  : 'off — providers use process env vars (set SECRETS_KEK + tenancy to enable)'}`)
console.log(`[server] public demo ${demoLoaded() ? 'ENABLED — /demo + /api/demo/* serve synthetic data only' : 'off — demo-data.json absent (run tools/build_demo_data.mjs)'}`)

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
    if (!email) return res.status(401).json({ error: 'invalid or expired session — sign in again' })
    // Membership decides entry AND which tenant's data/keys this request may touch.
    // When tenancy is off (no service-role key), resolveTenant falls back to the
    // legacy emailAllowed() check and returns the default tenant — byte-identical
    // to the old global-allowlist behavior.
    const tenant = await resolveTenant(email, { legacyAllowed: emailAllowed })
    if (!tenant) return res.status(401).json({ error: 'account not on the allowed list' })
    req.tenant = tenant
    req.userEmail = email
    return next()
  }
  if (PASSWORD && (req.body?.password || '') === PASSWORD) {
    // Legacy shared password has no per-person identity → the default tenant.
    req.tenant = { ...DEFAULT_TENANT }
    return next()
  }
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

// Build per-tenant deal-book credentials (Pipedrive token + Anthropic key) from
// req.tenant. The legacy/default tenant returns undefined → dealsChat keeps using
// today's env fallback. A real tenant resolves its own keys; a missing Pipedrive
// token throws 'not_configured' (→ 503, never the platform key), and the Anthropic
// key falls back to the platform key ("use ours") when the tenant hasn't BYO'd one.
async function dealsCreds(req) {
  const tenant = req.tenant
  if (!tenant || tenant.source === 'legacy') return undefined
  const resolver = new SecretResolver(tenant)
  const pipedriveToken = await resolver.get('crm.pipedrive', 'api_token')
  if (!pipedriveToken) { const e = new Error('Pipedrive not configured for this workspace'); e.code = 'not_configured'; throw e }
  const anthropicKey = (await resolver.get('llm.anthropic', 'api_key')) || process.env.ANTHROPIC_API_KEY || ''
  return { pipedriveToken, anthropicKey, cacheKey: tenant.id }
}

// Deals DB, no-LLM path: the live deal book + keyword search + known-question
// presets, straight from Pipedrive. Same password gate as /api/data.
//   {password}                    -> every deal (for the table)
//   {password, q: "meeting st"}   -> keyword search with matched-note snippets
//   {password, preset: "tracking"}-> a known question (tracking/open/won/lost/recent/noted)
app.post('/api/deals', requireAuth, async (req, res) => {
  try {
    const creds = await dealsCreds(req)
    res.json(await searchDeals({
      q: String(req.body?.q || '').slice(0, 500),
      preset: String(req.body?.preset || ''),
    }, creds))
  } catch (e) {
    if (e.code === 'not_configured') return res.status(503).json({ error: e.message })
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
    const creds = await dealsCreds(req)
    res.json(await answerDealsQuestion(question, history, creds))
  } catch (e) {
    if (e.code === 'not_configured') return res.status(503).json({ error: e.message })
    console.error('[deals-chat]', e)
    res.status(502).json({ error: e?.message || 'deals chat failed' })
  }
})

// ── live-scrape service (FastAPI/Playwright sidecar, localhost-only) ────────
// The Python sidecar owns the brokerage scrapers + listings DB; this proxy is
// the ONLY way to reach it, so every /live call passes the same auth as
// /api/data. The client always POSTs (legacy password rides the body); the
// sidecar method/path comes from this fixed table — nothing forwards blindly.
const LIVE_API = process.env.LIVE_API_URL || 'http://127.0.0.1:8000'
const LIVE_ROUTES = {
  scrape: ['POST', '/live/scrape'],
  stop: ['POST', '/live/stop'],
  status: ['GET', '/live/status'],
  rows: ['GET', '/live/rows'],
  import: ['POST', '/live/import'],
}
app.use('/api/live', rateLimit(60))
app.post('/api/live/:action', requireAuth, async (req, res) => {
  const route = LIVE_ROUTES[req.params.action]
  if (!route) return res.status(404).json({ error: 'unknown live action' })
  const [method, path] = route
  try {
    const { password: _pw, ...body } = req.body || {}
    const r = await fetch(`${LIVE_API}${path}`, {
      method,
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    })
    res.status(r.status).json(await r.json())
  } catch (e) {
    console.error('[live]', e?.message || e)
    res.status(502).json({ error: 'live scrape service unavailable' })
  }
})

// ── PhoneBurner: single-line power dialer + live human handoff ─────────────
// Client-facing routes are POST (so both auth modes work, same as /api/data);
// webhooks are POST but gated by a path secret (PhoneBurner can't send our JWT).
//   PHONEBURNER_ACCESS_TOKEN  (personal token)  OR  PHONEBURNER_CLIENT_ID/_SECRET/_REDIRECT_URI
//   PHONEBURNER_WEBHOOK_SECRET — random string; gates webhooks + oauth start
//   PUBLIC_BASE_URL — https base of this app, used to build webhook callback URLs
const PB_WEBHOOK_SECRET = process.env.PHONEBURNER_WEBHOOK_SECRET || ''
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
app.use('/api/phoneburner', rateLimit(60))

app.post('/api/phoneburner/status', requireAuth, async (_req, res) => {
  try { res.json(await pbStatus()) }
  catch (e) { console.error('[pb status]', e); res.status(502).json({ error: e.message }) }
})

// Push already-DNC-scrubbed contacts into PhoneBurner. Body: { contacts:[...] }.
app.post('/api/phoneburner/push', requireAuth, async (req, res) => {
  if (!pbConfigured()) return res.status(503).json({ error: 'PhoneBurner not configured (set PHONEBURNER_ACCESS_TOKEN or the OAuth vars)' })
  const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, 500) : []
  if (!contacts.length) return res.status(400).json({ error: 'contacts[] required' })
  try { res.json({ pushed: await pushContacts(contacts) }) }
  catch (e) { console.error('[pb push]', e); res.status(502).json({ error: e.message }) }
})

// Mint a dial session; returns { redirect_url } to launch (iframe or new tab).
app.post('/api/phoneburner/dial', requireAuth, async (req, res) => {
  if (!pbConfigured()) return res.status(503).json({ error: 'PhoneBurner not configured' })
  const contactIds = Array.isArray(req.body?.contactIds) ? req.body.contactIds : []
  const callbackBase = PB_WEBHOOK_SECRET && PUBLIC_BASE ? `${PUBLIC_BASE}/api/phoneburner/hook/${PB_WEBHOOK_SECRET}` : ''
  try { res.json(await createDialSession({ contactIds, callbackBase })) }
  catch (e) { console.error('[pb dial]', e); res.status(502).json({ error: e.message }) }
})

app.post('/api/phoneburner/recent', requireAuth, (_req, res) => res.json({ calls: recentCalls() }))

// OAuth connect — one-time admin setup (browser GET redirects). The start route
// is gated by the webhook secret (?k=) so it isn't publicly triggerable.
// Set PHONEBURNER_REDIRECT_URI = {PUBLIC_BASE_URL}/api/phoneburner/oauth/callback.
app.get('/api/phoneburner/oauth/start', (req, res) => {
  if (!PB_WEBHOOK_SECRET || req.query.k !== PB_WEBHOOK_SECRET) return res.status(403).send('forbidden')
  if (pbMode() !== 'oauth') return res.status(400).send('personal-token mode — no OAuth needed')
  res.redirect(oauthAuthorizeUrl('connect'))
})
app.get('/api/phoneburner/oauth/callback', async (req, res) => {
  try { await oauthExchange(String(req.query.code || '')); res.send('PhoneBurner connected — you can close this tab.') }
  catch (e) { res.status(502).send(`connect failed: ${e.message}`) }
})

// Webhooks — PhoneBurner calls these (no user auth); the path secret is the gate.
// Body is untrusted: log the outcome + do your own lookups, never act on it blindly.
app.post('/api/phoneburner/hook/:secret/:event', (req, res) => {
  if (!PB_WEBHOOK_SECRET || req.params.secret !== PB_WEBHOOK_SECRET) return res.status(403).json({ error: 'forbidden' })
  if (!['callbegin', 'calldone', 'contact-displayed'].includes(req.params.event)) return res.status(404).json({ error: 'unknown event' })
  try {
    const rec = recordCallEvent(req.params.event, req.body || {})
    // On a warm/qualified live-call outcome, create a Pipedrive activity so the
    // lead surfaces in the deal book (fire-and-forget — never fail the webhook).
    if (req.params.event === 'calldone' && isWarm(rec?.disposition)) {
      pushWarmDisposition(rec).catch((e) => console.error('[pb→pipedrive]', e.message))
    }
  } catch (e) { console.error('[pb hook]', e) }
  res.json({ ok: true })
})

// ── Pipedrive writes: sync brokers + push sourced leads/deals into the CRM ──
// Reuses PIPEDRIVE_API_TOKEN (the same token the deal book reads with). Sourced
// records land in the Tracking pipeline (PIPEDRIVE_SOURCING_STAGE_ID); dedupe by
// email/phone (persons) and title (deals) makes re-clicks idempotent. Pass
// { dryRun: true } to preview a payload without writing.
app.use('/api/pipedrive', rateLimit(60))

app.post('/api/pipedrive/status', requireAuth, async (_req, res) => {
  try { res.json(await pdStatusInfo()) }
  catch (e) { console.error('[pd status]', e); res.status(502).json({ error: e.message }) }
})

// Sync a broker as a Pipedrive Person. Body: { broker:{name,cell,phone,email,firm,...} }
app.post('/api/pipedrive/broker', requireAuth, async (req, res) => {
  if (!pdConfigured()) return res.status(503).json({ error: 'Pipedrive not configured (set PIPEDRIVE_API_TOKEN)' })
  const b = req.body?.broker
  if (!b || !(b.name || b.cell || b.phone || b.email)) return res.status(400).json({ error: 'broker with a name or contact required' })
  try { res.json(await syncBroker(b, { dryRun: Boolean(req.body?.dryRun) })) }
  catch (e) { console.error('[pd broker]', e); res.status(502).json({ error: e.message }) }
})

// Push one property as a lead (off-market) / deal (on-market). Body: { prop:{...} }
app.post('/api/pipedrive/lead', requireAuth, async (req, res) => {
  if (!pdConfigured()) return res.status(503).json({ error: 'Pipedrive not configured (set PIPEDRIVE_API_TOKEN)' })
  const p = req.body?.prop
  if (!p || !p.addr) return res.status(400).json({ error: 'prop with an address required' })
  try { res.json(await pushLead(p, { dryRun: Boolean(req.body?.dryRun) })) }
  catch (e) { console.error('[pd lead]', e); res.status(502).json({ error: e.message }) }
})

// Bulk push. Body: { props:[...] } — sequential + best-effort, per-item results.
app.post('/api/pipedrive/leads', requireAuth, async (req, res) => {
  if (!pdConfigured()) return res.status(503).json({ error: 'Pipedrive not configured (set PIPEDRIVE_API_TOKEN)' })
  const props = Array.isArray(req.body?.props) ? req.body.props.slice(0, 100) : []
  if (!props.length) return res.status(400).json({ error: 'props[] required' })
  const dryRun = Boolean(req.body?.dryRun)
  const results = []
  for (const p of props) {
    try { results.push({ id: p.id, addr: p.addr, ...(await pushLead(p, { dryRun })) }) }
    catch (e) { results.push({ id: p.id, addr: p.addr, status: 'error', error: e.message }) }
  }
  res.json({ results, ok: results.filter((r) => r.status !== 'error').length, total: results.length })
})

// Public demo surface: fake-only data + simulated integrations, NO auth. Kept in
// its own module with no path to real data/keys (see demo.mjs). Mounted after the
// real /api/* routes (which stay behind requireAuth) and before the SPA fallback.
app.use('/api/demo', demoRouter)

// static SPA + client-side routing fallback
app.use(express.static(DIST))
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')))

const authDesc = [
  SUPABASE_ENABLED ? `supabase(allowed: ${ALLOWED_ENTRIES.join(' ') || 'NONE'})` : null,
  PASSWORD ? 'password' : null,
].filter(Boolean).join('+') || 'NONE → fail-closed'
app.listen(PORT, () => console.log(`[server] listening on :${PORT} (auth=${authDesc})`))
