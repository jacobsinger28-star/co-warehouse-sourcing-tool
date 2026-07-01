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

// Load the real dataset. Order of preference:
//   1. POST /api/data  — Railway server-side auth (data never a public file; the
//      password is checked on the server). This is the secure production path.
//   2. data.enc.json   — encrypted static blob (Vercel static deploy), decrypted here.
//   3. data.real.json  — plaintext (local dev only).
// Returns the parsed dataset, or null (→ app uses synthetic sample data).
export async function loadRealData(password, baseUrl = '/') {
  // 1. server-side auth (Railway)
  try {
    const r = await fetch(`${baseUrl}api/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    })
    if (r.ok) return await r.json()
    if (r.status === 401) return null // server says wrong password — no static fallback
  } catch { /* no backend (static host) → try static blobs */ }
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
