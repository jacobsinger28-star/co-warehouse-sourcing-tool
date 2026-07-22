// Parse the asking lease rate ($/SF/YR) out of a LoopNet listing note.
//
// LoopNet for-lease notes end with the rate in a handful of shapes, all quoted
// in $/SF/YR in this dataset:
//   "... $19 SF/YR"             → 19        (whole dollars)
//   "... $15.95 SF/YR"          → 15.95     (cents)
//   "... $13.25 - $15.00 SF/YR" → 13.25     (range → low end / asking floor)
//   "... $5+ SF/YR"             → 5         ("from $5")
//   "... Price Upon Request"    → null      (no number stated)
//   note absent / no rate       → null
//
// The rate is anchored to the trailing "SF/YR" so we never pick up an unrelated
// dollar figure elsewhere in the note. Returns a Number in $/SF/YR, or null.
const RATE_RE = /\$\s*([\d,]+(?:\.\d+)?)\s*\+?\s*(?:-\s*\$\s*([\d,]+(?:\.\d+)?)\s*)?SF\s*\/\s*YR/i

export function parseLeaseRate(note) {
  if (!note) return null
  const m = RATE_RE.exec(note)
  if (!m) return null
  const lo = Number(m[1].replace(/,/g, ''))
  const hi = m[2] != null ? Number(m[2].replace(/,/g, '')) : lo
  const rate = Math.min(lo, hi)
  return Number.isFinite(rate) ? rate : null
}

// Representative rate for a property that may carry several listings: the MIN
// asking rate across them — the cheapest available space. That's the number a
// "properties I could lease space in under $X" filter wants, and it stays stable
// when one big multi-tenant building lists a wide asking band. Returns undefined
// (not null) when no listing states a rate, so callers can treat it as "no data"
// and leave the field off entirely.
export function leaseRepRate(lease) {
  if (!lease) return undefined
  const items = lease.listings?.length ? lease.listings : [lease]
  const rates = items.map((l) => parseLeaseRate(l && l.note)).filter((r) => r != null)
  return rates.length ? Math.min(...rates) : undefined
}
