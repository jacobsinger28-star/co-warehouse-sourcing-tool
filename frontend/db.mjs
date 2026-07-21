// db.mjs — minimal server-side Supabase Postgres access over PostgREST + fetch.
//
// No @supabase/supabase-js dependency: mirrors the hand-rolled GoTrue REST client
// in src/supabaseAuth.js ("no SDK, matching this codebase's lean style"). This
// module holds the SERVICE-ROLE key and must only ever run server-side — it is
// never imported by anything under src/ (the browser bundle).
//
//   SUPABASE_URL               — https://<project-ref>.supabase.co  (already set for auth)
//   SUPABASE_SERVICE_ROLE_KEY  — server-only secret; grants full DB access, bypasses RLS.
//
// If SUPABASE_SERVICE_ROLE_KEY is unset, tenancyEnabled() is false and every
// caller falls back to legacy single-tenant behavior — so shipping this code
// before the key is set changes nothing. Env is read live (not cached at import)
// so tests and a mid-run config change both see the current value.
const urlBase = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/** True once the server has a Supabase URL + service-role key: the switch that
 * turns the DB-backed tenant layer on. Off → callers use the legacy allowlist. */
export const tenancyEnabled = () => Boolean(urlBase() && serviceKey())

const headers = (extra = {}) => {
  const k = serviceKey()
  return { apikey: k, authorization: `Bearer ${k}`, 'content-type': 'application/json', ...extra }
}

const body = (r) => r.text().catch(() => '')

/** GET rows from a table. `query` is a raw PostgREST query string (already
 * URL-encoded), e.g. `select=*&id=eq.123`. Returns an array. */
export async function dbSelect(table, query = '') {
  const r = await fetch(`${urlBase()}/rest/v1/${table}${query ? `?${query}` : ''}`, { headers: headers() })
  if (!r.ok) throw new Error(`db select ${table} -> ${r.status} ${(await body(r)).slice(0, 200)}`)
  return r.json()
}

/** Upsert one row or an array of rows. `onConflict` is the comma-separated
 * conflict-target column list (defaults to the primary key). Returns the rows. */
export async function dbUpsert(table, rows, { onConflict } = {}) {
  const q = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''
  const r = await fetch(`${urlBase()}/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: headers({ prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  })
  if (!r.ok) throw new Error(`db upsert ${table} -> ${r.status} ${(await body(r)).slice(0, 200)}`)
  return r.json()
}

/** DELETE rows matching a raw PostgREST filter (e.g. `tenant_id=eq.<uuid>`).
 * A filter is REQUIRED — refuse an unfiltered delete so a bug can't wipe a table. */
export async function dbDelete(table, filter) {
  if (!filter) throw new Error('dbDelete requires a filter (refusing to delete an entire table)')
  const r = await fetch(`${urlBase()}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: headers({ prefer: 'return=representation' }),
  })
  if (!r.ok) throw new Error(`db delete ${table} -> ${r.status} ${(await body(r)).slice(0, 200)}`)
  return r.json()
}
