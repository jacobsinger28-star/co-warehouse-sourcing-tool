// crm/base.mjs — the canonical CRM adapter contract + CRM-agnostic formatting.
//
// Phase 3 (pluggable CRM). Every adapter is constructed with ONE tenant's
// resolved credentials and exposes the same small set of operations the sourcing
// console calls; the registry (crm/registry.mjs) decides which adapter a tenant
// runs on. Keeping the contract tiny — a contact upsert, a lead push, a status
// read — is deliberate: it's the intersection every target CRM supports, so a new
// CRM is a self-contained file, not a change to the console.
//
// Isolation rule (same as the rest of BYOK): an adapter only ever touches the
// account its creds belong to. The server resolves creds per req.tenant; a real
// tenant with no CRM configured must be caught by the caller, never fall back to
// the platform env credentials.

export const digits = (s) => String(s || '').replace(/\D/g, '')
export const htmlEscape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Split a single "First Last" into { firstName, lastName } for CRMs that want them split. */
export function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Canonical provenance/fact lines (plain "Label: value"), shared so every CRM
// records the SAME note content. Pipedrive renders these as HTML; others plain.
export function brokerLines(b = {}) {
  const out = ['Broker synced from the SimiCapital sourcing console']
  if (b.firm) out.push(`Firm: ${b.firm}`)
  if (b.mkts) out.push(`Markets: ${b.mkts}`)
  if (b.spec) out.push(`Specialty: ${b.spec}`)
  if (b.listings) out.push(`Listings on file: ${b.listings}`)
  if (b.source) out.push(`Source: ${b.source}`)
  return out
}
export function leadLines(p = {}) {
  const onMkt = p.channel === 'on'
  const out = [`${onMkt ? 'On-market listing' : 'Off-market lead'} · SimiCapital sourcing console`]
  if (p.addr) out.push(`Address: ${p.addr}${p.mkt ? `, ${p.mkt}` : ''}${p.st ? ` ${p.st}` : ''}`)
  if (p.apn) out.push(`APN: ${p.apn}`)
  const sf = p.sfTotal || p.sf
  if (sf) out.push(`Building SF: ${sf}`)
  if (p.year) out.push(`Year built: ${p.year}`)
  if (p.clear != null) out.push(`Clear height: ${p.clear} ft`)
  if (p.cat || p.score != null) out.push(`Score: ${`${p.cat || ''} ${p.score != null ? p.score : ''}`.trim()}`)
  if (onMkt) {
    if (p.broker) out.push(`Broker: ${p.broker}${p.firm ? ` · ${p.firm}` : ''}`)
    if (p.ask) out.push(`Ask: $${p.ask}/SF`)
    if (p.daysOn != null) out.push(`Days on market: ${p.daysOn}`)
  } else {
    if (p.owner) out.push(`Owner on title: ${p.owner}${p.ownerType ? ` (${p.ownerType})` : ''}`)
    if (p.mail) out.push(`Mailing: ${p.mail}`)
    if (p.oos) out.push(`Out-of-state owner: ${p.oos}`)
  }
  if (p.signal) out.push(`Signal: ${p.signal}`)
  return out
}
/** A CRM-agnostic dedupe key for a lead: the deal/opportunity title. */
export const dealTitle = (p = {}) => `${p.addr || ''}${p.mkt ? ` · ${p.mkt}` : ''}${p.st ? `, ${p.st}` : ''}`.slice(0, 250)

/** The contact we can reach a lead by (broker on-market, else the owner/person). */
export function leadContact(p = {}) {
  const onMkt = p.channel === 'on'
  return {
    name: onMkt ? (p.broker || 'Listing broker') : (p.person || p.owner || 'Property owner'),
    phone: Array.isArray(p.phones) ? p.phones[0] : p.phone,
    email: Array.isArray(p.emails) ? p.emails[0] : p.email,
  }
}

/**
 * The contract every CRM adapter fulfils. The console only ever calls these.
 *   configured()               -> boolean: does it hold the creds to run?
 *   status()                   -> { configured, ... } for the Settings UI
 *   syncBroker(broker, {dryRun})-> { status:'created'|'exists'|'sent'|'dry_run', id?, url? }
 *   pushLead(property, {dryRun})-> { status, dealId?, url?, personId? }
 */
export class CrmAdapter {
  configured() { return false }
  async status() { return { configured: this.configured() } }
  async syncBroker() { throw new Error('syncBroker not implemented for this CRM') }
  async pushLead() { throw new Error('pushLead not implemented for this CRM') }
}
