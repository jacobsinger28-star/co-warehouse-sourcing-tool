// Untracked dev harness: renders the full App without the auth Gate, with the
// committed synthetic sample data plus fake lease flags on a few rows, so the
// LoopNet-lease badge / filter / drawer can be visually verified. Not shipped.
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { RealDataContext } from './RealDataContext.js'
import { PROPS, BROKERS } from './data.js'
import './index.css'

const FAKE_LEASE = {
  url: 'https://www.loopnet.com/Listing/3443-3479-Parkway-Center-Ct-Orlando-FL/26564512/',
  addr: '3443-3479 Parkway Center Ct',
  city: 'Orlando',
  note: 'Built in 1981 1,250 - 76,386 SF $14.75 - $18.00 SF/YR',
  n: 2,
  listings: [
    { url: 'https://www.loopnet.com/Listing/3443-3479-Parkway-Center-Ct-Orlando-FL/26564512/', addr: '3443-3479 Parkway Center Ct' },
    { url: 'https://www.loopnet.com/Listing/1271-La-Quinta-Dr-Orlando-FL/25150919/', addr: '1271 La Quinta Dr' },
  ],
}
const data = {
  props: PROPS.map((p, i) => (i % 4 === 0 ? { ...p, lease: { ...FAKE_LEASE, n: 1, listings: [FAKE_LEASE.listings[0]] } } : p)),
  brokers: BROKERS,
  counts: { props: PROPS.length },
}

createRoot(document.getElementById('root')).render(
  <RealDataContext.Provider value={data}>
    <App />
  </RealDataContext.Provider>,
)
