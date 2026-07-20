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

export const setSessionPassword = (pw) => { password = pw }
export const getSessionPassword = () => password
export const setSessionToken = (t) => { token = t }
export const getSessionToken = () => token

const RT_KEY = 'simicap.sourcing.rt' // Supabase refresh token
const PW_KEY = 'simicap.sourcing.pw' // legacy shared password

// localStorage can throw (private mode, blocked storage) — degrade to the old
// reload-re-prompts behavior instead of breaking the Gate.
export const saveRefreshToken = (rt) => { try { rt && localStorage.setItem(RT_KEY, rt) } catch { /* noop */ } }
export const loadRefreshToken = () => { try { return localStorage.getItem(RT_KEY) || '' } catch { return '' } }
export const savePassword = (pw) => { try { pw && localStorage.setItem(PW_KEY, pw) } catch { /* noop */ } }
export const loadSavedPassword = () => { try { return localStorage.getItem(PW_KEY) || '' } catch { return '' } }
export const clearSaved = () => { try { localStorage.removeItem(RT_KEY); localStorage.removeItem(PW_KEY) } catch { /* noop */ } }

/** Forget the persisted credentials and return to the Gate. */
export const signOut = () => { clearSaved(); window.location.reload() }

/** Headers to attach to authed API calls (Supabase mode). */
export const authHeaders = () => (token ? { authorization: `Bearer ${token}` } : {})
/** Body fields to attach to authed API calls (legacy password mode). */
export const authBody = () => (password ? { password } : {})
