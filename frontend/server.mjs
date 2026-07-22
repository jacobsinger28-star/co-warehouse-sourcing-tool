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
import { resolveTenant, DEFAULT_TENANT, resolveTenantByWebhookSecret, getTenantWebhookSecret } from './tenants.mjs'
import { tenancyEnabled } from './db.mjs'
import { resolveTenantCrm, legacyCrm } from './crm/registry.mjs'
import { demoRouter, demoLoaded } from './demo.mjs'
import { installRedaction, secretsEnabled, SecretResolver, writeSecret } from './secrets.mjs'
import { parseLeaseRate, leaseRepRate } from './leaseRate.mjs'
import {
  billingEnabled, getBillingSummary, createCheckout, createPortalSession,
  recordUsage, aiEntitlement, shouldDegradeAi,
  verifyStripeSignature, handleStripeEvent,
} from './billing.mjs'

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
//
// The overlay note carries the asking rate only as free text ("… $8.50 SF/YR").
// We parse it into a clean numeric $/SF/YR here — the single point where p.lease
// is attached — so the field survives any overlay regen without a generator step:
//   l.rate       = per-listing asking rate (null when Price Upon Request)
//   p.lease.rate = representative = MIN asking across the property's listings
//                  (cheapest available space); omitted when nothing states a rate.
const LEASE_OVERLAY = readJson(join(__dirname, 'lease-overlay.json'))
if (hasData(DATA) && LEASE_OVERLAY?.props) {
  let leaseN = 0, rateN = 0
  for (const p of DATA.props) {
    const l = LEASE_OVERLAY.props[p.id]
    if (!l) continue
    if (Array.isArray(l.listings)) for (const li of l.listings) li.rate = parseLeaseRate(li.note)
    const rate = leaseRepRate(l)
    if (rate !== undefined) { l.rate = rate; rateN++ }
    p.lease = l; leaseN++
  }
  console.log(`[server] lease overlay: ${leaseN} of ${Object.keys(LEASE_OVERLAY.props).length} flagged props present in dataset (${rateN} with a parsed $/SF/YR rate)`)
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
// `verify` stashes the raw bytes so the Stripe webhook can check its HMAC
// signature against exactly what was sent (re-serialized JSON would not match).
app.use(express.json({ limit: '256kb', verify: (req, _res, buf) => { req.rawBody = buf } }))

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

// ── tenant integrations (BYOK) — the Settings surface ────────────────────────
// This catalog drives the Settings UI and validates writes. Secret VALUES are
// never returned by any route here — only masked configured/source status.
const CONNECTORS = [
  { provider: 'llm.anthropic', label: 'Anthropic', category: 'AI / LLM', authModel: 'static', fields: ['api_key'],
    note: "Powers the Deals AI. Leave blank to use SimiCapital's key (metered)." },
  { provider: 'llm.openai', label: 'OpenAI', category: 'AI / LLM', authModel: 'static', fields: ['api_key'],
    note: 'Your OpenAI API key (platform.openai.com → API keys). Stored for model routing — the Deals AI runs on Claude today.' },
  { provider: 'llm.gemini', label: 'Google Gemini', category: 'AI / LLM', authModel: 'static', fields: ['api_key'],
    note: 'Your Gemini API key (Google AI Studio → Get API key). Stored for model routing — the Deals AI runs on Claude today.' },
  { provider: 'crm.pipedrive', label: 'Pipedrive', category: 'CRM', authModel: 'static', fields: ['api_token'],
    note: 'Your API token (Pipedrive → Personal preferences → API). Syncs brokers + pushes leads.' },
  { provider: 'crm.followupboss', label: 'Follow Up Boss', category: 'CRM', authModel: 'static', fields: ['api_key'],
    note: 'Your FUB API key (Admin → API). Syncs brokers as people + pushes sourced leads with a note.' },
  { provider: 'crm.gohighlevel', label: 'GoHighLevel', category: 'CRM', authModel: 'static', fields: ['api_key'],
    note: 'A GoHighLevel v1 Location API key (Settings → Business Info → API Key). Syncs contacts + leads.' },
  { provider: 'crm.webhook', label: 'Webhook / Zapier', category: 'CRM', authModel: 'static', fields: ['url'],
    note: 'A webhook URL (Zapier/Make/your endpoint). Sourced brokers + leads POST here as JSON — for CRMs without an API.' },
  { provider: 'crm.hubspot', label: 'HubSpot', category: 'CRM', authModel: 'static', fields: ['access_token'],
    note: 'A private-app access token (HubSpot → Settings → Integrations → Private apps). CRM sync lands here next.' },
  { provider: 'crm.close', label: 'Close', category: 'CRM', authModel: 'static', fields: ['api_key'],
    note: 'Your Close API key (Settings → API keys). CRM sync lands here next.' },
  { provider: 'crm.zoho', label: 'Zoho CRM', category: 'CRM', authModel: 'oauth2',
    fields: ['client_id', 'client_secret', 'refresh_token'],
    note: 'A Zoho self-client (api-console.zoho.com): create it, then paste its credentials and a refresh token. CRM sync lands here next.' },
  { provider: 'dialer.phoneburner', label: 'PhoneBurner', category: 'Outreach', authModel: 'static', fields: ['access_token'],
    note: 'A PhoneBurner access token (Professional tier). Unlocks the power dialer; warm call outcomes post back to your Pipedrive.' },
]
const CONNECTOR_FIELD = new Set(CONNECTORS.flatMap((c) => c.fields.map((f) => `${c.provider}/${f}`)))
const isRealTenant = (t) => Boolean(t && t.source !== 'legacy' && t.id !== 'default')

app.use('/api/tenant', rateLimit(60))

// Masked status of every connector for this tenant (never any value).
app.post('/api/tenant/connections', requireAuth, async (req, res) => {
  const tenant = req.tenant
  const resolver = new SecretResolver(tenant)
  const real = isRealTenant(tenant)
  try {
    const connectors = []
    for (const c of CONNECTORS) {
      const configured = await resolver.configured(c.provider)
      connectors.push({
        provider: c.provider, label: c.label, category: c.category, authModel: c.authModel,
        fields: c.fields, note: c.note, configured, source: configured ? (real ? 'tenant' : 'env') : null,
      })
    }
    res.json({
      connectors,
      writable: secretsEnabled() && real, // per-tenant writes need the KEK + a real tenant
      tenant: { slug: tenant?.slug || null, name: tenant?.name || null, real },
    })
  } catch (e) { console.error('[connections]', e); res.status(502).json({ error: e.message }) }
})

// Store one connector field (write-only). Refuses the shared/legacy workspace.
app.post('/api/tenant/connections/set', requireAuth, async (req, res) => {
  const tenant = req.tenant
  if (!isRealTenant(tenant))
    return res.status(400).json({ error: 'The shared workspace uses server-managed keys — bring-your-own-keys needs a provisioned tenant.' })
  if (!secretsEnabled())
    return res.status(400).json({ error: 'Encrypted secrets are not enabled on this server (set SECRETS_KEK).' })
  const provider = String(req.body?.provider || '')
  const field = String(req.body?.field || '')
  const value = String(req.body?.value || '')
  if (!CONNECTOR_FIELD.has(`${provider}/${field}`)) return res.status(400).json({ error: 'unknown connector field' })
  if (!value) return res.status(400).json({ error: 'a value is required' })
  const conn = CONNECTORS.find((c) => c.provider === provider)
  try {
    await writeSecret(tenant.id, provider, field, value, { authModel: conn.authModel })
    res.json({ ok: true, provider, field, configured: true }) // never echo the value
  } catch (e) { console.error('[connections/set]', e); res.status(502).json({ error: e.message }) }
})

// ── billing (skeleton) — plan + usage read, checkout, Stripe webhook ─────────
// Dormant until STRIPE_SECRET_KEY is set: the summary route always works (it
// reports plan/usage so the Settings UI can render), checkout returns 501, and
// the webhook refuses everything without a verifiable signature.

// Plan, status, and this month's metered usage for the caller's workspace.
app.post('/api/tenant/billing', requireAuth, async (req, res) => {
  try { res.json(await getBillingSummary(req.tenant)) }
  catch (e) { console.error('[billing]', e); res.status(502).json({ error: e.message }) }
})

// Start a Stripe subscription checkout; returns { url } to redirect the browser to.
app.post('/api/tenant/billing/checkout', requireAuth, async (req, res) => {
  const tenant = req.tenant
  if (!isRealTenant(tenant))
    return res.status(400).json({ error: 'The shared workspace is not billable — checkout needs a provisioned tenant.' })
  const plan = String(req.body?.plan || '')
  const origin = req.headers.origin || `https://${req.headers.host}`
  try {
    res.json(await createCheckout(tenant, plan, {
      successUrl: `${origin}/?billing=success`,
      cancelUrl: `${origin}/?billing=canceled`,
    }))
  } catch (e) {
    if (e.code === 'not_enabled') return res.status(501).json({ error: e.message })
    console.error('[billing/checkout]', e)
    res.status(502).json({ error: e.message })
  }
})

// Deep-link to Stripe's hosted Customer Portal (manage card / invoices / cancel).
// Mirrors checkout: 501 until Stripe is live, 409 for a tenant that hasn't
// subscribed yet (no customer to manage), else { url } to redirect the browser to.
app.post('/api/tenant/billing/portal', requireAuth, async (req, res) => {
  const tenant = req.tenant
  if (!isRealTenant(tenant))
    return res.status(400).json({ error: 'The shared workspace is not billable.' })
  const origin = req.headers.origin || `https://${req.headers.host}`
  try {
    res.json(await createPortalSession(tenant, { returnUrl: `${origin}/?billing=managed` }))
  } catch (e) {
    if (e.code === 'not_enabled') return res.status(501).json({ error: e.message })
    if (e.code === 'no_customer') return res.status(409).json({ error: e.message })
    console.error('[billing/portal]', e)
    res.status(502).json({ error: e.message })
  }
})

// Stripe → server. No requireAuth (Stripe can't log in) — the HMAC signature over
// the RAW body is the authentication. Always 200 on verified events (even ignored
// ones) so Stripe stops retrying; 400/501 only when verification itself fails.
app.post('/api/billing/webhook', rateLimit(120), async (req, res) => {
  const whsec = process.env.STRIPE_WEBHOOK_SECRET || ''
  if (!whsec || !billingEnabled()) return res.status(501).json({ error: 'billing webhook not enabled' })
  const raw = req.rawBody ? req.rawBody.toString('utf8') : ''
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], whsec))
    return res.status(400).json({ error: 'bad signature' })
  try { res.json(await handleStripeEvent(req.body)) }
  catch (e) { console.error('[billing/webhook]', e); res.status(500).json({ error: 'webhook handling failed' }) }
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
  const tenantKey = await resolver.get('llm.anthropic', 'api_key')
  const anthropicKey = tenantKey || process.env.ANTHROPIC_API_KEY || ''
  // meteredLLM: the tenant is riding on the platform key → its AI calls are
  // metered into usage_events (billing.mjs) instead of billed to their own key.
  return { pipedriveToken, anthropicKey, cacheKey: tenant.id, meteredLLM: !tenantKey }
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
    if (creds?.meteredLLM) {
      // Riding on SimiCapital's Anthropic key → the plan's included AI calls apply.
      // A spent-out free trial must bring its own key or upgrade (no card on file to
      // bill overage to); paid plans meter-and-bill and pass straight through. Dormant
      // today: aiEntitlement() is null for the legacy/default workspace and when
      // tenancy is off, so this can only fire for a provisioned tenant over quota.
      const ent = await aiEntitlement(req.tenant)
      if (shouldDegradeAi(ent))
        return res.status(402).json({
          error: 'Monthly trial AI limit reached. Add your own Anthropic key in Settings to continue, or upgrade your plan.',
          code: 'ai_quota_exceeded', entitlements: ent,
        })
    }
    const answer = await answerDealsQuestion(question, history, creds)
    if (creds?.meteredLLM) recordUsage(req.tenant.id, 'llm.deals_chat', 1, { route: 'deals-chat' }) // fire-and-forget
    res.json(answer)
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
// Per-tenant BYOK (Phase 2c). Client routes resolve pbCreds(req): a real tenant
// runs on its own pasted access token + its own Pipedrive; the legacy/default
// workspace (source:'legacy') falls back to the process-env credentials below —
// byte-identical to before. A webhook can't send our JWT, so its path <secret>
// is what identifies the workspace: the env secret is the default workspace, and
// each tenant has its own webhook_secret (migration 0004). A warm call outcome is
// therefore always written into the Pipedrive of the workspace that owns the call.
//   PHONEBURNER_ACCESS_TOKEN  (personal token)  OR  PHONEBURNER_CLIENT_ID/_SECRET/_REDIRECT_URI
//   PHONEBURNER_WEBHOOK_SECRET — the default workspace's secret; gates its webhooks + oauth start
//   PUBLIC_BASE_URL — https base of this app, used to build webhook callback URLs
const PB_WEBHOOK_SECRET = process.env.PHONEBURNER_WEBHOOK_SECRET || ''
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
app.use('/api/phoneburner', rateLimit(60))

// Per-tenant PhoneBurner creds: legacy/default → null (module uses env, unchanged);
// real tenant → { accessToken, pipedriveToken } from tenant_secrets (null when
// unconfigured → pbConfigured(creds) is false → the route 503s, never the env token).
async function pbCreds(req) {
  const tenant = req.tenant
  if (!tenant || tenant.source === 'legacy') return null
  const r = new SecretResolver(tenant)
  const [accessToken, pipedriveToken] = await Promise.all([
    r.get('dialer.phoneburner', 'access_token'),
    r.get('crm.pipedrive', 'api_token'),
  ])
  return { accessToken: accessToken ?? null, pipedriveToken: pipedriveToken ?? null }
}
const pbTenantKey = (req) => (req.tenant && req.tenant.source !== 'legacy' ? req.tenant.id : 'default')
const pbUnconfiguredMsg = (req) => (req.tenant && req.tenant.source !== 'legacy')
  ? 'PhoneBurner not connected — add your access token in Settings.'
  : 'PhoneBurner not configured (set PHONEBURNER_ACCESS_TOKEN or the OAuth vars).'
// The dial-session callback base for this workspace — its own webhook secret, so
// PhoneBurner posts outcomes back to a path that resolves to this tenant.
async function pbCallbackBase(req) {
  if (!PUBLIC_BASE) return ''
  const tenant = req.tenant
  if (!tenant || tenant.source === 'legacy')
    return PB_WEBHOOK_SECRET ? `${PUBLIC_BASE}/api/phoneburner/hook/${PB_WEBHOOK_SECRET}` : ''
  const secret = await getTenantWebhookSecret(tenant.id)
  return secret ? `${PUBLIC_BASE}/api/phoneburner/hook/${secret}` : ''
}

app.post('/api/phoneburner/status', requireAuth, async (req, res) => {
  try { res.json(await pbStatus(await pbCreds(req))) }
  catch (e) { console.error('[pb status]', e); res.status(502).json({ error: e.message }) }
})

// Push already-DNC-scrubbed contacts into PhoneBurner. Body: { contacts:[...] }.
app.post('/api/phoneburner/push', requireAuth, async (req, res) => {
  const creds = await pbCreds(req)
  if (!pbConfigured(creds)) return res.status(503).json({ error: pbUnconfiguredMsg(req) })
  const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, 500) : []
  if (!contacts.length) return res.status(400).json({ error: 'contacts[] required' })
  try { res.json({ pushed: await pushContacts(creds, contacts) }) }
  catch (e) { console.error('[pb push]', e); res.status(502).json({ error: e.message }) }
})

// Mint a dial session; returns { redirect_url } to launch (iframe or new tab).
app.post('/api/phoneburner/dial', requireAuth, async (req, res) => {
  const creds = await pbCreds(req)
  if (!pbConfigured(creds)) return res.status(503).json({ error: pbUnconfiguredMsg(req) })
  const contactIds = Array.isArray(req.body?.contactIds) ? req.body.contactIds : []
  try {
    const callbackBase = await pbCallbackBase(req)
    res.json(await createDialSession(creds, { contactIds, callbackBase }))
  } catch (e) { console.error('[pb dial]', e); res.status(502).json({ error: e.message }) }
})

app.post('/api/phoneburner/recent', requireAuth, (req, res) => res.json({ calls: recentCalls(pbTenantKey(req)) }))

// OAuth connect — the DEFAULT/legacy workspace's one-time admin setup (browser GET
// redirects), operating on the process-env OAuth app + DATA_DIR token store. Gated
// by the env webhook secret (?k=) so it isn't publicly triggerable. Real tenants
// use a pasted access token in Settings; per-tenant OAuth-app connect is a follow-up.
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

// Webhooks — PhoneBurner calls these (no user auth); the path secret is the gate
// AND the workspace selector. The env secret is the default workspace (matched
// first); otherwise it must resolve to a tenant's own secret, else 403 — never a
// silent cross-tenant write. Body is untrusted: log the outcome + do our own
// lookups, never act on it blindly.
app.post('/api/phoneburner/hook/:secret/:event', async (req, res) => {
  const { secret, event } = req.params
  if (!['callbegin', 'calldone', 'contact-displayed'].includes(event)) return res.status(404).json({ error: 'unknown event' })
  let tenantKey = 'default'
  let pipedriveToken = null
  if (PB_WEBHOOK_SECRET && secret === PB_WEBHOOK_SECRET) {
    pipedriveToken = process.env.PIPEDRIVE_API_TOKEN || null // the default/legacy workspace
  } else {
    const t = await resolveTenantByWebhookSecret(secret)
    if (!t) return res.status(403).json({ error: 'forbidden' })
    tenantKey = t.id
    pipedriveToken = (await new SecretResolver(t).get('crm.pipedrive', 'api_token')) ?? null
  }
  try {
    const rec = recordCallEvent(tenantKey, event, req.body || {})
    // On a warm/qualified live-call outcome, create a Pipedrive activity in THIS
    // workspace's CRM (fire-and-forget — never fail the webhook).
    if (event === 'calldone' && isWarm(rec?.disposition)) {
      pushWarmDisposition(rec, { pipedriveToken }).catch((e) => console.error('[pb→pipedrive]', e.message))
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

// The CRM adapter for this request's workspace (Phase 3 — pluggable CRM).
// Legacy/default tenant → Pipedrive on the env token (unchanged behavior); a real
// tenant → its first-configured CRM from tenant_secrets, or null (no CRM connected
// → the route 503s, never the env token — the BYOK isolation guarantee).
async function tenantCrm(req) {
  const tenant = req.tenant
  if (!tenant || tenant.source === 'legacy') return legacyCrm()
  return await resolveTenantCrm(new SecretResolver(tenant))
}
const NO_CRM = 'No CRM connected for this workspace — add one (Pipedrive, Follow Up Boss, GoHighLevel, or a webhook) in Settings.'

// NOTE: routes keep the /api/pipedrive/* paths for frontend back-compat, but now
// dispatch to whatever CRM the workspace configured; the response carries `provider`.
app.post('/api/pipedrive/status', requireAuth, async (req, res) => {
  try {
    const crm = await tenantCrm(req)
    if (!crm || !crm.adapter.configured()) return res.json({ configured: false })
    res.json({ provider: crm.provider, ...(await crm.adapter.status()) })
  } catch (e) { console.error('[crm status]', e); res.status(502).json({ error: e.message }) }
})

// Sync a broker as a contact in the workspace's CRM. Body: { broker:{name,cell,phone,email,firm,...} }
app.post('/api/pipedrive/broker', requireAuth, async (req, res) => {
  const b = req.body?.broker
  if (!b || !(b.name || b.cell || b.phone || b.email)) return res.status(400).json({ error: 'broker with a name or contact required' })
  try {
    const crm = await tenantCrm(req)
    if (!crm || !crm.adapter.configured()) return res.status(503).json({ error: NO_CRM })
    res.json({ provider: crm.provider, ...(await crm.adapter.syncBroker(b, { dryRun: Boolean(req.body?.dryRun) })) })
  } catch (e) { console.error('[crm broker]', e); res.status(502).json({ error: e.message }) }
})

// Push one property as a lead/deal into the workspace's CRM. Body: { prop:{...} }
app.post('/api/pipedrive/lead', requireAuth, async (req, res) => {
  const p = req.body?.prop
  if (!p || !p.addr) return res.status(400).json({ error: 'prop with an address required' })
  try {
    const crm = await tenantCrm(req)
    if (!crm || !crm.adapter.configured()) return res.status(503).json({ error: NO_CRM })
    res.json({ provider: crm.provider, ...(await crm.adapter.pushLead(p, { dryRun: Boolean(req.body?.dryRun) })) })
  } catch (e) { console.error('[crm lead]', e); res.status(502).json({ error: e.message }) }
})

// Bulk push. Body: { props:[...] } — sequential + best-effort, per-item results.
app.post('/api/pipedrive/leads', requireAuth, async (req, res) => {
  const props = Array.isArray(req.body?.props) ? req.body.props.slice(0, 100) : []
  if (!props.length) return res.status(400).json({ error: 'props[] required' })
  let crm
  try { crm = await tenantCrm(req) } catch (e) { return res.status(502).json({ error: e.message }) }
  if (!crm || !crm.adapter.configured()) return res.status(503).json({ error: NO_CRM })
  const dryRun = Boolean(req.body?.dryRun)
  const results = []
  for (const p of props) {
    try { results.push({ id: p.id, addr: p.addr, ...(await crm.adapter.pushLead(p, { dryRun })) }) }
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
