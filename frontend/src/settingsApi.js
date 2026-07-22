// Settings / Integrations client — masked status in, write-only out. Goes through
// the shared authed-POST wrapper (JWT header or legacy password body) like the
// other api clients. The server never returns secret values; we never send one
// back to render.
import { postJson } from './api.js'

/** { connectors:[{provider,label,category,authModel,fields,note,configured,source}], writable, tenant } */
export const getConnections = () => postJson('tenant/connections', {}, (s) => `couldn't load integrations (${s})`)

/** Store one connector field. Returns { ok, provider, field, configured } — no value. */
export const saveConnection = (provider, field, value) =>
  postJson('tenant/connections/set', { provider, field, value }, (s) => `save failed (${s})`)

/** { enabled, internal?, plan, status, renewsAt, usage:{aiCalls,aiCallsIncluded}, plans } */
export const getBilling = () => postJson('tenant/billing', {}, (s) => `couldn't load billing (${s})`)

/** Start a Stripe checkout for `plan`; resolves { url } to redirect to. 501 until billing is live. */
export const startCheckout = (plan) => postJson('tenant/billing/checkout', { plan }, (s) =>
  s === 501 ? 'Billing is not live yet — plans are preview-only.' : `checkout failed (${s})`)
