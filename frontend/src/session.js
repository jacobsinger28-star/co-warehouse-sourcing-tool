// Session credentials, set by Gate on a successful unlock. The live token /
// password stays in memory; a persistent "keep me signed in" copy lives in
// localStorage so a reload restores the session instead of re-prompting:
//   - Supabase login → the refresh token is stored (standard supabase-js
//     behavior); Gate silently exchanges it for a fresh JWT on load.
//   - legacy shared password → the password itself is stored (it doubles as
//     the AES decryption key, so there is nothing weaker to store instead).
// Sign out (account menu) clears the stored copy.
// Authed API calls (deals table / deals chat / real data) read from here via
// authHeaders() / authBody() and work in either mode.
let password = ''
let token = ''
let authCfg = null // Supabase {url, anonKey}, set on entry so signOut can revoke server-side
let user = null    // Supabase user object ({ email, user_metadata }), null in legacy mode

export const setSessionPassword = (pw) => { password = pw }
export const setSessionToken = (t) => { token = t }
export const setAuthCfg = (c) => { authCfg = c }
export const setCurrentUser = (u) => { user = u }

/** Who's signed in, for the avatar + account menu. Reads the real Supabase
 * account (name from signup, falling back to the email's local part) instead
 * of the old hard-coded "J. Simi" mockup persona. Legacy shared-password mode
 * has no per-person identity, so it shows a neutral shared-access label. */
export const identity = () => {
  const email = user?.email || ''
  if (!email) return { name: 'SimiCapital', sub: 'Shared access', initials: 'SC' }
  const full = (user?.user_metadata?.full_name || '').trim()
  const name = full || email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const parts = name.split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || email[0].toUpperCase()
  return { name, sub: email, initials }
}

const RT_KEY = 'simicap.sourcing.rt' // Supabase refresh token
const PW_KEY = 'simicap.sourcing.pw' // legacy shared password

// localStorage can throw (private mode, blocked storage) — degrade to the old
// reload-re-prompts behavior instead of breaking the Gate.
export const saveRefreshToken = (rt) => { try { rt && localStorage.setItem(RT_KEY, rt) } catch { /* noop */ } }
export const loadRefreshToken = () => { try { return localStorage.getItem(RT_KEY) || '' } catch { return '' } }
export const savePassword = (pw) => { try { pw && localStorage.setItem(PW_KEY, pw) } catch { /* noop */ } }
export const loadSavedPassword = () => { try { return localStorage.getItem(PW_KEY) || '' } catch { return '' } }
export const clearSaved = () => { try { localStorage.removeItem(RT_KEY); localStorage.removeItem(PW_KEY) } catch { /* noop */ } }

/** Whether localStorage actually works (false in some private modes). Lets the
 * auto-refresher tell "storage empty because the user signed out" apart from
 * "storage never worked in the first place". */
export const storageWorks = () => {
  try {
    localStorage.setItem('simicap.probe', '1')
    localStorage.removeItem('simicap.probe')
    return true
  } catch { return false }
}

/** Forget the persisted credentials and return to the Gate. Also revokes the
 * refresh-token family server-side (best effort) — without that, any other
 * open tab could keep the session alive from its in-memory token and quietly
 * re-persist it, making "Sign out" a lie on this PII-bearing tool. */
export const signOut = () => {
  try {
    if (authCfg && token) {
      fetch(`${authCfg.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: authCfg.anonKey, authorization: `Bearer ${token}` },
        keepalive: true, // survives the reload below
      }).catch(() => {})
    }
  } catch { /* revocation is best-effort */ }
  clearSaved()
  window.location.reload()
}

/** Headers to attach to authed API calls (Supabase mode). */
export const authHeaders = () => (token ? { authorization: `Bearer ${token}` } : {})
/** Body fields to attach to authed API calls (legacy password mode). */
export const authBody = () => (password ? { password } : {})
