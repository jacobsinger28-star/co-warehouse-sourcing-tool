import { useContext, useEffect, useRef, useState } from 'react'
import { css } from './css.js'
import { RealDataContext } from './RealDataContext.js'
import Icon from './Icon.jsx'
import { PROPS, BROKERS, SCRAPE_SOURCES, MARKETS } from './data.js'
import { liveScrape, liveStop, liveStatus, liveRows } from './liveApi.js'
import { identity, signOut } from './session.js'
import { DEMO } from './demo.js'
import { useQueueCount } from './callQueue.js'
import { fmtInt, seg } from './helpers.js'
import SupplyModel from './modules/SupplyModel.jsx'
import AICaller from './modules/AICaller.jsx'
import DealsDB from './modules/DealsDB.jsx'
import ReuseFinder from './modules/ReuseFinder.jsx'
import Properties from './modules/Properties.jsx'
import Settings from './modules/Settings.jsx'
import { ALLOWED_MARKETS, onlyAllowed, EMPTY_FILTERS } from './modules/propertiesShared.js'

const TOTAL_UNIVERSE = 1847

// ── style builders (shell) ───────────────────────────────────────────────────
const tabBtn = (active) =>
  `flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:none;background:transparent;color:${active ? 'var(--accent)' : 'var(--text2)'};font-size:10px;font-weight:${active ? '600' : '500'};cursor:pointer;`

const MODULE_SUB = { properties: 'Off-market + on-market universe', supply: 'CoStar market supply', caller: 'AI outreach cockpit', deals: 'Deal & LOI memory', reuse: 'Street View reuse sweep', settings: 'API keys & integrations' }

// App is the shell: top bar, module switcher, mobile sheets, account menu, and the
// dataset + sourcing state the top bar shares with the Properties module. Each
// feature screen lives in src/modules/* (Properties, AICaller, DealsDB, …).
export default function App() {
  const [theme, setTheme] = useState('dark')
  const [module, setModule] = useState('properties')
  // Properties view/filter state — shared with the top bar (markets dropdown,
  // sample pill, global search), so it lives here and is passed into <Properties>.
  const [view, setView] = useState('map')          // ← default view = Map
  const [channel, setChannel] = useState('both')
  const [score, setScore] = useState({ Actionable: true, Tentative: true, Pass: true })
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [q, setQ] = useState('')                 // search: address · owner · broker · APN · contact
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const toggleSig = (k) => setFilters((f) => ({ ...f, sig: { ...f.sig, [k]: !f.sig[k] } }))
  // toggle one value in a multi-select array filter (markets, ownerTypes)
  const toggleInArr = (k, v) => setFilters((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }))

  const [sourcing, setSourcing] = useState(false)
  const [stopping, setStopping] = useState(false)  // stop requested, waiting for the backend job to actually halt
  const [total, setTotal] = useState(TOTAL_UNIVERSE)
  const [newCount, setNewCount] = useState(0)
  // started_at of the latest scrape job (running or finished) — rows whose
  // firstSeen is at/after it were found by that run and get the NEW badge.
  const [runStart, setRunStart] = useState(null)
  const [lastUpdated, setLastUpdated] = useState('2m ago')
  const [sources, setSources] = useState(SCRAPE_SOURCES.map((s) => ({ ...s })))

  // live data — decrypted by the Gate from the AES-256-GCM export and handed down
  // via context, with the committed synthetic sample as the fallback (fresh clone /
  // locked / public deploy without the password). On-market rows are superseded by
  // the live scrape DB (/api/live/rows) whenever it has listings.
  const realData = useContext(RealDataContext)
  const [liveOn, setLiveOn] = useState(null)
  const [dataset, setDataset] = useState({ props: onlyAllowed(PROPS), brokers: BROKERS, isReal: false, counts: null })
  const refreshLiveRows = async () => {
    try {
      const d = await liveRows()
      if (d?.props?.length) setLiveOn(d)
    } catch { /* sidecar absent (local dev without backend) — keep current rows */ }
  }
  useEffect(() => { refreshLiveRows() }, [])
  useEffect(() => {
    const d = realData
    const hasReal = Boolean(d && Array.isArray(d.props) && d.props.length)
    const liveProps = liveOn?.props?.length ? liveOn.props : null
    if (!hasReal && !liveProps) return
    const base = hasReal ? d.props : PROPS
    // Badge rows first seen during the latest run (ISO strings — both sides come
    // from datetime.utcnow().isoformat(), so plain string compare is correct).
    const tagNew = (p) => (p.firstSeen && runStart && p.firstSeen >= runStart ? { ...p, isNew: true } : p)
    const merged = liveProps ? [...base.filter((p) => p.channel !== 'on'), ...liveProps.map(tagNew)] : base
    const props = onlyAllowed(merged)
    const brokers = liveOn?.brokers?.length ? liveOn.brokers : (d?.brokers?.length ? d.brokers : BROKERS)
    setDataset({
      props, brokers, isReal: hasReal || Boolean(liveProps),
      counts: { ...(hasReal ? d.counts : null), props: props.length },
      meta: hasReal ? { compMax: d.compMax, cityCeil: d.cityCeil, cityLive: d.cityLive } : undefined,
    })
    setTotal(props.length)
  }, [realData, liveOn, runStart])
  const propsData = dataset.props
  // Subscribe to the shared call queue so the "AI Caller" nav badge re-renders the
  // moment something is added or removed.
  const queueCount = useQueueCount()

  // mobile shell state
  const [searchOpen, setSearchOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  const [marketsMenu, setMarketsMenu] = useState(false)

  // ── live scrape status (real /live/status — no simulation) ────────────────
  const wasRunning = useRef(false)
  const runBase = useRef(null) // listings in DB when the run started → "+N new"
  const agoLabel = (iso) => {
    if (!iso) return '—'
    const t = new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime()
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
    return mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`
  }
  const applyStatus = (s) => {
    const running = s.status === 'running'
    const counts = s.source_counts || {}
    const totalListings = Object.values(counts).reduce((a, b) => a + b, 0)
    if (running && runBase.current == null) runBase.current = totalListings
    if (!running) runBase.current = null
    setSourcing(running)
    // The backend job has actually halted (stopped/idle/completed) — clear the
    // "stopping…" latch so the button returns to Keep Sourcing. Until then we
    // keep showing the widget so a stop-in-progress doesn't look like nothing
    // happened, and the poller can't flip us back to a live "Sourcing" label.
    if (!running) setStopping(false)
    if (s.started_at) setRunStart(s.started_at)
    setNewCount(running ? Math.max(0, totalListings - runBase.current) : (s.listings_found || 0))
    const max = Math.max(1, ...Object.values(counts))
    // s.sites = per-site progress of the current/last run (status/found/error)
    setSources((prev) => prev.map((x) => ({
      ...x, p: (counts[x.key] || 0) / max, c: counts[x.key] || 0,
      st: s.sites?.[x.key]?.status, found: s.sites?.[x.key]?.found,
    })))
    setLastUpdated(agoLabel(s.finished_at || s.started_at))
    if (wasRunning.current && !running) refreshLiveRows() // run just ended → pull fresh rows
    wasRunning.current = running
  }
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const s = await liveStatus()
        if (alive) applyStatus(s)
      } catch { /* sidecar absent or not authed yet — leave UI idle */ }
    }
    tick()
    // Poll fast while a run is live OR a stop is pending, so the transition to
    // stopped is caught within one tick instead of the 60s idle cadence.
    const t = setInterval(tick, sourcing || stopping ? 3000 : 60000)
    return () => { alive = false; clearInterval(t) }
  }, [sourcing, stopping])

  const aggP = sources.reduce((a, b) => a + b.p, 0) / sources.length
  // rows currently badged NEW (found by the latest run) — drives the "+N new"
  // pill next to Keep Sourcing, which filters the Properties views to just them
  const freshCount = dataset.props.reduce((a, p) => a + (p.isNew ? 1 : 0), 0)
  const toggleNewFilter = () => { setModule('properties'); setF('newOnly', !filters.newOnly) }

  // Start/stop the REAL scrape job on the server. Optimistic flip; the status
  // poller is the source of truth and corrects state within one tick.
  // opts: {} = incremental (14-day cache, only new listings); {force_refresh:true}
  // = re-scan everything. Called via arrow fns so click events never leak in.
  const startSourcing = async (opts = {}) => {
    setNewCount(0)
    setLastUpdated('just now')
    setSourcing(true)
    try { await liveScrape(opts) } catch (e) { console.error('[sourcing] start failed', e); setSourcing(false) }
  }
  const stopSourcing = async () => {
    // Latch "stopping" and let the poller confirm the halt. We must NOT flip
    // sourcing→false here: the backend job stays "running" for a beat while it
    // tears down, and the next poll would flip it straight back to "Sourcing"
    // (the old bug where Stop looked like it did nothing).
    setStopping(true)
    try { await liveStop() } catch (e) { console.error('[sourcing] stop failed', e); setStopping(false) }
  }

  const goModule = (m) => { setModule(m); setSearchOpen(false); setStatusOpen(false); setAcctOpen(false) }
  // signed-in account for the avatar + menu; the public demo has no user identity.
  const me = DEMO ? { name: 'Demo session', sub: 'Synthetic data · read-only', initials: 'D' } : identity()

  return (
    <div data-theme={theme} style={css('display:flex;flex-direction:column;height:100vh;background:var(--bg);color:var(--text);font-size:13px;line-height:1.45;overflow:hidden;')}>

      {DEMO && (
        <div style={css('flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:8px;height:26px;background:var(--accent-dim);border-bottom:1px solid var(--accent-line);color:var(--accent);font-size:11px;font-weight:600;letter-spacing:.02em;')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:var(--accent);')} />
          Live demo · every record is synthetic — no real owners, brokers, or contacts. Nothing here places a call or sends an email.
        </div>
      )}

      {/* ===================== TOP BAR ===================== */}
      <div className="topbar" style={css('display:flex;align-items:center;gap:16px;height:52px;flex:0 0 52px;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--border);')}>
        <div style={css('display:flex;align-items:center;gap:9px;')}>
          <div style={css('width:18px;height:18px;border-radius:4px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-dim);')} />
          <span style={css('font-weight:600;letter-spacing:-.01em;')}>SimiCapital</span>
          <span className="brand-suffix" style={css('color:var(--text3);')}>·</span>
          <span className="brand-suffix" style={css('color:var(--text2);font-weight:500;')}>Sourcing</span>
        </div>
        <div className="sample-pill" title={DEMO ? 'Synthetic demo data — nothing here is real' : dataset.isReal ? `Live sourced data — ${fmtInt(dataset.counts?.props ?? propsData.length)} records (owner/broker PII · not committed)` : 'All records shown are sample data'} style={css(`display:flex;align-items:center;gap:6px;height:22px;padding:0 9px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;color:var(--text2);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;`)}><span style={css(`width:5px;height:5px;border-radius:50%;background:${dataset.isReal ? 'var(--accent)' : 'var(--text3)'};`)} />{DEMO ? `Demo data · ${fmtInt(dataset.counts?.props ?? propsData.length)}` : dataset.isReal ? `Live data · ${fmtInt(dataset.counts?.props ?? propsData.length)}` : 'Sample data'}</div>
        <div className="markets-btn" style={css('position:relative;')}>
          <button className="hov" aria-label="Select markets" aria-expanded={marketsMenu} onClick={() => setMarketsMenu((v) => !v)} style={css('display:flex;align-items:center;gap:8px;height:30px;padding:0 11px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12.5px;')}>
            <span style={css('width:6px;height:6px;border-radius:50%;background:var(--accent);')} />{filters.markets.length === 0 ? 'All markets' : filters.markets.length === 1 ? filters.markets[0] : `${filters.markets.length} markets`}<Icon name="chevronDown" size={11} sw={2} style={css('color:var(--text3);')} />
          </button>
          {marketsMenu && (
            <>
              <div onClick={() => setMarketsMenu(false)} style={css('position:fixed;inset:0;z-index:70;')} />
              <div style={css('position:absolute;top:36px;left:0;z-index:71;width:220px;max-height:340px;overflow-y:auto;background:var(--surface);border:1px solid var(--border2);border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.5);padding:6px;animation:fadein .12s ease;')}>
                <button className="hov" onClick={() => setF('markets', [])} style={css(`display:flex;align-items:center;gap:9px;width:100%;height:34px;padding:0 10px;background:${filters.markets.length === 0 ? 'var(--accent-dim)' : 'transparent'};border:none;border-radius:7px;color:var(--text);font-size:12.5px;`)}><span style={css(`width:14px;height:14px;border-radius:4px;border:1px solid ${filters.markets.length === 0 ? 'var(--accent)' : 'var(--border2)'};background:${filters.markets.length === 0 ? 'var(--accent)' : 'transparent'};flex:0 0 auto;`)} />All markets</button>
                {MARKETS.filter((m) => ALLOWED_MARKETS.has(m)).map((m) => {
                  const on = filters.markets.includes(m)
                  return (
                    <button key={m} className="hov" onClick={() => toggleInArr('markets', m)} style={css(`display:flex;align-items:center;gap:9px;width:100%;height:34px;padding:0 10px;background:${on ? 'var(--accent-dim)' : 'transparent'};border:none;border-radius:7px;color:var(--text);font-size:12.5px;`)}><span style={css(`display:flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:4px;border:1px solid ${on ? 'var(--accent)' : 'var(--border2)'};background:${on ? 'var(--accent)' : 'transparent'};flex:0 0 auto;color:#06120F;`)}>{on && <Icon name="check" size={10} sw={3} />}</span>{m}</button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div style={css('flex:1;')} />

        {!sourcing ? (
          <>
            {freshCount > 0 && (
              <button className="sourcing-full hov tap" onClick={toggleNewFilter} aria-pressed={filters.newOnly} title={filters.newOnly ? 'Showing only listings found by the last sourcing run — click to show all' : 'Show only the listings found by the last sourcing run'} style={css(`display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:7px;font-size:12px;font-weight:600;font-family:var(--mono);${filters.newOnly ? 'background:var(--accent);border:none;color:#06120F;' : 'background:var(--accent-dim);border:1px solid var(--accent-line);color:var(--accent);'}`)}>
                +{freshCount} new
              </button>
            )}
            <button className="sourcing-full hov tap" onClick={() => startSourcing()} style={css('display:flex;align-items:center;gap:8px;height:32px;padding:0 16px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12.5px;box-shadow:0 0 0 1px var(--accent-line);')}>
              <span style={css('width:7px;height:7px;border-radius:50%;background:#06120F;')} />Keep Sourcing
            </button>
            <button className="sourcing-full hov tap" onClick={() => startSourcing({ force_refresh: true })} title="Re-scan every listing, ignoring the 14-day cache — slower, but re-verifies the whole inventory and prunes sold/removed deals" style={css('display:flex;align-items:center;gap:6px;height:32px;padding:0 11px;margin-left:-8px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;color:var(--text2);font-size:11.5px;')}>
              <Icon name="recycle" size={13} sw={1.8} />Full refresh
            </button>
          </>
        ) : (
          <div className="sourcing-full" style={css(`display:flex;align-items:center;gap:11px;height:42px;padding:0 7px 0 13px;background:var(--surface2);border:1px solid ${stopping ? 'var(--border2)' : 'var(--accent-line)'};border-radius:9px;box-shadow:0 0 0 3px ${stopping ? 'transparent' : 'var(--accent-dim)'};`)}>
            <span style={css(`flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:${stopping ? 'var(--text3)' : 'var(--accent)'};${stopping ? '' : 'animation:pulse 1.1s infinite;'}`)} />
            <div style={css('display:flex;flex-direction:column;gap:5px;width:248px;')}>
              <div style={css('display:flex;align-items:center;gap:7px;white-space:nowrap;')}>
                <span style={css('font-weight:600;font-size:12px;')}>{stopping ? 'Stopping…' : 'Sourcing'}</span>
                <span style={css('font-family:var(--mono);font-size:12px;color:var(--text);')}>{fmtInt(total)}</span>
                <span style={css('color:var(--text3);font-size:11px;')}>·</span>
                <span style={css('font-family:var(--mono);font-size:12px;color:var(--accent);')}>+{newCount} new</span>
              </div>
              <div className="src-strip" style={css('display:flex;gap:6px;')}>
                {sources.map((s) => (
                  <div key={s.n} title={`${s.n}${s.st === 'error' ? ' — failed this run' : s.st === 'done' ? ' — done' : s.st === 'running' ? ' — searching…' : ''}${s.found != null ? ` · ${s.found} new` : ''}`} style={css('flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;')}>
                    <div style={css('height:3px;border-radius:2px;background:var(--border2);overflow:hidden;')}><div style={css(`height:100%;width:${s.st === 'error' ? 100 : Math.round(s.p * 100)}%;background:${s.st === 'error' ? 'var(--red)' : 'var(--accent)'};border-radius:2px;transition:width .25s;`)} /></div>
                    <span style={css(`font-size:8px;letter-spacing:.02em;color:${s.st === 'error' ? 'var(--red)' : s.st === 'running' ? 'var(--accent)' : 'var(--text3)'};text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>{s.short}</span>
                  </div>
                ))}
              </div>
              <div className="src-aggregate" style={css('align-items:center;gap:8px;')}>
                <div style={css('flex:1;height:4px;border-radius:2px;background:var(--border2);overflow:hidden;')}><div style={css(`height:100%;width:${Math.round(aggP * 100)}%;background:var(--accent);border-radius:2px;`)} /></div>
                <span style={css('font-size:9.5px;color:var(--text3);white-space:nowrap;')}>{sources.length} sources</span>
              </div>
            </div>
            <div style={css('flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;line-height:1.25;')}>
              <span style={css('font-size:8.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;')}>Updated</span>
              <span style={css('font-size:10.5px;color:var(--text2);white-space:nowrap;')}>{lastUpdated}</span>
            </div>
            <button className="hov" onClick={stopSourcing} disabled={stopping} style={css(`flex:0 0 auto;height:28px;padding:0 12px;background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:11.5px;font-weight:500;${stopping ? 'opacity:.55;cursor:default;' : ''}`)}>{stopping ? 'Stopping…' : 'Stop'}</button>
          </div>
        )}

        {/* mobile-only compact controls */}
        <button className="search-icon-btn hov tap" onClick={() => setSearchOpen(true)} aria-label="Search" style={css('align-items:center;justify-content:center;width:36px;height:36px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text2);')}><Icon name="search" size={16} /></button>
        <button className="sourcing-mini hov tap" onClick={() => setStatusOpen(true)} aria-label="Sourcing status" style={css(`align-items:center;justify-content:center;width:36px;height:36px;background:var(--surface2);border:1px solid ${sourcing ? 'var(--accent-line)' : 'var(--border)'};border-radius:8px;color:var(--text2);position:relative;`)}><Icon name="clock" size={16} sw={1.8} />{sourcing && <span style={css('position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 1.1s infinite;')} />}</button>

        <div className="search-box" style={css('display:flex;align-items:center;height:30px;padding:0 10px;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;min-width:230px;')}>
          <Icon name="search" size={13} style={css('color:var(--text2);flex:0 0 auto;')} />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search address, owner, broker, or APN" placeholder="Search address · owner · broker · APN" style={css('background:transparent;border:none;outline:none;color:var(--text);font-size:12.5px;width:100%;')} />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" style={css('display:flex;align-items:center;background:none;border:none;color:var(--text3);cursor:pointer;padding:0;')}><Icon name="x" size={13} sw={2.2} /></button>}
        </div>
        <button className="hov tap" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} aria-label="Toggle light / dark theme" style={css('display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text2);flex:0 0 auto;')}><Icon name="moon" size={15} sw={1.7} /></button>
        <button onClick={() => setAcctOpen(true)} aria-label="Account menu" title={me.sub} style={css('flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:var(--surface3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--text2);')}>{me.initials}</button>
      </div>

      {/* ===================== MODULE SWITCHER (desktop/tablet) ===================== */}
      <div className="modswitcher" style={css('display:flex;align-items:center;gap:14px;height:42px;flex:0 0 42px;padding:0 16px;background:var(--bg);border-bottom:1px solid var(--border);')}>
        <div style={css('display:flex;gap:2px;padding:3px;background:var(--surface);border:1px solid var(--border);border-radius:8px;')}>
          <button className="hov" onClick={() => goModule('properties')} style={css(seg(module === 'properties'))}>Properties</button>
          <button className="hov" onClick={() => goModule('reuse')} style={css(seg(module === 'reuse'))}>Reuse Finder</button>
          <button className="hov" onClick={() => goModule('caller')} style={css(seg(module === 'caller'))}>AI Caller{queueCount > 0 && <span style={css('display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 5px;background:var(--accent);color:#06120F;border-radius:9px;font-size:10px;font-weight:700;font-family:var(--mono);')}>{queueCount}</span>}</button>
          <button className="hov" onClick={() => goModule('deals')} style={css(seg(module === 'deals'))}>Deals DB</button>
          <button className="hov" onClick={() => goModule('supply')} style={css(seg(module === 'supply'))}>Supply Model</button>
        </div>
        <span style={css('color:var(--text3);font-size:11.5px;')}>{MODULE_SUB[module]}</span>
        <div style={css('flex:1;')} />
        <div className="legend-full" style={css('display:flex;align-items:center;gap:14px;font-size:11px;color:var(--text2);')}>
          <span style={css('display:flex;align-items:center;gap:6px;')}><span style={css('width:9px;height:9px;border-radius:50%;border:2px solid var(--off);box-sizing:border-box;')} />Off-market</span>
          <span style={css('display:flex;align-items:center;gap:6px;')}><span style={css('width:9px;height:9px;border-radius:50%;background:var(--on);')} />On-market</span>
        </div>
        <div className="legend-mini" title="Off-market vs on-market" style={css('align-items:center;gap:10px;font-size:11px;color:var(--text2);font-family:var(--mono);')}>
          <span style={css('display:flex;align-items:center;gap:5px;')}><span style={css('width:8px;height:8px;border-radius:50%;border:2px solid var(--off);box-sizing:border-box;')} />412</span>
          <span style={css('display:flex;align-items:center;gap:5px;')}><span style={css('width:8px;height:8px;border-radius:50%;background:var(--on);')} />435</span>
        </div>
      </div>

      {/* ===================== BODY ===================== */}
      <div style={css('flex:1;min-height:0;display:flex;position:relative;overflow:hidden;')}>
        {module === 'properties' && (
          <Properties
            dataset={dataset} setDataset={setDataset}
            filters={filters} setFilters={setFilters} setF={setF} toggleSig={toggleSig} toggleInArr={toggleInArr}
            channel={channel} setChannel={setChannel} score={score} setScore={setScore}
            view={view} setView={setView} q={q} setQ={setQ} theme={theme}
          />
        )}

        {module === 'supply' && <SupplyModel />}
        {module === 'caller' && <AICaller />}
        {module === 'deals' && <DealsDB />}
        {module === 'reuse' && <ReuseFinder />}
        {module === 'settings' && <Settings />}
      </div>

      {/* ===================== BOTTOM TAB BAR (phone) ===================== */}
      <div className="bottom-tabs" style={css('flex:0 0 auto;align-items:stretch;height:56px;border-top:1px solid var(--border);background:var(--surface);')}>
        {[['properties', 'Properties', 'grid'], ['reuse', 'Reuse', 'recycle'], ['caller', 'Caller', 'phone'], ['deals', 'Deals', 'database'], ['supply', 'Supply', 'bars']].map(([k, label, icon]) => (
          <button key={k} onClick={() => goModule(k)} style={css(tabBtn(module === k))}><Icon name={icon} size={20} sw={1.8} />{label}</button>
        ))}
      </div>

      {/* ===================== PHONE SHEETS ===================== */}
      {searchOpen && (
        <div style={css('position:fixed;inset:0;background:var(--bg);z-index:120;display:flex;flex-direction:column;animation:fadein .15s ease;')}>
          <div style={css('display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid var(--border);')}>
            <div style={css('display:flex;align-items:center;gap:9px;flex:1;height:44px;padding:0 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;')}><Icon name="search" size={16} style={css('color:var(--text2);')} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" placeholder="Search address · owner · broker · APN" style={css('flex:1;background:transparent;border:none;outline:none;color:var(--text);font-size:15px;')} /></div>
            <button className="tap" onClick={() => setSearchOpen(false)} style={css('height:44px;padding:0 14px;background:transparent;border:none;color:var(--accent);font-size:14px;font-weight:500;')}>Cancel</button>
          </div>
          <div style={css('flex:1;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:12.5px;')}>Type to search the sourced universe.</div>
        </div>
      )}

      {statusOpen && (
        <>
          <div onClick={() => setStatusOpen(false)} style={css('position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:120;animation:fadein .15s ease;')} />
          <div style={css('position:fixed;left:0;right:0;bottom:0;z-index:121;background:var(--surface);border-radius:18px 18px 0 0;border-top:1px solid var(--border2);padding:18px;animation:sheetup .24s ease;')}>
            <div style={css('width:38px;height:4px;border-radius:2px;background:var(--border2);margin:0 auto 14px;')} />
            <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:14px;')}><span style={css(`width:9px;height:9px;border-radius:50%;background:${sourcing && !stopping ? 'var(--accent)' : 'var(--text3)'};${sourcing && !stopping ? 'animation:pulse 1.1s infinite;' : ''}`)} /><span style={css('font-size:15px;font-weight:600;')}>{stopping ? 'Stopping…' : sourcing ? 'Sourcing live' : 'Sourcing paused'}</span><button className="tap" onClick={() => setStatusOpen(false)} aria-label="Close" style={css('display:flex;align-items:center;justify-content:center;margin-left:auto;width:34px;height:34px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text2);')}><Icon name="x" size={15} /></button></div>
            <div style={css('display:flex;gap:18px;margin-bottom:16px;')}>
              <div><div style={css('font-family:var(--mono);font-size:22px;font-weight:500;')}>{fmtInt(total)}</div><div style={css('font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;')}>scanned</div></div>
              <div onClick={freshCount > 0 ? () => { setStatusOpen(false); toggleNewFilter() } : undefined} role={freshCount > 0 ? 'button' : undefined} style={css(freshCount > 0 ? 'cursor:pointer;' : '')}><div style={css('font-family:var(--mono);font-size:22px;font-weight:500;color:var(--accent);')}>+{newCount}</div><div style={css('font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;')}>new{freshCount > 0 ? ' · view' : ''}</div></div>
              <div style={css('margin-left:auto;text-align:right;')}><div style={css('font-size:11px;color:var(--text2);')}>Updated</div><div style={css('font-size:11px;color:var(--text3);')}>{lastUpdated}</div></div>
            </div>
            <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:10px;')}>Per-source</div>
            <div style={css('display:flex;flex-direction:column;gap:10px;margin-bottom:18px;')}>
              {sources.map((s) => (
                <div key={s.n}><div style={css('display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;')}><span style={css('color:var(--text2);')}>{s.n}{s.st === 'error' ? <span style={css('color:var(--red);')}> · failed</span> : s.st === 'running' ? <span style={css('color:var(--accent);')}> · searching…</span> : null}</span><span style={css('font-family:var(--mono);color:var(--text3);')}>{fmtInt(s.c || 0)} listings{s.found != null ? ` · +${s.found}` : ''}</span></div><div style={css('height:5px;border-radius:3px;background:var(--surface3);overflow:hidden;')}><div style={css(`height:100%;width:${s.st === 'error' ? 100 : Math.round(s.p * 100)}%;background:${s.st === 'error' ? 'var(--red)' : 'var(--accent)'};border-radius:3px;`)} /></div></div>
              ))}
            </div>
            {!sourcing && newCount === 0 && lastUpdated !== '—' && (
              <div style={css('font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:12px;')}>
                0 new usually means every current listing was already found within the last 14 days (the incremental cache). A full refresh re-scans everything and prunes sold/removed deals.
              </div>
            )}
            <div style={css('display:flex;gap:8px;')}>
              <button className="tap" disabled={stopping} onClick={() => (sourcing ? stopSourcing() : startSourcing())} style={css(`flex:1;height:48px;border-radius:9px;font-size:13.5px;font-weight:600;${stopping ? 'opacity:.55;' : ''}${sourcing ? 'background:var(--surface2);border:1px solid var(--border2);color:var(--text);' : 'background:var(--accent);border:none;color:#06120F;'}`)}>{stopping ? 'Stopping…' : sourcing ? 'Stop sourcing' : 'Keep Sourcing'}</button>
              {!sourcing && (
                <button className="tap" onClick={() => { setStatusOpen(false); startSourcing({ force_refresh: true }) }} style={css('flex:0 0 auto;height:48px;padding:0 16px;border-radius:9px;font-size:13px;font-weight:500;background:var(--surface2);border:1px solid var(--border2);color:var(--text);')}>Full refresh</button>
              )}
            </div>
          </div>
        </>
      )}

      {acctOpen && (
        <>
          {/* transparent click-catcher — a dropdown shouldn't dim the page */}
          <div onClick={() => setAcctOpen(false)} style={css('position:fixed;inset:0;z-index:120;')} />
          <div role="menu" style={css('position:fixed;top:54px;right:12px;z-index:121;width:232px;background:var(--surface);border:1px solid var(--border2);border-radius:11px;box-shadow:0 16px 44px rgba(0,0,0,.45);padding:6px;animation:fadein .12s ease;')}>
            <div style={css('display:flex;flex-direction:column;gap:2px;padding:8px 10px 10px;')}>
              <span style={css('font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{me.name}</span>
              <span style={css('font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{me.sub}</span>
            </div>
            <div style={css('height:1px;background:var(--border);margin:0 4px 6px;')} />
            {!DEMO && (
              <button className="hov tap" onClick={() => goModule('settings')} style={css('display:flex;align-items:center;gap:9px;width:100%;height:40px;padding:0 10px;background:transparent;border:none;border-radius:7px;color:var(--text2);font-size:13px;font-weight:500;text-align:left;')}><Icon name="users" size={16} sw={1.8} />Settings</button>
            )}
            {DEMO
              ? <a href="/" className="hov tap" style={css('display:flex;align-items:center;gap:9px;width:100%;height:40px;padding:0 10px;background:transparent;border:none;border-radius:7px;color:var(--text2);font-size:13px;font-weight:500;text-align:left;text-decoration:none;')}><Icon name="slashCircle" size={16} sw={1.8} />Exit demo</a>
              : <button className="hov tap" onClick={signOut} style={css('display:flex;align-items:center;gap:9px;width:100%;height:40px;padding:0 10px;background:transparent;border:none;border-radius:7px;color:var(--red);font-size:13px;font-weight:500;text-align:left;')}><Icon name="slashCircle" size={16} sw={1.8} />Sign out</button>}
          </div>
        </>
      )}
    </div>
  )
}
