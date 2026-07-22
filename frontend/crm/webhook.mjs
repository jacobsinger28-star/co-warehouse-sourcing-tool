// crm/webhook.mjs — the no-API fallback: POST the canonical record to a webhook.
//
// For CRMs without a usable API (REsimpli, REIPro, …) or any tenant who'd rather
// route through Zapier / Make / a Google-Sheet endpoint. We fire canonical JSON at
// their URL; the receiving automation does the CRM write and owns dedup — so
// idempotency here is best-effort (we report 'sent'). dryRun returns the payload
// without sending.
//
// SECURITY: the URL is tenant-supplied, so #send goes through safePostJson, which
// forces https, blocks internal/metadata/RFC-1918 hosts, disables redirects, and
// times out (SSRF guard). We send a WHITELISTED field set (the same facts the CRM
// note exposes) — never the raw property object with its internal scoring/model
// fields — and never echo the upstream response body back to the caller.
import { CrmAdapter, brokerLines, leadLines, leadContact, dealTitle } from './base.mjs'
import { safePostJson } from './safeUrl.mjs'

const LEAD_FIELDS = ['addr', 'mkt', 'st', 'apn', 'sf', 'sfTotal', 'year', 'clear', 'cat', 'score', 'channel', 'broker', 'firm', 'ask', 'daysOn', 'owner', 'ownerType', 'mail', 'oos', 'signal']
const BROKER_FIELDS = ['name', 'firm', 'mkts', 'spec', 'listings', 'source', 'email', 'phone', 'cell']
const pick = (o = {}, keys) => { const out = {}; for (const k of keys) if (o[k] != null) out[k] = o[k]; return out }

export class WebhookAdapter extends CrmAdapter {
  constructor({ url } = {}) { super(); this.url = url || null }
  configured() { return Boolean(this.url) }
  async status() { return { configured: this.configured(), where: 'webhook', dedup: 'downstream' } }

  async #send(payload, dryRun) {
    if (dryRun) return { status: 'dry_run', would_send: payload }
    if (!this.url) throw new Error('webhook URL not configured')
    const r = await safePostJson(this.url, payload)
    if (!r.ok) throw new Error(`webhook endpoint returned ${r.status}`) // never echo the upstream body
    return { status: 'sent' }
  }

  syncBroker(b = {}, { dryRun } = {}) {
    return this.#send({ type: 'broker', broker: pick(b, BROKER_FIELDS), note: brokerLines(b).join('\n'), source: 'simicapital-sourcing-console' }, dryRun)
  }
  pushLead(p = {}, { dryRun } = {}) {
    return this.#send({
      type: 'lead', title: dealTitle(p), contact: leadContact(p), property: pick(p, LEAD_FIELDS),
      note: leadLines(p).join('\n'), source: 'simicapital-sourcing-console',
    }, dryRun)
  }
}
