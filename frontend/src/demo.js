// Public demo mode. When the app is opened at /demo (or with ?demo=1), it runs
// with NO login against the fake-only /api/demo/* surface and 100% synthetic
// data. In demo mode the app can never read real data or trigger a real
// integration — every client call is routed to /api/demo/* (see apiUrl below),
// which serves synthetic responses only.
const detect = () => {
  try {
    const { pathname, search } = window.location
    return pathname === '/demo' || pathname.startsWith('/demo/') ||
      new URLSearchParams(search).has('demo')
  } catch { return false }
}

export const DEMO = detect()

// Build an API URL. In demo mode every route is rewritten to the fake-only
// /api/demo/* surface, so the same client code hits synthetic endpoints without
// per-call branching. `sub` is the path after `api/` (e.g. 'data', 'live/rows').
export const apiUrl = (sub) =>
  `${import.meta.env.BASE_URL}api/${DEMO ? 'demo/' : ''}${String(sub).replace(/^\/+/, '')}`
