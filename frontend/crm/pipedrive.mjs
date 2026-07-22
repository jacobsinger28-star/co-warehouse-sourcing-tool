// crm/pipedrive.mjs — Pipedrive as a CrmAdapter.
//
// Delegates to the proven root pipedrive.mjs writer (unchanged), so dedup +
// behavior are byte-identical to before Phase 3; this class only adapts it to the
// registry's contract. Credential rule preserved exactly: a `token` key present
// (even null) is used strictly (a real tenant with no token never borrows the env
// token); no `token` key at all → the legacy env fallback.
import { CrmAdapter } from './base.mjs'
import { pdConfigured, pdStatusInfo, syncBroker, pushLead } from '../pipedrive.mjs'

export class PipedriveAdapter extends CrmAdapter {
  constructor(creds = {}) {
    super()
    // Keep the exact opts semantics pipedrive.mjs expects: pass {token} through
    // (even null) for a real tenant; {} for legacy so it uses the env token.
    this.opts = ('token' in creds) ? { token: creds.token } : {}
  }
  configured() { return pdConfigured(this.opts) }
  status() { return pdStatusInfo(this.opts) }
  syncBroker(b, { dryRun } = {}) { return syncBroker(b, { ...this.opts, dryRun }) }
  pushLead(p, { dryRun } = {}) { return pushLead(p, { ...this.opts, dryRun }) }
}
