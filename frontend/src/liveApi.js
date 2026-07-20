// Client for the live-scrape service, via the Node proxy (/api/live/*).
// Always POST so both auth modes work: Supabase JWT rides the Authorization
// header, the legacy shared password rides the body (same as /api/data).
import { authHeaders, authBody } from './session.js'

const call = async (action, body = {}) => {
  const r = await fetch(`/api/live/${action}`, {
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

export const liveScrape = (opts = {}) => call('scrape', opts)
export const liveStop = () => call('stop')
export const liveStatus = () => call('status')
export const liveRows = () => call('rows')
