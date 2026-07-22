// secrets.mjs — the BYOK secret layer. The ONLY place provider credentials are
// decrypted. Never-leak rules live here: envelope encryption at rest, write-only
// (values never round-trip to the browser), dry-run masking, and log redaction.
//
// Envelope crypto (AES-256-GCM via node:crypto — no new dependency):
//   KEK  — 32-byte master key, base64 in Railway env SECRETS_KEK. Never in the DB.
//   DEK  — 32-byte per-tenant key, random, stored WRAPPED by the KEK on tenants.dek_wrapped.
//   each secret field — encrypted with its tenant's DEK, stored base64 in tenant_secrets.
// A Postgres dump is inert without the KEK. Offboard a tenant by dropping its DEK.
//
//   Generate a KEK:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Tenant isolation: the env-var fallback (today's single-tenant keys) applies ONLY
// to the legacy/default tenant. A real DB tenant with no key configured resolves to
// null (stub-safe) — it must NEVER fall back to another tenant's env credentials.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { tenancyEnabled, dbSelect, dbUpsert, dbPatch } from './db.mjs'

const IVLEN = 12, TAGLEN = 16
const enc = encodeURIComponent

// ── AES-256-GCM seal/open (buffer in, base64 iv|ct|tag out — and back) ─────────
function seal(key, buf) {
  const iv = randomBytes(IVLEN)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(buf), c.final()])
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64')
}
function open(key, b64) {
  const raw = Buffer.from(b64, 'base64')
  const iv = raw.subarray(0, IVLEN)
  const tag = raw.subarray(raw.length - TAGLEN)
  const ct = raw.subarray(IVLEN, raw.length - TAGLEN)
  const d = createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}

/** The master key, or null if unset. Read live so tests/rotation see the current value. */
function loadKek() {
  const b64 = process.env.SECRETS_KEK || ''
  if (!b64) return null
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('SECRETS_KEK must be base64 of exactly 32 bytes')
  return k
}
/** BYOK is live only with both a KEK and DB access. Off → resolver uses env fallback / null. */
export const secretsEnabled = () => Boolean(process.env.SECRETS_KEK && tenancyEnabled())

// ── redaction (never-leak choke point: logs, errors, tracebacks) ──────────────
const liveSecrets = new Set()
/** Register a decrypted value so redact() can scrub it from any later log/error. */
export function registerSecret(v) { if (typeof v === 'string' && v.length >= 6) liveSecrets.add(v) }

/** Scrub known secret values + credential-shaped substrings from a string. */
export function redact(text) {
  let s = String(text)
  for (const secret of liveSecrets) if (secret) s = s.split(secret).join('***REDACTED***')
  s = s.replace(/api_token=[^&\s"')]+/gi, 'api_token=***REDACTED***')      // Pipedrive query-string leak
  s = s.replace(/(sk-ant-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]{6,}/g, '$1…REDACTED') // Anthropic keys
  s = s.replace(/(Bearer\s+[A-Za-z0-9._-]{6})[A-Za-z0-9._-]{6,}/gi, '$1…REDACTED')
  return s
}

/** Route console output through redact() once, at server boot. Strings and Error
 * stacks are scrubbed; other object args pass through (don't stringify blindly). */
export function installRedaction() {
  if (globalThis.__redactionInstalled) return
  const scrub = (a) => (typeof a === 'string' ? redact(a) : a instanceof Error ? redact(a.stack || a.message) : a)
  for (const m of ['log', 'info', 'warn', 'error']) {
    const orig = console[m].bind(console)
    console[m] = (...args) => orig(...args.map(scrub))
  }
  globalThis.__redactionInstalled = true
}

// ── env fallback: maps a provider/field to today's single-tenant env var ──────
// Used ONLY for the legacy/default tenant, so SimiCapital keeps running on its
// original keys until they are migrated into tenant_secrets.
const ENV_FALLBACK = {
  'crm.pipedrive': { api_token: 'PIPEDRIVE_API_TOKEN' },
  'dialer.phoneburner': {
    access_token: 'PHONEBURNER_ACCESS_TOKEN', client_id: 'PHONEBURNER_CLIENT_ID',
    client_secret: 'PHONEBURNER_CLIENT_SECRET', redirect_uri: 'PHONEBURNER_REDIRECT_URI',
  },
  'llm.anthropic': { api_key: 'ANTHROPIC_API_KEY' },
}
const envFallback = (provider, field) => {
  const name = ENV_FALLBACK[provider]?.[field]
  return name ? (process.env[name] || null) : null
}

// ── DEK cache: unwrap a tenant's DEK at most once per few minutes ─────────────
const dekCache = new Map() // tenantId -> { dek: Buffer, exp: number }
const DEK_TTL = 5 * 60_000

/** Test hook: forget cached DEKs and registered secrets. */
export function _resetForTest() { dekCache.clear(); liveSecrets.clear() }

async function dekFor(tenantId, { create = false } = {}) {
  const hit = dekCache.get(tenantId)
  if (hit && hit.exp > Date.now()) return hit.dek
  const kek = loadKek()
  if (!kek) return null
  const rows = await dbSelect('tenants', `select=dek_wrapped&id=eq.${enc(tenantId)}&limit=1`)
  if (!rows.length) throw new Error(`unknown tenant ${tenantId}`)
  let dek
  if (rows[0].dek_wrapped) {
    dek = open(kek, rows[0].dek_wrapped)
  } else if (create) {
    dek = randomBytes(32)
    await dbPatch('tenants', `id=eq.${enc(tenantId)}`, { dek_wrapped: seal(kek, dek), kek_version: 1 })
  } else {
    return null // tenant has stored no secrets yet
  }
  dekCache.set(tenantId, { dek, exp: Date.now() + DEK_TTL })
  return dek
}

/**
 * Resolve one tenant's provider credentials. Construct per request from req.tenant.
 * `dryRun` masks every value as '****' (and never decrypts) while still reporting
 * which providers are configured — safe for plan/preview output.
 */
export class SecretResolver {
  constructor(tenant, { dryRun = false } = {}) {
    this.tenant = tenant || null
    this.tenantId = tenant?.id || null
    // The legacy/default tenant (or no tenant at all) uses the env-var fallback.
    this.isLegacy = !tenant || tenant.source === 'legacy' || tenant.id === 'default'
    this.dryRun = dryRun
  }

  /** One field, or null if absent (caller takes its existing stub-safe branch). */
  async get(provider, field) {
    if (this.isLegacy) {
      const v = envFallback(provider, field)
      if (!v) return null
      registerSecret(v)
      return this.dryRun ? '****' : v
    }
    if (!secretsEnabled()) return null
    if (this.dryRun) {
      const rows = await dbSelect('tenant_secrets',
        `select=field&tenant_id=eq.${enc(this.tenantId)}&provider=eq.${enc(provider)}&field=eq.${enc(field)}&limit=1`)
      return rows.length ? '****' : null
    }
    const dek = await dekFor(this.tenantId)
    if (!dek) return null
    const rows = await dbSelect('tenant_secrets',
      `select=ciphertext&tenant_id=eq.${enc(this.tenantId)}&provider=eq.${enc(provider)}&field=eq.${enc(field)}&limit=1`)
    if (!rows.length) return null
    const plain = open(dek, rows[0].ciphertext).toString('utf8')
    registerSecret(plain)
    return plain
  }

  /** All fields for a provider as {field: value}, or null if none configured. */
  async getProvider(provider) {
    if (this.isLegacy) {
      const out = {}
      for (const f of Object.keys(ENV_FALLBACK[provider] || {})) {
        const v = envFallback(provider, f)
        if (v) { registerSecret(v); out[f] = this.dryRun ? '****' : v }
      }
      return Object.keys(out).length ? out : null
    }
    if (!secretsEnabled()) return null
    const rows = await dbSelect('tenant_secrets',
      `select=field,ciphertext&tenant_id=eq.${enc(this.tenantId)}&provider=eq.${enc(provider)}`)
    if (!rows.length) return null
    const dek = this.dryRun ? null : await dekFor(this.tenantId)
    if (!this.dryRun && !dek) return null
    const out = {}
    for (const r of rows) {
      if (this.dryRun) { out[r.field] = '****'; continue }
      const plain = open(dek, r.ciphertext).toString('utf8')
      registerSecret(plain)
      out[r.field] = plain
    }
    return out
  }

  /** Is at least one field configured for this provider? (No decryption.) */
  async configured(provider) {
    if (this.isLegacy) return Object.keys(ENV_FALLBACK[provider] || {}).some((f) => Boolean(envFallback(provider, f)))
    if (!tenancyEnabled()) return false
    const rows = await dbSelect('tenant_secrets',
      `select=field&tenant_id=eq.${enc(this.tenantId)}&provider=eq.${enc(provider)}&limit=1`)
    return rows.length > 0
  }
}

/**
 * Encrypt + store one secret field for a real tenant (used by the seed tool and the
 * Settings UI). Write-only: the plaintext is never read back to a caller. Creates the
 * tenant's DEK on first write. Refuses the legacy/default tenant (that one uses env).
 */
export async function writeSecret(tenantId, provider, field, value, { authModel = 'static', meta } = {}) {
  const kek = loadKek()
  if (!kek) throw new Error('SECRETS_KEK not set — cannot store secrets')
  if (!tenantId || tenantId === 'default') throw new Error('refusing to store secrets for the legacy/default tenant (it uses env vars)')
  const dek = await dekFor(tenantId, { create: true })
  const ciphertext = seal(dek, Buffer.from(String(value), 'utf8'))
  registerSecret(String(value))
  const row = { tenant_id: tenantId, provider, field, ciphertext, auth_model: authModel, rotated_at: new Date().toISOString() }
  if (meta) row.meta = meta
  await dbUpsert('tenant_secrets', row, { onConflict: 'tenant_id,provider,field' })
  return { ok: true }
}
