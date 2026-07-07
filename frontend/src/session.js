// In-memory session password, set by Gate on a successful unlock. Kept out of
// sessionStorage/localStorage on purpose (a reload re-prompts, same as Gate) —
// authed API calls like /api/deals-chat read it from here.
let password = ''
export const setSessionPassword = (pw) => { password = pw }
export const getSessionPassword = () => password
