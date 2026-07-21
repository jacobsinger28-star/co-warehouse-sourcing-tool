// Pipedrive WRITE client for the sourcing console — turns the "Sync / Push / Send
// to Pipedrive" buttons into real CRM writes. Mirrors the proven Python writer
// (tools/email_to_pipedrive/pipedrive_sync.py) and reuses PIPEDRIVE_API_TOKEN,
// the same token dealsChat.mjs reads the deal book with and phoneburner.mjs logs
// warm calls with.
//
//   syncBroker(b)  → upsert a Person (dedupe email→cell→phone), owned by the
//                    token's user, firm/markets recorded in a source note.
//   pushLead(p)    → upsert the contact Person (broker or owner contact) + create
//                    a Deal in the Tracking pipeline, every fact in a note.
//
// Idempotent by design: persons dedupe by email/phone, deals by exact title, so
// re-clicking never creates duplicates. dryRun previews the payloads and writes
// nothing (used by the tests / a "preview" mode).
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PD_BASE = 'https://api.pipedrive.com/v1'
// Sourced records land in "Tracking" (stage 33) by default — the neutral,
// not-yet-worked bucket (same convention as the email-intake tool), so auto-
// sourced leads never pollute the live Industrial/EasyBay pipelines until a human
// promotes them. Override with PIPEDRIVE_SOURCING_STAGE_ID (or TRACK_STAGE_ID).
const SOURCING_STAGE_ID = Number(process.env.PIPEDRIVE_SOURCING_STAGE_ID || process.env.TRACK_STAGE_ID || 33)
const LABEL = 'sourcing-console'   // person + deal label, for provenance / filtering

// ── token (env, or the sibling backend .env for local dev — like dealsChat.mjs)
function envFromFile(path, key) {
  try {
    if (!existsSync(path)) return ''
    const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith(key))
    return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : ''
  } catch { return '' }
}
function token() {
  return process.env.PIPEDRIVE_API_TOKEN
    || envFromFile(join(__dirname, '../../general-scraping/backend/.env'), 'PIPEDRIVE_API_TOKEN')
}
export const pdConfigured = () => Boolean(token())

async function pd(path, { method = 'GET', body } = {}) {
  const tok = token()
  if (!tok) throw new Error('PIPEDRIVE_API_TOKEN not configured')
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${PD_BASE}${path}${sep}api_token=${tok}`, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) {
    throw new Error(`pipedrive ${method} ${path.split('?')[0]} → ${r.status} ${String(j.error || '').slice(0, 160)}`)
  }
  return j
}

const digits = (s) => String(s || '').replace(/\D/g, '')
const personUrl = (id) => `https://app.pipedrive.com/person/${id}`
const dealUrl = (id) => `https://app.pipedrive.com/deal/${id}`
const htmlEscape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// owner (the token's Pipedrive user) — resolved once and cached
let _ownerId
async function ownerId() {
  if (_ownerId !== undefined) return _ownerId
  const env = process.env.PIPEDRIVE_OWNER_USER_ID
  if (env && /^\d+$/.test(env)) { _ownerId = Number(env); return _ownerId }
  try { _ownerId = (await pd('/users/me')).data?.id ?? null } catch { _ownerId = null }
  return _ownerId
}

// get-or-create the "sourcing-console" label option on a field set, cached
const _labelCache = {}
async function labelId(fieldset, create) {
  if (_labelCache[fieldset] !== undefined) return _labelCache[fieldset]
  try {
    const field = ((await pd(`/${fieldset}`)).data || []).find((f) => f.key === 'label')
    if (!field) { _labelCache[fieldset] = null; return null }
    const opts = field.options || []
    const hit = opts.find((o) => (o.label || '').toLowerCase() === LABEL)
    if (hit) { _labelCache[fieldset] = hit.id; return hit.id }
    if (!create) return null
    const next = opts.map((o) => ({ id: o.id, label: o.label })).concat([{ label: LABEL }])
    await pd(`/${fieldset}/${field.id}`, { method: 'PUT', body: { options: next } })
    const field2 = ((await pd(`/${fieldset}`)).data || []).find((f) => f.key === 'label')
    _labelCache[fieldset] = (field2?.options || []).find((o) => (o.label || '').toLowerCase() === LABEL)?.id ?? null
  } catch { _labelCache[fieldset] = null }
  return _labelCache[fieldset]
}

async function searchPersonId({ email, phone }) {
  const tryTerm = async (term, field) => {
    if (!term) return null
    const q = new URLSearchParams({ term, fields: field, exact_match: field === 'email' ? 'true' : 'false', limit: '1' })
    try { return (await pd(`/persons/search?${q}`)).data?.items?.[0]?.item?.id || null }
    catch { return null }
  }
  return (await tryTerm(email, 'email')) || (await tryTerm(phone, 'phone'))
}

async function searchDealIdByTitle(title) {
  if (!title) return null
  const q = new URLSearchParams({ term: title, fields: 'title', limit: '5' })
  try {
    const items = (await pd(`/deals/search?${q}`)).data?.items || []
    return items.find((it) => (it.item?.title || '').trim().toLowerCase() === title.trim().toLowerCase())?.item?.id || null
  } catch { return null }
}

async function addNote(content, link) {
  if (!content) return
  try { await pd('/notes', { method: 'POST', body: { content, ...link } }) }
  catch (e) { console.error('[pd note]', e.message) }
}

function personPayload({ name, cell, phone, email, ownerId: oid }) {
  const phones = []
  if (cell) phones.push({ value: cell, primary: true, label: 'mobile' })
  if (phone && digits(phone) !== digits(cell)) phones.push({ value: phone, primary: !cell, label: 'work' })
  const p = { name: name || 'Contact' }
  if (oid) p.owner_id = oid
  if (phones.length) p.phone = phones
  if (email) p.email = [{ value: email, primary: true, label: 'work' }]
  return p
}

// upsert a person → { personId, url, status: 'created'|'exists'|'dry_run' }
async function upsertPerson({ name, cell, phone, email, note, dryRun }) {
  const existing = await searchPersonId({ email, phone: cell || phone })
  if (existing) return { personId: existing, url: personUrl(existing), status: 'exists' }
  const oid = await ownerId()
  const payload = personPayload({ name, cell, phone, email, ownerId: oid })
  if (dryRun) return { status: 'dry_run', would_create: payload, note }
  const lid = await labelId('personFields', true); if (lid) payload.label = lid
  const created = await pd('/persons', { method: 'POST', body: payload })
  const id = created.data.id
  await addNote(note, { person_id: id })
  return { personId: id, url: personUrl(id), status: 'created' }
}

// ── broker sync ─────────────────────────────────────────────────────────────
function brokerNote(b) {
  const bits = ['<b>Broker synced from the SimiCapital sourcing console</b>']
  if (b.firm) bits.push(`Firm: ${htmlEscape(b.firm)}`)
  if (b.mkts) bits.push(`Markets: ${htmlEscape(b.mkts)}`)
  if (b.spec) bits.push(`Specialty: ${htmlEscape(b.spec)}`)
  if (b.listings) bits.push(`Listings on file: ${htmlEscape(String(b.listings))}`)
  if (b.source) bits.push(`Source: ${htmlEscape(b.source)}`)
  return bits.join('<br>')
}
export async function syncBroker(b = {}, { dryRun = false } = {}) {
  return upsertPerson({ name: b.name, cell: b.cell, phone: b.phone, email: b.email, note: brokerNote(b), dryRun })
}

// ── push a property lead (off-market owner) / deal (on-market listing) ────────
const dealTitle = (p) => `${p.addr}${p.mkt ? ` · ${p.mkt}` : ''}${p.st ? `, ${p.st}` : ''}`.slice(0, 250)

function leadNote(p) {
  const onMkt = p.channel === 'on'
  const bits = [`<b>${onMkt ? 'On-market listing' : 'Off-market lead'} · SimiCapital sourcing console</b>`]
  if (p.addr) bits.push(`Address: ${htmlEscape(p.addr)}${p.mkt ? `, ${htmlEscape(p.mkt)}` : ''}${p.st ? ` ${htmlEscape(p.st)}` : ''}`)
  if (p.apn) bits.push(`APN: ${htmlEscape(p.apn)}`)
  const sf = p.sfTotal || p.sf
  if (sf) bits.push(`Building SF: ${htmlEscape(String(sf))}`)
  if (p.year) bits.push(`Year built: ${htmlEscape(String(p.year))}`)
  if (p.clear != null) bits.push(`Clear height: ${htmlEscape(String(p.clear))} ft`)
  if (p.cat || p.score != null) bits.push(`Score: ${htmlEscape(`${p.cat || ''} ${p.score != null ? p.score : ''}`.trim())}`)
  if (onMkt) {
    if (p.broker) bits.push(`Broker: ${htmlEscape(p.broker)}${p.firm ? ` · ${htmlEscape(p.firm)}` : ''}`)
    if (p.ask) bits.push(`Ask: $${htmlEscape(String(p.ask))}/SF`)
    if (p.daysOn != null) bits.push(`Days on market: ${htmlEscape(String(p.daysOn))}`)
  } else {
    if (p.owner) bits.push(`Owner on title: ${htmlEscape(p.owner)}${p.ownerType ? ` (${htmlEscape(p.ownerType)})` : ''}`)
    if (p.mail) bits.push(`Mailing: ${htmlEscape(p.mail)}`)
    if (p.oos) bits.push(`Out-of-state owner: ${htmlEscape(p.oos)}`)
  }
  if (p.signal) bits.push(`Signal: ${htmlEscape(p.signal)}`)
  return bits.join('<br>')
}

export async function pushLead(p = {}, { dryRun = false } = {}) {
  const onMkt = p.channel === 'on'
  const contactPhone = Array.isArray(p.phones) ? p.phones[0] : p.phone
  const contactEmail = Array.isArray(p.emails) ? p.emails[0] : p.email
  const contactName = onMkt ? (p.broker || 'Listing broker') : (p.person || null)
  // Only make a Person when we have something to reach them by (name/phone/email).
  let person = null
  if (contactName || contactPhone || contactEmail) {
    person = await upsertPerson({
      name: contactName || (onMkt ? 'Listing broker' : (p.owner || 'Property owner')),
      phone: contactPhone, email: contactEmail, note: leadNote(p), dryRun,
    })
  }
  const title = dealTitle(p)
  const existing = await searchDealIdByTitle(title)
  if (existing) return { dealId: existing, url: dealUrl(existing), status: 'exists', personId: person?.personId }
  const oid = await ownerId()
  const payload = { title, stage_id: SOURCING_STAGE_ID, status: 'open' }
  if (oid) payload.user_id = oid
  if (person?.personId) payload.person_id = person.personId
  if (dryRun) return { status: 'dry_run', would_create: payload, note: leadNote(p), person }
  const lid = await labelId('dealFields', true); if (lid) payload.label = lid
  const created = await pd('/deals', { method: 'POST', body: payload })
  const id = created.data.id
  await addNote(leadNote(p), { deal_id: id })
  return { dealId: id, url: dealUrl(id), status: 'created', personId: person?.personId }
}

// status for the UI: configured? owner? where do leads land?
export async function pdStatusInfo() {
  if (!pdConfigured()) return { configured: false }
  try {
    const me = (await pd('/users/me')).data || {}
    let stageName = ''
    try { stageName = (((await pd('/stages')).data || []).find((s) => s.id === SOURCING_STAGE_ID))?.name?.trim() || '' }
    catch { /* stage name is cosmetic */ }
    return { configured: true, owner: { id: me.id, name: me.name }, stageId: SOURCING_STAGE_ID, stageName }
  } catch (e) {
    return { configured: true, error: e.message }
  }
}
