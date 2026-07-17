// Browser-side decryption for the real-data export. Matches the AES-256-GCM /
// PBKDF2-SHA256 scheme produced by tools/encrypt_data.mjs (and the offmarket
// lock_html.js it mirrors). Same primitives the off-market dashboards use.

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// Decrypt an {v,iter,salt,iv,ct} blob with the password; throws on wrong password
// (AES-GCM auth tag fails) — that failure IS the password check.
export async function decryptJson(password, enc) {
  const subtle = window.crypto?.subtle
  if (!subtle) throw new Error('No Web Crypto here — open over https in a modern browser.')
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const buf = await subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct))
  return JSON.parse(new TextDecoder().decode(buf))
}

// Load the real dataset. `cred` is {token} (Supabase JWT, verified server-side)
// or {password} (legacy shared password); a bare string is treated as a password
// for back-compat. Order of preference:
//   1. POST /api/data  — Railway server-side auth (data never a public file; the
//      JWT + allowlist or password is checked on the server). Secure production path.
//   2. data.enc.json   — encrypted static blob (Vercel static deploy), decrypted here.
//   3. data.real.json  — plaintext (local dev only).
// Returns the parsed dataset, or null (→ app uses synthetic sample data).
// In token mode a 401/403 THROWS (signed in but not allowed) so the Gate can say so.
export async function loadRealData(cred, baseUrl = '/') {
  const { password = '', token = '' } = typeof cred === 'string' ? { password: cred } : cred || {}
  // 1. server-side auth (Railway)
  try {
    const r = await fetch(`${baseUrl}api/data`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(password ? { password } : {}),
      cache: 'no-store',
    })
    if (r.ok) return await r.json()
    if (r.status === 401 || r.status === 403) {
      if (token) throw new Error('Signed in, but this account is not on the allowed list for this tool.')
      return null // server says wrong password — no static fallback
    }
  } catch (e) {
    if (token && /allowed list/.test(e?.message || '')) throw e
    /* no backend (static host) → try static blobs */
  }
  if (!password) return null // token mode has no decryption key — server path only
  // 2. encrypted static blob (Vercel)
  try {
    const r = await fetch(`${baseUrl}data.enc.json`, { cache: 'no-store' })
    if (r.ok) return await decryptJson(password, await r.json())
  } catch { /* fall through */ }
  // 3. plaintext (local dev)
  try {
    const r = await fetch(`${baseUrl}data.real.json`, { cache: 'no-store' })
    if (r.ok) return await r.json()
  } catch { /* none */ }
  return null
}
