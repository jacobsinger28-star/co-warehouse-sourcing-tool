// crm/gohighlevel.mjs — GoHighLevel as a CrmAdapter (v1 location API key).
//
// GHL is agency/location scoped: a v1 API key is bound to one location, so no
// location id is needed for v1. We upsert a Contact (GHL dedupes by email within
// the location) and attach the lead/broker facts as a Contact note. Opportunities
// need a pipeline id per account, so v1 records the lead as a note — safe anywhere.
// Auth is a Bearer token (the v1 API key).
//
// NOTE: coded defensively against the documented GHL v1 shapes
// (https://public-api.gohighlevel.com / rest.gohighlevel.com/v1). VERIFY the
// contact/note field paths on the first live call and tighten — same convention
// as pipedrive.mjs / phoneburner.mjs.
import { CrmAdapter, splitName, brokerLines, leadLines, leadContact } from './base.mjs'

const API = 'https://rest.gohighlevel.com/v1'

export class GoHighLevelAdapter extends CrmAdapter {
  constructor({ api_key } = {}) { super(); this.key = api_key || null }
  configured() { return Boolean(this.key) }

  async #fetch(path, { method = 'GET', body } = {}) {
    if (!this.key) throw new Error('GoHighLevel API key not configured')
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.key}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`gohighlevel ${method} ${path.split('?')[0]} → ${r.status} ${String(j.msg || j.message || j.error || '').slice(0, 160)}`)
    return j
  }

  async status() {
    if (!this.key) return { configured: false }
    // v1 has no cheap identity endpoint; a contacts list with limit=1 proves the key.
    try { await this.#fetch('/contacts/?limit=1'); return { configured: true, owner: { name: 'GoHighLevel location' } } }
    catch (e) { return { configured: true, error: e.message } }
  }

  // GHL upsert: POST /contacts/ merges by email within the location and returns
  // the (created or existing) contact, so it is idempotent on email.
  async #upsertContact({ name, email, phone, cell }) {
    const { firstName, lastName } = splitName(name)
    const body = {
      firstName, lastName, source: 'SimiCapital Sourcing Console', tags: ['sourcing-console'],
      ...(email ? { email } : {}), ...(cell || phone ? { phone: cell || phone } : {}),
    }
    const res = await this.#fetch('/contacts/', { method: 'POST', body })
    const c = res?.contact || res
    return { id: c?.id ?? null, status: res?.new === false ? 'exists' : 'created' }
  }

  async #note(contactId, body) {
    if (!contactId || !body) return
    try { await this.#fetch(`/contacts/${contactId}/notes/`, { method: 'POST', body: { body } }) }
    catch (e) { console.error('[ghl note]', e.message) }
  }

  async syncBroker(b = {}, { dryRun } = {}) {
    if (dryRun) return { status: 'dry_run', would_create: { ...splitName(b.name), email: b.email, phone: b.cell || b.phone }, note: brokerLines(b).join('\n') }
    const c = await this.#upsertContact({ name: b.name, email: b.email, phone: b.phone, cell: b.cell })
    await this.#note(c.id, brokerLines(b).join('\n'))
    return { id: c.id, status: c.status }
  }

  async pushLead(p = {}, { dryRun } = {}) {
    const ct = leadContact(p)
    if (dryRun) return { status: 'dry_run', would_create: { ...splitName(ct.name), email: ct.email, phone: ct.phone }, note: leadLines(p).join('\n') }
    let contactId = null
    if (ct.name || ct.email || ct.phone) contactId = (await this.#upsertContact({ name: ct.name, email: ct.email, phone: ct.phone })).id
    await this.#note(contactId, leadLines(p).join('\n'))
    return { status: contactId ? 'created' : 'sent', personId: contactId }
  }
}
