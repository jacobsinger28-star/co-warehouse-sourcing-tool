// Client for the PhoneBurner integration, via the Node proxy (/api/phoneburner/*).
// Always POST so both auth modes work: Supabase JWT rides the Authorization
// header, the legacy shared password rides the body (same as /api/data & liveApi).
import { authHeaders, authBody } from './session.js'

const call = async (action, body = {}) => {
  const r = await fetch(`/api/phoneburner/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...authBody(), ...body }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.error || `HTTP ${r.status}`)
  }
  return r.json()
}

export const pbStatus = () => call('status')
export const pbPush = (contacts) => call('push', { contacts })
export const pbDial = (contactIds) => call('dial', { contactIds })
export const pbRecent = () => call('recent')
