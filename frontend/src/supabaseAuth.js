// Minimal Supabase (GoTrue) email/password auth over REST — no SDK dependency,
// matching this codebase's lean style (crypto.js hand-rolls WebCrypto the same
// way). Only what the Gate needs: sign in, and keep the token fresh.
//
// cfg = { url, anonKey } — served by GET /api/config (Railway) or via
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (local dev). The anon key is a
// public client key by design; authorization happens server-side.

async function tokenRequest(cfg, grantType, body) {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error_description || d.msg || d.error || `Sign-in failed (${r.status})`)
  return d // { access_token, refresh_token, expires_in, user }
}

export const signInWithPassword = (cfg, email, password) =>
  tokenRequest(cfg, 'password', { email, password })

/**
 * Register a new account. With email confirmation on (this project's setting),
 * returns a user WITHOUT a session — the person must click the emailed link,
 * then sign in. Registration alone grants nothing: the server's allowlist +
 * confirmed-email check still decide who reaches the data.
 */
export async function signUp(cfg, email, password, fullName, redirectTo) {
  const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''
  const r = await fetch(`${cfg.url}/auth/v1/signup${q}`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, ...(fullName ? { data: { full_name: fullName } } : {}) }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error_description || d.msg || d.error || `Sign-up failed (${r.status})`)
  return d // session (autoconfirm on) or bare user (confirmation email sent)
}

export const refreshSession = (cfg, refreshToken) =>
  tokenRequest(cfg, 'refresh_token', { refresh_token: refreshToken })

/**
 * Keep the access token fresh for the life of the page. Refreshes ~60s before
 * expiry; on a failed refresh keeps the old token and retries shortly (the
 * server will 401 if it truly expired — same UX as the old "reload to re-auth").
 * Returns a stop() cleanup.
 */
export function startAutoRefresh(cfg, session, onToken) {
  let timer
  let refreshToken = session.refresh_token
  const arm = (expiresIn) => { timer = setTimeout(run, Math.max(30, (expiresIn || 3600) - 60) * 1000) }
  const run = async () => {
    try {
      const s = await refreshSession(cfg, refreshToken)
      refreshToken = s.refresh_token || refreshToken
      onToken(s.access_token)
      arm(s.expires_in)
    } catch {
      arm(120) // transient failure — retry in 2 min with the old refresh token
    }
  }
  arm(session.expires_in)
  return () => clearTimeout(timer)
}
