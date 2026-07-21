// Client for the Pipedrive write integration, via the Node proxy (/api/pipedrive/*).
// Always POST so both auth modes work: Supabase JWT rides the Authorization
// header, the legacy shared password rides the body (same as phoneBurner.js).
import { authHeaders, authBody } from './session.js'

const call = async (action, body = {}) => {
  const r = await fetch(`/api/pipedrive/${action}`, {
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

export const pdStatus = () => call('status')
export const pdSyncBroker = (broker) => call('broker', { broker })
export const pdPushLead = (prop) => call('lead', { prop })
export const pdPushLeads = (props) => call('leads', { props })
