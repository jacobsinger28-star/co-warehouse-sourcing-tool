// In-memory session credentials, set by Gate on a successful unlock. Kept out of
// sessionStorage/localStorage on purpose (a reload re-prompts, same as Gate).
// Two modes:
//   - Supabase login → a JWT access token (sent as an Authorization header)
//   - legacy shared password → the password itself (sent in the request body)
// Authed API calls (deals table / deals chat / real data) read from here via
// authHeaders() / authBody() and work in either mode.
let password = ''
let token = ''

export const setSessionPassword = (pw) => { password = pw }
export const getSessionPassword = () => password
export const setSessionToken = (t) => { token = t }
export const getSessionToken = () => token

/** Headers to attach to authed API calls (Supabase mode). */
export const authHeaders = () => (token ? { authorization: `Bearer ${token}` } : {})
/** Body fields to attach to authed API calls (legacy password mode). */
export const authBody = () => (password ? { password } : {})
