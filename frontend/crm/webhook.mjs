// crm/webhook.mjs — the no-API fallback: POST the canonical record to a webhook.
//
// For CRMs without a usable API (REsimpli, REIPro, …) or any tenant who'd rather
// route through Zapier / Make / a Google-Sheet endpoint. We just fire the
// canonical JSON at their URL; the receiving automation does the CRM write and
// owns dedup — so idempotency here is best-effort (we report 'sent', not
// 'created'/'exists'). dryRun returns the exact payload without sending.
import { CrmAdapter, brokerLines, leadLines, leadContact, dealTitle } from './base.mjs'

export class WebhookAdapter extends CrmAdapter {
  constructor({ url } = {}) { super(); this.url = url || null }
  configured() { return Boolean(this.url) }
  async status() { return { configured: this.configured(), where: 'webhook', dedup: 'downstream' } }

  async #send(payload, dryRun) {
    if (dryRun) return { status: 'dry_run', would_send: payload }
    if (!this.url) throw new Error('webhook URL not configured')
    const r = await fetch(this.url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (!r.ok) throw new Error(`webhook → ${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`)
    return { status: 'sent' }
  }

  syncBroker(b = {}, { dryRun } = {}) {
    return this.#send({ type: 'broker', broker: b, note: brokerLines(b).join('\n'), source: 'simicapital-sourcing-console' }, dryRun)
  }
  pushLead(p = {}, { dryRun } = {}) {
    return this.#send({
      type: 'lead', title: dealTitle(p), contact: leadContact(p), property: p,
      note: leadLines(p).join('\n'), source: 'simicapital-sourcing-console',
    }, dryRun)
  }
}
