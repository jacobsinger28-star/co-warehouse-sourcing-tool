// Filter-search usage memory — DEVICE-LOCAL only (localStorage), never sent
// anywhere. Records which ASK terms/queries get applied (so the modal can
// surface the most-used ones) and which typed queries the parser couldn't
// handle (so the vocabulary gap is visible and can be closed). Same privacy
// posture as the rest of the app: the data lives only in the already-unlocked
// browser and can be cleared from the modal.
const KEY = 'sc.filterUsage.v1'
const MAX_UNMATCHED = 24
const MAX_LEN = 80

const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
const save = (d) => {
  try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* quota / disabled — non-fatal */ }
}

// Count a successfully-applied term or query (lowercased+trimmed key).
export function recordApply(text) {
  const k = String(text || '').trim().toLowerCase().slice(0, MAX_LEN)
  if (!k || k === 'reset') return
  const d = load()
  d.counts = d.counts || {}
  d.counts[k] = (d.counts[k] || 0) + 1
  save(d)
}

// Remember a query the parser didn't (fully) understand — empty patch or
// leftover tokens. Newest first, de-duped, capped.
export function recordUnmatched(q, leftover) {
  const k = String(q || '').trim().slice(0, MAX_LEN)
  if (!k) return
  const d = load()
  const prev = (d.unmatched || []).filter((u) => u.q.toLowerCase() !== k.toLowerCase())
  d.unmatched = [{ q: k, leftover: (leftover || []).slice(0, 8), ts: Date.now() }, ...prev].slice(0, MAX_UNMATCHED)
  save(d)
}

// Most-used terms/queries, descending.
export function topTerms(n = 8) {
  const c = load().counts || {}
  return Object.entries(c)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term, count]) => ({ term, count }))
}

export function unmatchedList() {
  return load().unmatched || []
}

export function clearUsage() {
  save({})
}
