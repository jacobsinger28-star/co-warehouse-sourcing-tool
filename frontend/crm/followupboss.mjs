// crm/followupboss.mjs — Follow Up Boss as a CrmAdapter (static API key).
//
// FUB is a lead-centric CRM: we upsert a Person (idempotent get→create by email,
// then phone) and attach the lead/broker facts as a Note. FUB "deals" require
// per-account pipeline setup, so v1 records the lead on the person's timeline as a
// note — safe on any account. Auth is HTTP Basic with the API key as the username
// and a blank password.
//
// NOTE: coded defensively against the documented FUB v1 shapes
// (https://docs.followupboss.com). VERIFY the person/note field paths on the first
// live call and tighten — same convention as pipedrive.mjs / phoneburner.mjs.
import { CrmAdapter, splitName, brokerLines, leadLines, leadContact, digits } from './base.mjs'

const API = 'https://api.followupboss.com/v1'

export class FollowUpBossAdapter extends CrmAdapter {
  constructor({ api_key } = {}) { super(); this.key = api_key || null }
  configured() { return Boolean(this.key) }

  async #fetch(path, { method = 'GET', body } = {}) {
    if (!this.key) throw new Error('Follow Up Boss API key not configured')
    const auth = Buffer.from(`${this.key}:`).toString('base64')
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`followupboss ${method} ${path.split('?')[0]} → ${r.status} ${String(j.errorMessage || j.error || '').slice(0, 160)}`)
    return j
  }

  async status() {
    if (!this.key) return { configured: false }
    try { const me = await this.#fetch('/identity'); return { configured: true, owner: { name: me?.name || me?.account || 'Follow Up Boss' } } }
    catch (e) { return { configured: true, error: e.message } }
  }

  // Person lookup by email (exact), then by phone. Returns an id or null.
  async #findPerson({ email, phone }) {
    const find = async (q) => {
      try { return (await this.#fetch(`/people?${q}&limit=1`))?.people?.[0]?.id || null }
      catch { return null }
    }
    return (email && await find(`email=${encodeURIComponent(email)}`))
      || (phone && await find(`phone=${encodeURIComponent(digits(phone))}`))
      || null
  }

  async #upsertPerson({ name, email, phone, cell }) {
    const primaryPhone = cell || phone
    const existing = await this.#findPerson({ email, phone: primaryPhone })
    if (existing) return { id: existing, status: 'exists' }
    const { firstName, lastName } = splitName(name)
    const body = {
      firstName, lastName, source: 'SimiCapital Sourcing Console', tags: ['sourcing-console'],
      ...(email ? { emails: [{ value: email }] } : {}),
      ...(primaryPhone ? { phones: [{ value: primaryPhone }] } : {}),
    }
    const created = await this.#fetch('/people', { method: 'POST', body })
    return { id: created?.id ?? created?.person?.id ?? null, status: 'created' }
  }

  async #note(personId, body) {
    if (!personId || !body) return
    try { await this.#fetch('/notes', { method: 'POST', body: { personId, subject: 'SimiCapital sourcing console', body } }) }
    catch (e) { console.error('[fub note]', e.message) }
  }

  async syncBroker(b = {}, { dryRun } = {}) {
    if (dryRun) return { status: 'dry_run', would_create: { ...splitName(b.name), email: b.email, phone: b.cell || b.phone }, note: brokerLines(b).join('\n') }
    const person = await this.#upsertPerson({ name: b.name, email: b.email, phone: b.phone, cell: b.cell })
    await this.#note(person.id, brokerLines(b).join('\n'))
    return { id: person.id, status: person.status }
  }

  async pushLead(p = {}, { dryRun } = {}) {
    const c = leadContact(p)
    if (dryRun) return { status: 'dry_run', would_create: { ...splitName(c.name), email: c.email, phone: c.phone }, note: leadLines(p).join('\n') }
    let personId = null
    if (c.name || c.email || c.phone) personId = (await this.#upsertPerson({ name: c.name, email: c.email, phone: c.phone })).id
    await this.#note(personId, leadLines(p).join('\n'))
    return { status: personId ? 'created' : 'sent', personId }
  }
}
