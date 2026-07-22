// Constants shared between the app shell (App.jsx) and the Properties module
// (Properties.jsx). Kept in their own file so neither imports the other — the
// top bar's markets dropdown + the dataset init (App) and the filter rail +
// visibleProps (Properties) all read the same market allowlist / empty-filter
// shape without duplicating it.

// Buy-box "target markets" (the list Jake Diamond asked for). These are the
// DEFAULT scope, NOT a hard cut: the nationwide on-market scrape is stored and
// loaded in full, but with no market selected and no search the Properties view
// shows only these. The market picker + global search still reach any US market
// (see visibleProps in Properties.jsx and marketOptions below).
export const ALLOWED_MARKETS = new Set(['Charlotte', 'Raleigh', 'Charleston', 'Columbus', 'Cleveland', 'Miami', 'Boca Raton', 'West Palm Beach', 'Nashville', 'Orlando'])

// Market-picker options from whatever data is loaded: target markets first (in
// the caller's canonical order), then every other US market present in the data
// (alphabetical) — so the picker can reach the full nationwide scrape while
// keeping the target markets on top. Returns { buy, rest }.
export const marketOptions = (props, canonicalOrder = []) => {
  const present = new Set((props || []).map((p) => p.mkt).filter(Boolean))
  const buy = canonicalOrder.filter((m) => ALLOWED_MARKETS.has(m) && present.has(m))
  for (const m of [...present].filter((m) => ALLOWED_MARKETS.has(m)).sort())
    if (!buy.includes(m)) buy.push(m)
  const rest = [...present].filter((m) => !ALLOWED_MARKETS.has(m)).sort()
  return { buy, rest }
}

// Full filter set — parity with the off-market tool's map/dashboard. Numeric
// bounds are null-inclusive: a row with the field absent passes through, so
// setting e.g. clear-height only narrows the markets that carry that data.
export const EMPTY_FILTERS = {
  markets: [], ownerTypes: [], ownerLoc: 'all', bucket: 'all',
  clearMax: '', yearMin: '', yearMax: '', sfMin: '', sfMax: '',
  distMax: '', holdMin: '', heldSince: '',
  saleYearMin: '', salePriceMin: '', salePriceMax: '', salePsfMax: '',
  askMax: '', domMin: '',
  newOnly: false, // only listings first seen during the latest sourcing run
  sig: { oos: false, tax: false, code: false, permit: false, vacant: false, distress: false, contact: false, lease: false },
}
