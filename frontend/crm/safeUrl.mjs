// crm/safeUrl.mjs — SSRF guard for tenant-supplied outbound URLs (webhook CRM).
//
// A tenant can store an arbitrary "webhook / Zapier" URL that the SERVER then
// POSTs owner-PII to. Without this guard that is a server-side request forgery
// hole: the URL could point at cloud metadata (169.254.169.254), localhost, the
// internal scrape sidecar, or any RFC-1918 host. This module forces https, blocks
// private/loopback/link-local/CGNAT/metadata ranges (checking the RESOLVED IPs,
// not just the hostname), disables redirects, and applies a timeout. Callers must
// also never echo the upstream response body back to the client.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** True if an IPv4/IPv6 literal is in a private/loopback/link-local/reserved range. */
export function isBlockedIp(ip) {
  const fam = isIP(ip)
  if (!fam) return true // not a parseable IP → refuse (fail closed)
  if (fam === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||                          // 0.0.0.0/8
      a === 10 ||                         // 10/8 private
      a === 127 ||                        // loopback
      (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
      (a === 169 && b === 254) ||         // link-local incl. 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||// 172.16/12 private
      (a === 192 && b === 168) ||         // 192.168/16 private
      (a === 192 && b === 0) ||           // 192.0.0/24 IETF
      (a === 198 && (b === 18 || b === 19)) || // 198.18/15 benchmark
      a >= 224                            // 224/4 multicast + 240/4 reserved + 255.255.255.255
    )
  }
  // IPv6
  const s = ip.toLowerCase()
  if (s === '::1' || s === '::') return true                     // loopback / unspecified
  if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true // fe80::/10 link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true      // fc00::/7 unique-local
  if (s.startsWith('ff')) return true                            // ff00::/8 multicast
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)             // v4-mapped → check the v4
  if (m) return isBlockedIp(m[1])
  return false
}

/**
 * Validate a tenant-supplied URL for an outbound server fetch. Requires https,
 * and rejects when the host resolves to any blocked address (guards the metadata/
 * localhost/RFC-1918 SSRF vectors; DNS-rebinding between this check and the fetch
 * is a residual risk mitigated by redirect:'manual' + the short timeout below).
 * Returns the URL string; throws a generic Error (never echoing internal detail).
 */
export async function assertPublicHttpsUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { throw new Error('webhook URL is not a valid URL') }
  if (u.protocol !== 'https:') throw new Error('webhook URL must use https://')
  let addrs
  try { addrs = await lookup(u.hostname, { all: true }) } catch { throw new Error('webhook URL host does not resolve') }
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address)))
    throw new Error('webhook URL resolves to a disallowed (internal) address')
  return u.toString()
}

/** POST JSON to a validated tenant URL: https-only, no redirects, timed out. */
export async function safePostJson(rawUrl, payload, { timeoutMs = 12_000 } = {}) {
  const url = await assertPublicHttpsUrl(rawUrl)
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })
}
