import { useEffect, useState } from 'react'
import { css } from './css.js'
import { loadDemoData } from './crypto.js'
import { RealDataContext } from './RealDataContext.js'

// Login-free entry for the public /demo link. It fetches the synthetic demo
// dataset from /api/demo/data and provides it through the same RealDataContext
// the Gate uses, so <App> renders identically — just on fake data, with every
// integration routed to the fake-only /api/demo/* surface (see src/demo.js).
// No credentials are ever collected or sent here.
export default function DemoGate({ children }) {
  const [data, setData] = useState(undefined) // undefined = loading, null = sample fallback, {} = demo data
  const baseUrl = import.meta.env.BASE_URL

  useEffect(() => {
    let on = true
    loadDemoData(baseUrl).then((d) => { if (on) setData(d) }).catch(() => { if (on) setData(null) })
    return () => { on = false }
  }, [baseUrl])

  if (data === undefined) {
    return (
      <div data-theme="dark" style={css('min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);')}>
        <div style={css('display:flex;flex-direction:column;align-items:center;gap:18px;animation:fadein .3s ease;')}>
          <div style={css('display:flex;align-items:center;gap:10px;')}>
            <div style={css('width:22px;height:22px;border-radius:5px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-dim);animation:pulse 1.6s ease infinite;')} />
            <span style={css('font-weight:600;font-size:15px;letter-spacing:-.01em;')}>SimiCapital</span>
            <span style={css('color:var(--text3);')}>·</span>
            <span style={css('color:var(--text2);font-weight:500;font-size:13px;')}>Sourcing · Demo</span>
          </div>
          <div style={css('display:flex;align-items:center;gap:9px;color:var(--text2);font-size:12.5px;')}>
            <span style={css('width:14px;height:14px;border-radius:50%;border:2px solid var(--border2);border-top-color:var(--accent);animation:spin .7s linear infinite;')} />
            Loading demo…
          </div>
        </div>
      </div>
    )
  }

  return <RealDataContext.Provider value={data}>{children}</RealDataContext.Provider>
}
