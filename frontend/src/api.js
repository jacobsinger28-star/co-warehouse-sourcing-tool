// Single authed-POST JSON client for the app's own endpoints. One place that:
//   - routes to the fake-only /api/demo/* surface in demo mode (apiUrl),
//   - attaches the Supabase JWT (header) or legacy password (body),
//   - parses the response body once, and throws on a non-2xx with the server's
//     {error} message (or a caller-supplied fallback).
// liveApi.js, phoneBurner.js, and DealsDB all go through this instead of
// re-implementing the same fetch dance.
import { apiUrl } from './demo.js'
import { authHeaders, authBody } from './session.js'

export async function postJson(sub, body = {}, fallbackMsg = (status) => `HTTP ${status}`) {
  const r = await fetch(apiUrl(sub), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...authBody(), ...body }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error || fallbackMsg(r.status))
  return d
}
