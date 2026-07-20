// PhoneBurner integration — SINGLE-LINE POWER DIALER + live human handoff.
// NO AI voice on cold calls (see docs/memos Dialer-Handoff briefs / Initiative #7).
// This module only: (a) pushes ALREADY-DNC-SCRUBBED contacts into PhoneBurner,
// (b) mints a browser dial-session the rep launches via an SSO redirect_url
// (embeddable in our console), (c) records call outcomes the webhooks post back.
//
// It never places a call itself and never uses a synthetic/cloned voice — the
// rep talks on every connect. Keep it that way (compliance, FCC 24-17).
//
// AUTH — two modes, whichever is configured (personal token preferred for a
// single company account; OAuth is for multi-account/product use):
//   PHONEBURNER_ACCESS_TOKEN                         personal access token (simplest)
//   PHONEBURNER_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI   OAuth app
//     (OAuth refresh token is persisted to DATA_DIR/phoneburner-token.json so it
//      survives restarts; access tokens auto-refresh.)
// Never hardcode any of these — set them in Railway → Variables.
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

const PAT = process.env.PHONEBURNER_ACCESS_TOKEN || ''
const CLIENT_ID = process.env.PHONEBURNER_CLIENT_ID || ''
const CLIENT_SECRET = process.env.PHONEBURNER_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.PHONEBURNER_REDIRECT_URI || ''
const DATA_DIR = process.env.DATA_DIR || ''
const TOKEN_PATH = DATA_DIR ? join(DATA_DIR, 'phoneburner-token.json') : ''

export const pbMode = () => (PAT ? 'personal' : CLIENT_ID && CLIENT_SECRET ? 'oauth' : null)
export const pbConfigured = () => pbMode() !== null

// ── OAuth token store (oauth mode only) ────────────────────────────────────
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
export const pbConnected = () => Boolean(PAT || loadTok()?.refresh_token)

export function oauthAuthorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', state: state || '',
  })
  return `${OAUTH.authorize}?${p}`
}
export async function oauthExchange(code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code,
    redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
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
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: cur.refresh_token, grant_type: 'refresh_token',
  })
  const r = await fetch(OAUTH.refresh, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!r.ok) throw new Error(`oauth refresh failed: ${r.status}`)
  const t = await r.json()
  saveTok({ access_token: t.access_token, refresh_token: t.refresh_token || cur.refresh_token, expires_at: Date.now() + (t.expires_in || 604800) * 1000 - 60_000 })
  return t.access_token
}
async function accessToken() {
  if (PAT) return PAT
  const cur = loadTok()
  if (cur?.access_token && cur.expires_at > Date.now()) return cur.access_token
  return refresh()
}

// ── authed fetch, one refresh-retry on 401 (oauth mode) ────────────────────
async function pbFetch(path, { method = 'GET', body } = {}) {
  const hit = async (tok) => fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let tok = await accessToken()
  let r = await hit(tok)
  if (r.status === 401 && !PAT) { tok = await refresh(); r = await hit(tok) }
  if (!r.ok) throw new Error(`PhoneBurner ${method} ${path} → ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const ct = r.headers.get('content-type') || ''
  return ct.includes('json') ? r.json() : r.text()
}

export async function pbStatus() {
  if (!pbConfigured()) return { configured: false, mode: null, connected: false }
  if (!pbConnected()) return { configured: true, mode: pbMode(), connected: false }
  const members = await pbFetch('/members?page_size=1').catch((e) => ({ error: e.message }))
  return { configured: true, mode: pbMode(), connected: !members?.error, detail: members?.error || 'ok' }
}

// Push ALREADY-SCRUBBED contacts. Each: {first_name,last_name,phone,email?,
// address?,city?,state?,notes?,external_id?}. Returns [{external_id,phone,id}].
export async function pushContacts(contacts = []) {
  const out = []
  for (const c of contacts) {
    const payload = {
      first_name: c.first_name || '', last_name: c.last_name || '', phone_number: c.phone,
      email_address: c.email || undefined,
      address: c.address || undefined, city: c.city || undefined, state: c.state || undefined,
      notes: c.notes || undefined, custom1: c.external_id || undefined,
    }
    const res = await pbFetch('/contacts', { method: 'POST', body: payload })
    const id = res?.contacts?.[0]?.contact_id ?? res?.contact?.contact_id ?? res?.contact_id ?? res?.id ?? null
    out.push({ external_id: c.external_id || null, phone: c.phone, id })
  }
  return out
}

// Mint a browser dial-session the rep launches. contactIds = PhoneBurner ids.
// callbackBase = public https base for our webhook receivers, e.g.
// https://<app>/api/phoneburner/hook/<secret>. Returns { redirect_url, id }.
export async function createDialSession({ contactIds = [], callbackBase = '' } = {}) {
  const body = { contacts: contactIds }
  if (callbackBase) {
    body.api_callbegin = `${callbackBase}/callbegin`
    body.api_contact_displayed = `${callbackBase}/contact-displayed`
    body.api_calldone = `${callbackBase}/calldone`
  }
  const res = await pbFetch('/dialsession', { method: 'POST', body })
  const redirect_url = res?.dialsession?.redirect_url ?? res?.redirect_url
  const id = res?.dialsession?.dialsession_id ?? res?.dialsession_id ?? null
  if (!redirect_url) throw new Error('PhoneBurner did not return a redirect_url')
  return { redirect_url, id }
}

// ── call-outcome buffer (fed by the webhook receivers) ─────────────────────
const recent = []
export function recordCallEvent(event, payload = {}) {
  const c = payload.contact || payload
  const rec = {
    event,
    at: Date.now(),
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || null,
    phone: c.phone_number || c.phone || null,
    disposition: payload.result || payload.disposition || payload.call_status || null,
    external_id: c.custom1 || c.external_id || null,
  }
  recent.unshift(rec)
  if (recent.length > 200) recent.length = 200
  return rec
}
export function recentCalls(limit = 50) { return recent.slice(0, limit) }

// ── Pipedrive sync — warm/qualified call outcomes → a Pipedrive activity ────
// Reuses the deal book's token (PIPEDRIVE_API_TOKEN), same as dealsChat.mjs.
// Which dispositions count as "warm" is tunable via PHONEBURNER_WARM_REGEX.
const PD_BASE = 'https://api.pipedrive.com/v1'
const WARM_RE = new RegExp(process.env.PHONEBURNER_WARM_REGEX || 'warm|qualif|interested|callback|follow', 'i')
export const isWarm = (disposition) => WARM_RE.test(disposition || '')

export async function pushWarmDisposition(rec = {}) {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return { skipped: 'PIPEDRIVE_API_TOKEN not set' }
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
  const r = await fetch(`${PD_BASE}/activities?api_token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`pipedrive activities → ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`)
  return r.json()
}
