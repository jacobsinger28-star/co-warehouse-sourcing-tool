// Constants shared between the app shell (App.jsx) and the Properties module
// (Properties.jsx). Kept in their own file so neither imports the other — the
// top bar's markets dropdown + the dataset init (App) and the filter rail +
// visibleProps (Properties) all read the same market allowlist / empty-filter
// shape without duplicating it.

// Markets shown for now — everything else (Cleveland + the national on-market
// scrape noise) is hidden from the view. Widen this set to re-show a metro.
export const ALLOWED_MARKETS = new Set(['Charlotte', 'Raleigh', 'Charleston', 'Columbus', 'Cleveland', 'Miami', 'Boca Raton', 'West Palm Beach', 'Nashville', 'Orlando'])
export const onlyAllowed = (props) => props.filter((p) => ALLOWED_MARKETS.has(p.mkt))

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
