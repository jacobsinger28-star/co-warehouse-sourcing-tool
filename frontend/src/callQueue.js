// Shared, cross-module call queue.
//
// Properties added from the Properties map/table — the detail-drawer "Add to call
// queue" button or the table bulk bar — land here, and the Power Dialer (AICaller)
// reads this as its live staging list. This closes the TODO in AICaller.jsx that
// asked to "swap CALL_QUEUE (demo staging) for the operator's real selected owners
// from the map/table."
//
// It's a tiny localStorage-backed store with a useSyncExternalStore hook so the
// two screens stay in sync without prop-drilling through App, and the queue
// survives reloads and module switches. Nothing is seeded — the dialer starts
// empty and only ever shows owners the operator actually staged (no phantom
// demo rows, no fake 555 numbers pushed to PhoneBurner).
import { useSyncExternalStore } from 'react'

const KEY = 'simicap.sourcing.callqueue'

// Stable dedupe key for an entry: the property id if we have one, else the address.
const keyOf = (e) => String(e.id ?? e.addr ?? '')

// Normalize a property (from PROPS / live scrape rows) into the flat entry shape
// the dialer understands. Handles both off-market (owner) and on-market (broker)
// rows, and both live `phones: []` arrays and the demo `phone: ''` scalar.
const entryFromProp = (p) => ({
  id: p.id != null ? String(p.id) : (p.addr || ''),
  addr: p.addr || '',
  owner: p.owner || p.person || p.broker || '',
  phone: (Array.isArray(p.phones) && p.phones[0]) || p.phone || '',
  score: p.score ?? null,
  cat: p.cat || '',
  channel: p.channel || 'off',
  last: 'staged',
})

let queue = load()
const listeners = new Set()

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore — private mode / blocked storage */ }
  return []
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(queue)) } catch { /* ignore */ }
}

function emit() {
  persist()
  listeners.forEach((l) => l())
}

/**
 * Add one property or an array of properties to the queue.
 * Dedupes by id/address against what's already staged. Returns how many were new.
 */
export function addToQueue(propOrProps) {
  const items = Array.isArray(propOrProps) ? propOrProps : [propOrProps]
  const seen = new Set(queue.map(keyOf))
  const additions = []
  for (const p of items) {
    if (!p) continue
    const e = entryFromProp(p)
    const k = keyOf(e)
    if (!k || seen.has(k)) continue
    seen.add(k)
    additions.push(e)
  }
  if (additions.length) {
    queue = [...queue, ...additions]
    emit()
  }
  return additions.length
}

/** Remove a single entry by property id or address. */
export function removeFromQueue(idOrAddr) {
  const k = String(idOrAddr)
  const next = queue.filter((e) => keyOf(e) !== k && e.addr !== k)
  if (next.length !== queue.length) { queue = next; emit() }
}

/** Empty the whole queue. */
export function clearQueue() {
  if (queue.length) { queue = []; emit() }
}

/** Is this property (by id or address) already staged? */
export function isQueued(idOrAddr) {
  const k = String(idOrAddr)
  return queue.some((e) => keyOf(e) === k || e.addr === k)
}

export function getQueue() { return queue }
const getCount = () => queue.length

// ── React bindings ──────────────────────────────────────────────────────────
const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb) }

/** Live queue array — re-renders the caller whenever the queue changes. */
export function useCallQueue() {
  return useSyncExternalStore(subscribe, getQueue, getQueue)
}

/** Live queue length — cheap subscription for badges / disabled states. */
export function useQueueCount() {
  return useSyncExternalStore(subscribe, getCount, getCount)
}
