// tenants.mjs — resolve an authenticated email to the tenant it belongs to.
//
// This is the seam that turns "one global allowlist" into "many tenants". The
// server calls resolveTenant(email) after it has verified the Supabase JWT; the
// returned tenant is attached to req.tenant and threaded to every provider so a
// request only ever touches its own tenant's data and keys.
//
// Back-compat: when tenancy is not configured (no service-role key), resolveTenant
// falls back to the caller's legacy allowlist check and returns the DEFAULT_TENANT,
// so the app behaves exactly as it did before this file existed. The DEFAULT_TENANT
// also represents "use the process-level env-var providers" for the later BYOK
// phases — i.e. SimiCapital running on its original keys.
import { tenancyEnabled, dbSelect } from './db.mjs'

/** The single implicit tenant of the pre-multi-tenant app (legacy env-var keys). */
export const DEFAULT_TENANT = Object.freeze({
  id: 'default', slug: 'simicapital', name: 'SimiCapital', role: 'owner', source: 'legacy',
})

const domainOf = (email) => '@' + email.slice(email.lastIndexOf('@') + 1)

/** Choose the tenant for `email` from membership rows (exact match beats a
 * whole-domain '@company.com' match). Pure — no I/O — so it's unit-testable.
 * `rows` come from PostgREST with the tenant embedded: {email, role, tenants:{...}}. */
export function _pickTenant(rows, email) {
  if (!Array.isArray(rows) || !rows.length) return null
  const domain = domainOf(email)
  const hit = rows.find((r) => r.email === email) || rows.find((r) => r.email === domain)
  if (!hit) return null
  const t = hit.tenants || {}
  if (!t.id) return null
  if (t.status && t.status !== 'active') return null // suspended tenant → no entry
  return { id: t.id, slug: t.slug, name: t.name, role: hit.role || 'member', source: 'db' }
}

// email -> { tenant, exp }; mirrors the token cache's short TTL in server.mjs.
const cache = new Map()
const TTL_MS = 5 * 60_000
/** Test hook: drop the resolution cache. */
export const _clearCache = () => cache.clear()

/**
 * Resolve `email` to its tenant, or null if it belongs to none (→ caller 401s).
 * @param {string} email  the verified login email
 * @param {{legacyAllowed?: (email:string)=>boolean}} opts
 *        legacyAllowed: the server's existing allowlist check, used only when
 *        tenancy is off (pre-migration) to preserve today's behavior.
 */
export async function resolveTenant(email, { legacyAllowed } = {}) {
  email = (email || '').toLowerCase()
  if (!email) return null

  if (!tenancyEnabled()) {
    return legacyAllowed && legacyAllowed(email) ? { ...DEFAULT_TENANT } : null
  }

  const cached = cache.get(email)
  if (cached && cached.exp > Date.now()) return cached.tenant

  const enc = encodeURIComponent
  const q = `select=email,role,tenants(id,slug,name,status)`
    + `&or=(email.eq.${enc(email)},email.eq.${enc(domainOf(email))})`
  let tenant = null
  try {
    tenant = _pickTenant(await dbSelect('tenant_members', q), email)
  } catch (e) {
    console.error('[tenant] lookup failed', e.message) // fail closed: no tenant → 401
    return null
  }
  if (cache.size > 2000) cache.clear() // crude bound, entries are tiny
  cache.set(email, { tenant, exp: Date.now() + TTL_MS })
  return tenant
}
