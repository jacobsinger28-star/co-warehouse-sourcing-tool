// PhoneBurner integration — SINGLE-LINE POWER DIALER + live human handoff.
// NO AI voice on cold calls (see docs/memos Dialer-Handoff briefs / Initiative #7).
// This module only: (a) pushes ALREADY-DNC-SCRUBBED contacts into PhoneBurner,
// (b) mints a browser dial-session the rep launches via an SSO redirect_url
// (embeddable in our console), (c) records call outcomes the webhooks post back.
//
// It never places a call itself and never uses a synthetic/cloned voice — the
// rep talks on every connect. Keep it that way (compliance, FCC 24-17).
//
// MULTI-TENANT (BYOK) — Phase 2c. Every function takes an optional per-tenant
// `creds` context, resolved from tenant_secrets in server.mjs:
//   creds = { accessToken, pipedriveToken }   (a real tenant)
//   creds = null                              (the legacy/default workspace)
// When creds is null the module uses its process-env credentials + the DATA_DIR
// OAuth token file — byte-identical to the single-tenant past. A real tenant
// NEVER borrows the platform env token: a missing per-tenant access token makes
// pbConfigured(creds) false and the route 503s. The module no longer reads any
// Pipedrive env var — the warm-disposition writer is handed the token to use, so
// a call outcome can only ever land in the tenant that owns the call.
//
// AUTH:
//   real tenant  → a pasted PhoneBurner access token (creds.accessToken), static.
//   legacy/env   → PHONEBURNER_ACCESS_TOKEN (personal), or the OAuth app trio
//                  PHONEBURNER_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI (the
//                  refresh token persists to DATA_DIR/phoneburner-token.json).
// Per-tenant OAuth-app connect (BYO OAuth app + callback→tenant mapping) is a
// documented follow-up; a pasted token is the BYOK v1, like every other connector.
// Never hardcode any of these — set env in Railway → Variables.
//
// NOTE: PhoneBurner's REST/1 request/response field names below are coded
// defensively (multiple fallbacks) — VERIFY the exact contact + dialsession
// shapes against https://www.phoneburner.com/developer/route_list on the first
// live call and tighten the field paths.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://www.phoneburner.com/rest/1'
const OAUTH = {
  authorize: 'https://www.phoneburner.com/oauth/authorize',
  token: 'https://www.phoneburner.com/oauth/accesstoken',
  refresh: 'https://www.phoneburner.com/oauth/refreshtoken',
}

// ── process-env credentials — the legacy/default workspace only ─────────────
const ENV = {
  pat: process.env.PHONEBURNER_ACCESS_TOKEN || '',
  clientId: process.env.PHONEBURNER_CLIENT_ID || '',
  clientSecret: process.env.PHONEBURNER_CLIENT_SECRET || '',
  redirectUri: process.env.PHONEBURNER_REDIRECT_URI || '',
}
const DATA_DIR = process.env.DATA_DIR || ''
const TOKEN_PATH = DATA_DIR ? join(DATA_DIR, 'phoneburner-token.json') : ''

// mode/configured — creds-aware. A real tenant is 'byok' once it has a token.
export const pbMode = (creds) => creds
  ? (creds.accessToken ? 'byok' : null)
  : (ENV.pat ? 'personal' : ENV.clientId && ENV.clientSecret ? 'oauth' : null)
export const pbConfigured = (creds) => pbMode(creds) !== null

// ── OAuth token store (legacy/env oauth mode only) ─────────────────────────
let mem = null // { access_token, refresh_token, expires_at }
const loadTok = () => {
  if (mem) return mem
  if (TOKEN_PATH && existsSync(TOKEN_PATH)) {
    try { mem = JSON.parse(readFileSync(TOKEN_PATH, 'utf8')) } catch { /* ignore */ }
  }
  return mem
}
const saveTok = (t) => {
  mem = t
  if (TOKEN_PATH) {
    try { writeFileSync(TOKEN_PATH, JSON.stringify(t)) }
    catch (e) { console.error('[pb] token persist failed', e) }
  }
}
export const pbConnected = (creds) => creds
  ? Boolean(creds.accessToken)
  : Boolean(ENV.pat || loadTok()?.refresh_token)

export function oauthAuthorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: ENV.clientId, redirect_uri: ENV.redirectUri, response_type: 'code', state: state || '',
  })
  return `${OAUTH.authorize}?${p}`
}
export async function oauthExchange(code) {
  const body = new URLSearchParams({
    client_id: ENV.clientId, client_secret: ENV.clientSecret, code,
    redirect_uri: ENV.redirectUri, grant_type: 'authorization_code',
  })
  const r = await fetch(OAUTH.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!r.ok) throw new Error(`oauth exchange failed: ${r.status} ${(await r.text()).slice(0, 200)}`)
  const t = await r.json()
  saveTok({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 604800) * 1000 - 60_000 })
  return true
}
async function refresh() {
  const cur = loadTok()
  if (!cur?.refresh_token) throw new Error('not connected — run the PhoneBurner OAuth connect flow')
  const body = new URLSearchParams({
    client_id: ENV.clientId, client_secret: ENV.clientSecret,
    refresh_token: cur.refresh_token, grant_type: 'refresh_token',
  })
  const r = await fetch(OAUTH.refresh, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!r.ok) throw new Error(`oauth refresh failed: ${r.status}`)
  const t = await r.json()
  saveTok({ access_token: t.access_token, refresh_token: t.refresh_token || cur.refresh_token, expires_at: Date.now() + (t.expires_in || 604800) * 1000 - 60_000 })
  return t.access_token
}

// Resolve the bearer token for a creds context. A real tenant uses its own static
// access token (no refresh); the legacy workspace uses env PAT or the OAuth store.
async function bearer(creds) {
  if (creds) {
    if (!creds.accessToken) throw new Error('PhoneBurner not connected for this workspace')
    return creds.accessToken
  }
  if (ENV.pat) return ENV.pat
  const cur = loadTok()
  if (cur?.access_token && cur.expires_at > Date.now()) return cur.access_token
  return refresh()
}

// ── authed fetch, one refresh-retry on 401 (legacy oauth mode only) ────────
async function pbFetch(creds, path, { method = 'GET', body } = {}) {
  const hit = async (tok) => fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let tok = await bearer(creds)
  let r = await hit(tok)
  if (r.status === 401 && !creds && !ENV.pat) { tok = await refresh(); r = await hit(tok) } // env oauth only
  if (!r.ok) throw new Error(`PhoneBurner ${method} ${path} → ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const ct = r.headers.get('content-type') || ''
  return ct.includes('json') ? r.json() : r.text()
}

export async function pbStatus(creds) {
  if (!pbConfigured(creds)) return { configured: false, mode: null, connected: false }
  if (!pbConnected(creds)) return { configured: true, mode: pbMode(creds), connected: false }
  const members = await pbFetch(creds, '/members?page_size=1').catch((e) => ({ error: e.message }))
  return { configured: true, mode: pbMode(creds), connected: !members?.error, detail: members?.error || 'ok' }
}

// Push ALREADY-SCRUBBED contacts. Each: {first_name,last_name,phone,email?,
// address?,city?,state?,notes?,external_id?}. Returns [{external_id,phone,id}].
export async function pushContacts(creds, contacts = []) {
  await bearer(creds) // fail fast if this workspace has no usable token — never a per-contact env leak
  const out = []
  for (const c of contacts) {
    // Per-contact guard: a mid-batch failure must not discard the ids already
    // created (returning nothing → the user re-pushes → duplicate dialer contacts).
    try {
      const payload = {
        first_name: c.first_name || '', last_name: c.last_name || '', phone_number: c.phone,
        email_address: c.email || undefined,
        address: c.address || undefined, city: c.city || undefined, state: c.state || undefined,
        notes: c.notes || undefined, custom1: c.external_id || undefined,
      }
      const res = await pbFetch(creds, '/contacts', { method: 'POST', body: payload })
      const id = res?.contacts?.[0]?.contact_id ?? res?.contact?.contact_id ?? res?.contact_id ?? res?.id ?? null
      out.push({ external_id: c.external_id || null, phone: c.phone, id })
    } catch (e) {
      out.push({ external_id: c.external_id || null, phone: c.phone, id: null, error: e.message })
    }
  }
  return out
}

// Mint a browser dial-session the rep launches. contactIds = PhoneBurner ids.
// callbackBase = public https base for this tenant's webhook receivers, e.g.
// https://<app>/api/phoneburner/hook/<tenant-secret>. Returns { redirect_url, id }.
export async function createDialSession(creds, { contactIds = [], callbackBase = '' } = {}) {
  const body = { contacts: contactIds }
  if (callbackBase) {
    body.api_callbegin = `${callbackBase}/callbegin`
    body.api_contact_displayed = `${callbackBase}/contact-displayed`
    body.api_calldone = `${callbackBase}/calldone`
  }
  const res = await pbFetch(creds, '/dialsession', { method: 'POST', body })
  const redirect_url = res?.dialsession?.redirect_url ?? res?.redirect_url
  const id = res?.dialsession?.dialsession_id ?? res?.dialsession_id ?? null
  if (!redirect_url) throw new Error('PhoneBurner did not return a redirect_url')
  return { redirect_url, id }
}

// ── call-outcome buffer (fed by the webhook receivers), per tenant ─────────
// Keyed by tenant so one tenant's rep never sees another's call outcomes. The
// legacy/default workspace uses the 'default' bucket.
const recent = new Map() // tenantKey -> [rec]
export function recordCallEvent(tenantKey, event, payload = {}) {
  const c = payload.contact || payload
  const rec = {
    event,
    at: Date.now(),
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || null,
    phone: c.phone_number || c.phone || null,
    disposition: payload.result || payload.disposition || payload.call_status || null,
    external_id: c.custom1 || c.external_id || null,
  }
  const key = tenantKey || 'default'
  const buf = recent.get(key) || []
  buf.unshift(rec)
  if (buf.length > 200) buf.length = 200
  recent.set(key, buf)
  return rec
}
export function recentCalls(tenantKey, limit = 50) { return (recent.get(tenantKey || 'default') || []).slice(0, limit) }

// ── Pipedrive sync — warm/qualified call outcomes → a Pipedrive activity ────
// The caller hands us the token to write with (the tenant's own, or the env
// token for the legacy workspace). This module never reads a Pipedrive env var,
// so a warm outcome can only land in the workspace that owns the call.
// Which dispositions count as "warm" is tunable via PHONEBURNER_WARM_REGEX.
const PD_BASE = 'https://api.pipedrive.com/v1'
const WARM_RE = new RegExp(process.env.PHONEBURNER_WARM_REGEX || 'warm|qualif|interested|callback|follow', 'i')
export const isWarm = (disposition) => WARM_RE.test(disposition || '')

export async function pushWarmDisposition(rec = {}, { pipedriveToken } = {}) {
  if (!pipedriveToken) return { skipped: 'no Pipedrive token for this workspace' }
  const who = rec.name || rec.phone || rec.external_id || 'PhoneBurner lead'
  const body = {
    subject: `Warm call — ${who}`,
    type: 'call',
    done: 0,
    note: [
      rec.disposition && `Disposition: ${rec.disposition}`,
      rec.phone && `Phone: ${rec.phone}`,
      rec.external_id && `Property: ${rec.external_id}`,
      'Source: PhoneBurner power dialer (live human call)',
    ].filter(Boolean).join('\n'),
  }
  const r = await fetch(`${PD_BASE}/activities?api_token=${pipedriveToken}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`pipedrive activities → ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`)
  return r.json()
}
