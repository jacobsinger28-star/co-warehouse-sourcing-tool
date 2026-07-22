// crm/registry.mjs — provider key → CRM adapter, and per-tenant CRM resolution.
//
// This is the seam that makes the console CRM-agnostic: the server asks the
// registry "which CRM does this workspace run on?" and gets back one adapter bound
// to that tenant's own credentials. Adding a CRM = one adapter file + one row here.
import { PipedriveAdapter } from './pipedrive.mjs'
import { FollowUpBossAdapter } from './followupboss.mjs'
import { GoHighLevelAdapter } from './gohighlevel.mjs'
import { WebhookAdapter } from './webhook.mjs'

// Each row: the tenant_secrets fields the adapter needs + a factory from a creds
// map. Array ORDER is the resolution priority when a tenant configured more than
// one CRM (first configured wins).
export const CRM_REGISTRY = [
  { provider: 'crm.pipedrive',    fields: ['api_token'], make: (c) => new PipedriveAdapter({ token: c.api_token }) },
  { provider: 'crm.followupboss', fields: ['api_key'],   make: (c) => new FollowUpBossAdapter({ api_key: c.api_key }) },
  { provider: 'crm.gohighlevel',  fields: ['api_key'],   make: (c) => new GoHighLevelAdapter({ api_key: c.api_key }) },
  { provider: 'crm.webhook',      fields: ['url'],       make: (c) => new WebhookAdapter({ url: c.url }) },
]

export const CRM_PROVIDERS = CRM_REGISTRY.map((e) => e.provider)
const byProvider = new Map(CRM_REGISTRY.map((e) => [e.provider, e]))

/** Build one adapter for `provider` from a creds map ({field: value}); null if unknown. */
export function crmFor(provider, creds = {}) {
  const e = byProvider.get(provider)
  return e ? e.make(creds) : null
}

/** The legacy/default workspace's CRM: Pipedrive on the process env token (no
 *  `token` key → pipedrive.mjs uses its env fallback, unchanged behavior). */
export const legacyCrm = () => ({ provider: 'crm.pipedrive', adapter: new PipedriveAdapter({}) })

/**
 * Resolve the CRM a REAL tenant runs on: the first configured CRM in registry
 * order. Reads each candidate's fields from the tenant's SecretResolver — which
 * only ever returns that tenant's own stored secrets, never the platform env — so
 * a provider counts only when ALL its required fields resolve. Returns
 * { provider, adapter } or null (no CRM connected → the caller 503s, never env).
 */
export async function resolveTenantCrm(resolver) {
  for (const e of CRM_REGISTRY) {
    const vals = {}
    let ok = true
    for (const f of e.fields) {
      const v = await resolver.get(e.provider, f)
      if (!v) { ok = false; break }
      vals[f] = v
    }
    if (ok) return { provider: e.provider, adapter: e.make(vals) }
  }
  return null
}
