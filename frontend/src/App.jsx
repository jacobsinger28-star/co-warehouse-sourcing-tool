import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { css } from './css.js'
import { RealDataContext } from './RealDataContext.js'
import Icon from './Icon.jsx'
import { PROPS, BROKERS, SCRAPE_SOURCES, MARKETS, SOURCES } from './data.js'
import { liveScrape, liveStop, liveStatus, liveRows } from './liveApi.js'
import { identity, signOut } from './session.js'
import FilterChat from './FilterChat.jsx'
import {
  fmtInt, fmtSF, fmtMoney2, scDot, scLabel, chDot, chTag, chLabel, scChip,
  rowStyle, cardStyle, breakdownFor, catVar, fmtPhone, humanizeSig,
} from './helpers.js'
import SupplyModel from './modules/SupplyModel.jsx'
import AICaller from './modules/AICaller.jsx'
import DealsDB from './modules/DealsDB.jsx'
import ReuseFinder from './modules/ReuseFinder.jsx'
import DealMap from './components/DealMap.jsx'

const TOTAL_UNIVERSE = 1847

// ── style builders ──────────────────────────────────────────────────────────
const seg = (active) =>
  `display:flex;align-items:center;gap:7px;height:28px;padding:0 12px;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;${active ? 'background:var(--surface3);color:var(--text);box-shadow:inset 0 0 0 1px var(--border2);' : 'background:transparent;color:var(--text2);'}`
const chSeg = (active) =>
  `flex:1;display:flex;align-items:center;justify-content:center;gap:7px;height:30px;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;${active ? 'background:var(--surface3);color:var(--text);box-shadow:inset 0 0 0 1px var(--border2);' : 'background:transparent;color:var(--text2);'}`
const scChipFilter = (active, cat) =>
  `display:flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:6px;font-size:11.5px;cursor:pointer;border:1px solid ${active ? `var(${catVar(cat)})` : 'var(--border)'};background:${active ? `var(--${cat === 'Actionable' ? 'green' : cat === 'Tentative' ? 'amber' : 'red'}-tint)` : 'var(--surface2)'};color:${active ? 'var(--text)' : 'var(--text3)'};`
const viewTab = (active) =>
  `display:flex;align-items:center;gap:8px;height:42px;padding:0 16px;border:none;background:transparent;color:${active ? 'var(--text)' : 'var(--text2)'};font-size:13px;font-weight:${active ? '600' : '500'};border-bottom:2px solid ${active ? 'var(--accent)' : 'transparent'};cursor:pointer;`
const tabBtn = (active) =>
  `flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:none;background:transparent;color:${active ? 'var(--accent)' : 'var(--text2)'};font-size:10px;font-weight:${active ? '600' : '500'};cursor:pointer;`
const th = (align = 'left', cls = '') => ({ cls, s: `text-align:${align};padding:9px 8px;font-weight:600;color:var(--text2);font-size:10.5px;letter-spacing:.04em;border-bottom:1px solid var(--border);` })
const railLabel = 'font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:9px;'
const fieldLabel = 'font-size:11px;color:var(--text2);font-weight:500;'
const selectStyle = 'height:32px;padding:0 8px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px;'
const contactStyle = (c) =>
  c === 'No contact'
    ? 'font-size:11px;color:var(--text3);background:var(--surface2);border:1px solid var(--border);padding:2px 7px;border-radius:5px;white-space:nowrap;'
    : 'font-size:11px;color:var(--green);background:var(--green-tint);border:1px solid var(--border);padding:2px 7px;border-radius:5px;white-space:nowrap;'

const MODULE_SUB = { properties: 'Off-market + on-market universe', supply: 'CoStar market supply', caller: 'AI outreach cockpit', deals: 'Deal & LOI memory', reuse: 'Street View reuse sweep' }
const SCORE_CATS = ['Actionable', 'Tentative', 'Pass']

// Markets shown for now — everything else (Cleveland + the national on-market
// scrape noise) is hidden from the view. Widen this set to re-show a metro.
const ALLOWED_MARKETS = new Set(['Charlotte', 'Raleigh', 'Charleston', 'Columbus', 'Cleveland', 'Miami', 'Boca Raton', 'West Palm Beach', 'Nashville', 'Orlando'])
const onlyAllowed = (props) => props.filter((p) => ALLOWED_MARKETS.has(p.mkt))

// Distress signals (off-market) — each maps to a real field/component on a prop.
const SIG_DEFS = [
  ['oos', 'Out-of-state owner'],
  ['tax', 'Tax-delinquent'],
  ['code', 'Code violations'],
  ['permit', 'Permit anomaly'],
  ['vacant', 'Inferred-vacant'],
  ['distress', 'Any distress signal'],
  ['contact', 'Has owner / broker contact'],
  ['lease', 'LoopNet lease listing'],
]
const SIG_LABEL = Object.fromEntries(SIG_DEFS)
// Full filter set — parity with the off-market tool's map/dashboard (search, SF
// band, distance-to-core, hold, year range, held-since, previous-sale price/year/
// $-per-SF, owner location, manual-review bucket). Numeric bounds are null-
// inclusive: a row with the field absent
// passes through, so setting e.g. clear-height only narrows the markets that
// carry that data (same semantics as the old map).
const EMPTY_FILTERS = {
  market: 'all', ownerType: 'all', ownerLoc: 'all', bucket: 'all',
  clearMax: '', yearMin: '', yearMax: '', sfMin: '', sfMax: '',
  distMax: '', holdMin: '', heldSince: '',
  saleYearMin: '', salePriceMin: '', salePriceMax: '', salePsfMax: '',
  sig: { oos: false, tax: false, code: false, permit: false, vacant: false, distress: false, contact: false, lease: false },
}
const numInput = 'height:32px;padding:0 9px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px;outline:none;width:100%;'

export default function App() {
  const [theme, setTheme] = useState('dark')
  const [module, setModule] = useState('properties')
  const [view, setView] = useState('map')          // ← default view = Map
  const [channel, setChannel] = useState('both')
  const [score, setScore] = useState({ Actionable: true, Tentative: true, Pass: true })
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [q, setQ] = useState('')                 // search: address · owner · broker · APN · contact
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const toggleSig = (k) => setFilters((f) => ({ ...f, sig: { ...f.sig, [k]: !f.sig[k] } }))
  const [selProps, setSelProps] = useState([])
  const [selBrokers, setSelBrokers] = useState([])
  const [drawerId, setDrawerId] = useState(null)
  const [mapStyle, setMapStyle] = useState('sat')   // ← default basemap = Satellite

  const [sourcing, setSourcing] = useState(false)
  const [total, setTotal] = useState(TOTAL_UNIVERSE)
  const [newCount, setNewCount] = useState(0)
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
    const merged = liveProps ? [...base.filter((p) => p.channel !== 'on'), ...liveProps] : base
    const props = onlyAllowed(merged)
    const brokers = liveOn?.brokers?.length ? liveOn.brokers : (d?.brokers?.length ? d.brokers : BROKERS)
    setDataset({
      props, brokers, isReal: hasReal || Boolean(liveProps),
      counts: { ...(hasReal ? d.counts : null), props: props.length },
      meta: hasReal ? { compMax: d.compMax, cityCeil: d.cityCeil, cityLive: d.cityLive } : undefined,
    })
    setTotal(props.length)
  }, [realData, liveOn])
  const propsData = dataset.props
  const brokersData = dataset.brokers

  // mobile shell state
  const [railOpen, setRailOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)

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
    setNewCount(running ? Math.max(0, totalListings - runBase.current) : (s.listings_found || 0))
    const max = Math.max(1, ...Object.values(counts))
    setSources((prev) => prev.map((x) => ({ ...x, p: (counts[x.key] || 0) / max, c: counts[x.key] || 0 })))
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
    const t = setInterval(tick, sourcing ? 3000 : 60000)
    return () => { alive = false; clearInterval(t) }
  }, [sourcing])

  // derived
  const ql = q.trim().toLowerCase()
  // memoized so unrelated state churn (the 3s/60s live-status poller) keeps the
  // array identity stable — otherwise DealMap re-renders every tick and Leaflet
  // tears down / re-adds markers, flickering any open popup
  const visibleProps = useMemo(() => propsData.filter((p) => {
    if (!(channel === 'both' || p.channel === channel) || !score[p.cat]) return false
    if (ql) {
      const hay = `${p.addr} ${p.owner || ''} ${p.broker || ''} ${p.firm || ''} ${p.apn || ''} ${p.mkt || ''} ${p.person || ''} ${(p.phones || []).join(' ')} ${(p.emails || []).join(' ')}`.toLowerCase()
      if (!hay.includes(ql)) return false
    }
    if (filters.market !== 'all' && p.mkt !== filters.market) return false
    if (filters.sfMin && p.sf < +filters.sfMin) return false
    if (filters.sfMax && p.sf > +filters.sfMax) return false
    // clear height is a MAX (buy-box targets older, lower-clear stock) — null-inclusive
    if (filters.clearMax && p.clear != null && p.clear > +filters.clearMax) return false
    if (filters.yearMin && p.year != null && p.year < +filters.yearMin) return false
    if (filters.yearMax && p.year != null && p.year > +filters.yearMax) return false
    if (filters.distMax && p.distMi != null && p.distMi > +filters.distMax) return false
    if (filters.holdMin && p.holdYears != null && p.holdYears < +filters.holdMin) return false
    // "held since ≤ Y" = current owner acquired in/before year Y (long-held);
    // rows with no recorded sale drop out when set — same as the old map
    if (filters.heldSince && (!p.lastSale || +String(p.lastSale).slice(0, 4) > +filters.heldSince)) return false
    // previous-sale screens — null-inclusive: rows with no recorded sale pass through
    if (filters.saleYearMin && p.lastSale && +String(p.lastSale).slice(0, 4) < +filters.saleYearMin) return false
    if (filters.salePriceMin && p.lastPrice != null && p.lastPrice < +filters.salePriceMin) return false
    if (filters.salePriceMax && p.lastPrice != null && p.lastPrice > +filters.salePriceMax) return false
    // $/SF only on clean single-parcel trades — bulk/portfolio sales skew per-SF
    if (filters.salePsfMax && p.lastPrice != null && p.sf > 0 && (p.parcelsInSale ?? 1) === 1 && p.lastPrice / p.sf > +filters.salePsfMax) return false
    if (filters.ownerType !== 'all' && p.ownerType !== filters.ownerType) return false
    if (filters.ownerLoc === 'out' && !p.oos) return false
    if (filters.ownerLoc === 'in' && (p.channel !== 'off' || p.oos)) return false
    if (filters.bucket === 'universe' && p.bucket && p.bucket !== 'universe') return false
    if (filters.bucket === 'review' && p.bucket !== 'manual review') return false
    const sg = filters.sig
    if (sg.oos && !p.oos) return false
    if (sg.tax && !(p.comp && p.comp.tax_delinquency > 0)) return false
    if (sg.code && !(p.comp && p.comp.code_violations > 0)) return false
    if (sg.permit && !(p.nPermit > 0)) return false
    if (sg.vacant && !(p.comp && p.comp.vacancy_evidence > 0)) return false
    if (sg.distress && !(p.nViol > 0 || p.nPermit > 0 || p.sigs?.length > 0)) return false
    if (sg.contact && (p.contact === 'No contact' || p.contact === 'Listing only')) return false
    if (sg.lease && !p.lease) return false
    return true
  }), [propsData, ql, channel, score, filters])
  const matchShown = visibleProps.length
  const showEmpty = matchShown === 0 && (view === 'table' || view === 'map')
  const bulkCount = view === 'brokers' ? selBrokers.length : selProps.length
  const showBulk = bulkCount > 0 && (view === 'table' || view === 'brokers')
  const drawerProp = drawerId != null ? propsData.find((p) => p.id === drawerId) : null
  const allPropsSel = visibleProps.length > 0 && visibleProps.every((p) => selProps.includes(p.id))
  const allBrokSel = brokersData.length > 0 && brokersData.every((b) => selBrokers.includes(b.id))
  const aggP = sources.reduce((a, b) => a + b.p, 0) / sources.length

  const disabledScores = SCORE_CATS.filter((c) => !score[c])
  const activeChips = [
    ...(ql ? [{ label: `“${q.trim()}”`, onClear: () => setQ('') }] : []),
    ...(channel !== 'both' ? [{ label: channel === 'off' ? 'Off-market only' : 'On-market only', onClear: () => setChannel('both') }] : []),
    ...disabledScores.map((c) => ({ label: `− ${c}`, onClear: () => setScore((s) => ({ ...s, [c]: true })) })),
    ...(filters.market !== 'all' ? [{ label: filters.market, onClear: () => setF('market', 'all') }] : []),
    ...(filters.sfMin ? [{ label: `SF ≥ ${fmtInt(+filters.sfMin)}`, onClear: () => setF('sfMin', '') }] : []),
    ...(filters.sfMax ? [{ label: `SF ≤ ${fmtInt(+filters.sfMax)}`, onClear: () => setF('sfMax', '') }] : []),
    ...(filters.clearMax ? [{ label: `Clear ≤ ${filters.clearMax} ft`, onClear: () => setF('clearMax', '') }] : []),
    ...(filters.yearMin ? [{ label: `Built ≥ ${filters.yearMin}`, onClear: () => setF('yearMin', '') }] : []),
    ...(filters.yearMax ? [{ label: `Built ≤ ${filters.yearMax}`, onClear: () => setF('yearMax', '') }] : []),
    ...(filters.distMax ? [{ label: `≤ ${filters.distMax} mi to core`, onClear: () => setF('distMax', '') }] : []),
    ...(filters.holdMin ? [{ label: `Held ≥ ${filters.holdMin} yr`, onClear: () => setF('holdMin', '') }] : []),
    ...(filters.heldSince ? [{ label: `Held since ≤ ${filters.heldSince}`, onClear: () => setF('heldSince', '') }] : []),
    ...(filters.saleYearMin ? [{ label: `Sold ≥ ${filters.saleYearMin}`, onClear: () => setF('saleYearMin', '') }] : []),
    ...(filters.salePriceMin ? [{ label: `Sale ≥ $${fmtInt(+filters.salePriceMin)}`, onClear: () => setF('salePriceMin', '') }] : []),
    ...(filters.salePriceMax ? [{ label: `Sale ≤ $${fmtInt(+filters.salePriceMax)}`, onClear: () => setF('salePriceMax', '') }] : []),
    ...(filters.salePsfMax ? [{ label: `Sale ≤ $${filters.salePsfMax}/SF`, onClear: () => setF('salePsfMax', '') }] : []),
    ...(filters.ownerType !== 'all' ? [{ label: filters.ownerType, onClear: () => setF('ownerType', 'all') }] : []),
    ...(filters.ownerLoc !== 'all' ? [{ label: filters.ownerLoc === 'out' ? 'Out-of-state owner' : 'In-state owner', onClear: () => setF('ownerLoc', 'all') }] : []),
    ...(filters.bucket !== 'all' ? [{ label: filters.bucket === 'universe' ? 'Scored universe only' : 'Manual review only', onClear: () => setF('bucket', 'all') }] : []),
    ...SIG_DEFS.filter(([k]) => filters.sig[k]).map(([k]) => ({ label: SIG_LABEL[k], onClear: () => toggleSig(k) })),
  ]
  const filterCount = activeChips.length

  const ownerOrBroker = (p) => (p.channel === 'off' ? p.owner : `${p.broker} · ${p.firm}`)
  const cardSub = (p) => (p.channel === 'off' ? p.ownerType : p.daysOn != null ? `${p.daysOn} DOM` : p.firm)
  const toggleProp = (id) => setSelProps((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleBrok = (id) => setSelBrokers((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const selAllProps = () => setSelProps(allPropsSel ? [] : visibleProps.map((p) => p.id))
  const selAllBrok = () => setSelBrokers(allBrokSel ? [] : brokersData.map((b) => b.id))
  const clearSel = () => (view === 'brokers' ? setSelBrokers([]) : setSelProps([]))
  const setCh = (c) => setChannel(c)
  const toggleScore = (k) => setScore((s) => ({ ...s, [k]: !s[k] }))
  const clearAll = () => { setChannel('both'); setScore({ Actionable: true, Tentative: true, Pass: true }); setFilters(EMPTY_FILTERS); setQ('') }

  // Honest data-coverage note (ported from the off-market map): clear-height /
  // year-built only exist in some markets — those filters narrow the markets that
  // HAVE the data and leave the rest unchanged (bounds are null-inclusive).
  const covNote = (() => {
    const off = propsData.filter((p) => p.channel === 'off')
    if (!off.length) return ''
    const mkts = [...new Set(off.map((p) => p.mkt).filter(Boolean))].sort()
    const chMkts = mkts.filter((m) => off.some((p) => p.mkt === m && p.clear != null))
    const yrMiss = mkts.filter((m) => !off.some((p) => p.mkt === m && p.year))
    const n = []
    if (chMkts.length < mkts.length) n.push(`Clear-height data: ${chMkts.join(', ') || 'none'} only`)
    if (yrMiss.length) n.push(`Year built: not yet in ${yrMiss.join(', ')}`)
    return n.length ? `${n.join(' · ')}. Those filters narrow the markets that have the data and leave the rest unchanged.` : ''
  })()
  const goModule = (m) => { setModule(m); setRailOpen(false); setSearchOpen(false); setStatusOpen(false); setAcctOpen(false) }
  // Apply a validated patch from the filter chat (server whitelists every value).
  const FILTER_KEYS = ['market', 'ownerType', 'ownerLoc', 'bucket', 'clearMax', 'yearMin', 'yearMax', 'sfMin', 'sfMax', 'distMax', 'holdMin', 'heldSince', 'saleYearMin', 'salePriceMin', 'salePriceMax', 'salePsfMax']
  const applyChatPatch = (p) => {
    if (p.reset) {
      setScore({ Actionable: true, Tentative: true, Pass: true })
      setChannel('both')
      setQ('')
    }
    if (p.channel) setChannel(p.channel)
    if (p.score) setScore((s) => ({ ...s, ...p.score }))
    setFilters((f) => {
      const base = p.reset ? EMPTY_FILTERS : f
      const next = { ...base, sig: { ...base.sig, ...(p.sig || {}) } }
      for (const k of FILTER_KEYS) if (p[k] !== undefined) next[k] = p[k]
      return next
    })
    if (p.q !== undefined) setQ(p.q)
    if (p.view) setView(p.view)
  }

  // Start/stop the REAL scrape job on the server. Optimistic flip; the status
  // poller is the source of truth and corrects state within one tick.
  const startSourcing = async () => {
    setNewCount(0)
    setLastUpdated('just now')
    setSourcing(true)
    try { await liveScrape({}) } catch (e) { console.error('[sourcing] start failed', e); setSourcing(false) }
  }
  const stopSourcing = async () => {
    try { await liveStop() } catch (e) { console.error('[sourcing] stop failed', e) }
    setSourcing(false)
  }

  const TABS = [
    { k: 'map', label: 'Map', icon: 'map' },
    { k: 'table', label: 'Properties', icon: 'list' },
    { k: 'brokers', label: 'Brokers', icon: 'users' },
  ]
  const headerTitle = view === 'brokers' ? 'Brokers' : 'All properties'
  const me = identity() // signed-in account for the avatar + menu (was hard-coded "J. Simi")

  return (
    <div data-theme={theme} style={css('display:flex;flex-direction:column;height:100vh;background:var(--bg);color:var(--text);font-size:13px;line-height:1.45;overflow:hidden;')}>

      {/* ===================== TOP BAR ===================== */}
      <div className="topbar" style={css('display:flex;align-items:center;gap:16px;height:52px;flex:0 0 52px;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--border);')}>
        <div style={css('display:flex;align-items:center;gap:9px;')}>
          <div style={css('width:18px;height:18px;border-radius:4px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-dim);')} />
          <span style={css('font-weight:600;letter-spacing:-.01em;')}>SimiCapital</span>
          <span className="brand-suffix" style={css('color:var(--text3);')}>·</span>
          <span className="brand-suffix" style={css('color:var(--text2);font-weight:500;')}>Sourcing</span>
        </div>
        <div className="sample-pill" title={dataset.isReal ? `Live sourced data — ${fmtInt(dataset.counts?.props ?? propsData.length)} records (owner/broker PII · not committed)` : 'All records shown are sample data'} style={css(`display:flex;align-items:center;gap:6px;height:22px;padding:0 9px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;color:var(--text2);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;`)}><span style={css(`width:5px;height:5px;border-radius:50%;background:${dataset.isReal ? 'var(--accent)' : 'var(--text3)'};`)} />{dataset.isReal ? `Live data · ${fmtInt(dataset.counts?.props ?? propsData.length)}` : 'Sample data'}</div>
        <button className="markets-btn hov" aria-label="Select markets" style={css('display:flex;align-items:center;gap:8px;height:30px;padding:0 11px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12.5px;')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:var(--accent);')} />All markets<Icon name="chevronDown" size={11} sw={2} style={css('color:var(--text3);')} />
        </button>

        <div style={css('flex:1;')} />

        {!sourcing ? (
          <button className="sourcing-full hov tap" onClick={startSourcing} style={css('display:flex;align-items:center;gap:8px;height:32px;padding:0 16px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12.5px;box-shadow:0 0 0 1px var(--accent-line);')}>
            <span style={css('width:7px;height:7px;border-radius:50%;background:#06120F;')} />Keep Sourcing
          </button>
        ) : (
          <div className="sourcing-full" style={css('display:flex;align-items:center;gap:11px;height:42px;padding:0 7px 0 13px;background:var(--surface2);border:1px solid var(--accent-line);border-radius:9px;box-shadow:0 0 0 3px var(--accent-dim);')}>
            <span style={css('flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.1s infinite;')} />
            <div style={css('display:flex;flex-direction:column;gap:5px;width:248px;')}>
              <div style={css('display:flex;align-items:center;gap:7px;white-space:nowrap;')}>
                <span style={css('font-weight:600;font-size:12px;')}>Sourcing</span>
                <span style={css('font-family:var(--mono);font-size:12px;color:var(--text);')}>{fmtInt(total)}</span>
                <span style={css('color:var(--text3);font-size:11px;')}>·</span>
                <span style={css('font-family:var(--mono);font-size:12px;color:var(--accent);')}>+{newCount} new</span>
              </div>
              <div className="src-strip" style={css('display:flex;gap:6px;')}>
                {sources.map((s) => (
                  <div key={s.n} title={s.n} style={css('flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;')}>
                    <div style={css('height:3px;border-radius:2px;background:var(--border2);overflow:hidden;')}><div style={css(`height:100%;width:${Math.round(s.p * 100)}%;background:var(--accent);border-radius:2px;transition:width .25s;`)} /></div>
                    <span style={css('font-size:8px;letter-spacing:.02em;color:var(--text3);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{s.short}</span>
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
            <button className="hov" onClick={stopSourcing} style={css('flex:0 0 auto;height:28px;padding:0 12px;background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:11.5px;font-weight:500;')}>Stop</button>
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
          <button className="hov" onClick={() => goModule('caller')} style={css(seg(module === 'caller'))}>AI Caller</button>
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
          <div style={css('flex:1;display:flex;min-height:0;min-width:0;')}>
            {/* FILTER RAIL */}
            <div className="props-rail" data-open={railOpen ? '1' : '0'} style={css('flex:0 0 256px;border-right:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;min-height:0;')}>
              <div className="rail-close" style={css('align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border);')}>
                <span style={css('font-size:13px;font-weight:600;')}>Filters</span>
                <button onClick={() => setRailOpen(false)} aria-label="Close filters" className="tap" style={css('display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;color:var(--text2);')}><Icon name="x" size={15} /></button>
              </div>
              <div style={css('flex:1;overflow-y:auto;padding:14px 14px 8px;')}>
                <FilterChat state={{ channel, score, filters, q, view }} onPatch={applyChatPatch} />
                <div style={css(railLabel)}>Channel</div>
                <div style={css('display:flex;gap:4px;padding:3px;background:var(--surface2);border-radius:7px;margin-bottom:20px;')}>
                  <button className="hov" onClick={() => setCh('off')} style={css(chSeg(channel === 'off'))}><span style={css('width:7px;height:7px;border-radius:2px;background:var(--off);flex:0 0 auto;')} />Off-market</button>
                  <button className="hov" onClick={() => setCh('on')} style={css(chSeg(channel === 'on'))}><span style={css('width:7px;height:7px;border-radius:50%;background:var(--on);flex:0 0 auto;')} />On-market</button>
                  <button className="hov" onClick={() => setCh('both')} style={css(chSeg(channel === 'both'))}>Both</button>
                </div>

                <div style={css(railLabel)}>Score</div>
                <div style={css('display:flex;gap:6px;margin-bottom:14px;')}>
                  {SCORE_CATS.map((k) => (
                    <button key={k} className="hov" onClick={() => toggleScore(k)} style={css(scChipFilter(score[k], k))}><span style={css(`width:6px;height:6px;border-radius:50%;background:var(${catVar(k)});flex:0 0 auto;`)} />{k}</button>
                  ))}
                </div>
                <div style={css('margin-bottom:20px;')}>
                  <div style={css('display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:7px;')}><span>Distress score (off-market)</span><span style={css('font-family:var(--mono);color:var(--text2);')}>0–100</span></div>
                  <div style={css('position:relative;height:4px;border-radius:2px;background:var(--surface3);')}>
                    <div style={css('position:absolute;left:24%;right:8%;top:0;bottom:0;background:var(--accent);border-radius:2px;')} />
                    <div style={css('position:absolute;left:24%;top:50%;width:12px;height:12px;border-radius:50%;background:var(--text);transform:translate(-50%,-50%);')} />
                    <div style={css('position:absolute;left:92%;top:50%;width:12px;height:12px;border-radius:50%;background:var(--text);transform:translate(-50%,-50%);')} />
                  </div>
                </div>

                <div style={css(railLabel)}>Filters</div>
                <div style={css('display:flex;flex-direction:column;gap:11px;')}>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Search</label><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address · owner · APN · contact" aria-label="Search properties" style={css(numInput)} /></div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Market / metro</label><select value={filters.market} onChange={(e) => setF('market', e.target.value)} style={css(selectStyle)} aria-label="Market"><option value="all">All markets</option>{MARKETS.filter((m) => ALLOWED_MARKETS.has(m)).map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Source</label><select style={css(selectStyle)} aria-label="Source"><option>All sources</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
                  <div style={css('display:flex;gap:8px;')}>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Min SF</label><input type="number" value={filters.sfMin} onChange={(e) => setF('sfMin', e.target.value)} placeholder="≥ 60,000" aria-label="Minimum building SF" style={css(numInput)} /></div>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Max SF</label><input type="number" value={filters.sfMax} onChange={(e) => setF('sfMax', e.target.value)} placeholder="≤ 300,000" aria-label="Maximum building SF" style={css(numInput)} /></div>
                  </div>
                  <div style={css('display:flex;gap:8px;')}>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Max clear ht (ft)</label><input type="number" value={filters.clearMax} onChange={(e) => setF('clearMax', e.target.value)} placeholder="≤ 24" aria-label="Maximum clear height" style={css(numInput)} /></div>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Max mi to core</label><input type="number" value={filters.distMax} onChange={(e) => setF('distMax', e.target.value)} placeholder="≤ 10" aria-label="Maximum miles to core" style={css(numInput)} /></div>
                  </div>
                  <div style={css('display:flex;gap:8px;')}>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Min year built</label><input type="number" value={filters.yearMin} onChange={(e) => setF('yearMin', e.target.value)} placeholder="≥ 1960" aria-label="Minimum year built" style={css(numInput)} /></div>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Max year built</label><input type="number" value={filters.yearMax} onChange={(e) => setF('yearMax', e.target.value)} placeholder="≤ 1990" aria-label="Maximum year built" style={css(numInput)} /></div>
                  </div>
                  <div style={css('display:flex;gap:8px;')}>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Min hold (yr)</label><input type="number" value={filters.holdMin} onChange={(e) => setF('holdMin', e.target.value)} placeholder="≥ 10" aria-label="Minimum hold years" style={css(numInput)} /></div>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Held since ≤</label><input type="number" value={filters.heldSince} onChange={(e) => setF('heldSince', e.target.value)} placeholder="2010" aria-label="Acquired in or before year" style={css(numInput)} /></div>
                  </div>
                  <div style={css('display:flex;gap:8px;')}>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Min sale price ($)</label><input type="number" value={filters.salePriceMin} onChange={(e) => setF('salePriceMin', e.target.value)} placeholder="≥ 1,000,000" aria-label="Minimum last sale price" style={css(numInput)} /></div>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Max sale price ($)</label><input type="number" value={filters.salePriceMax} onChange={(e) => setF('salePriceMax', e.target.value)} placeholder="≤ 10,000,000" aria-label="Maximum last sale price" style={css(numInput)} /></div>
                  </div>
                  <div style={css('display:flex;gap:8px;')}>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Sold since ≥</label><input type="number" value={filters.saleYearMin} onChange={(e) => setF('saleYearMin', e.target.value)} placeholder="2018" aria-label="Last sale in or after year" style={css(numInput)} /></div>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Max sale $/SF</label><input type="number" value={filters.salePsfMax} onChange={(e) => setF('salePsfMax', e.target.value)} placeholder="≤ 80" aria-label="Maximum last sale price per SF" style={css(numInput)} /></div>
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Owner type</label><select value={filters.ownerType} onChange={(e) => setF('ownerType', e.target.value)} style={css(selectStyle)} aria-label="Owner type"><option value="all">Any owner type</option><option>LLC</option><option>Trust</option><option>Individual</option><option>Partnership</option><option>Corp</option></select></div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Owner location</label><select value={filters.ownerLoc} onChange={(e) => setF('ownerLoc', e.target.value)} style={css(selectStyle)} aria-label="Owner location"><option value="all">Any owner location</option><option value="in">In-state owner</option><option value="out">Out-of-state owner</option></select></div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Parcels</label><select value={filters.bucket} onChange={(e) => setF('bucket', e.target.value)} style={css(selectStyle)} aria-label="Parcel bucket"><option value="all">All parcels</option><option value="universe">Scored universe only</option><option value="review">60–75k manual review only</option></select></div>
                </div>

                <div style={css(railLabel + 'margin:20px 0 10px;')}>Signals</div>
                <div style={css('display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:var(--text);')}>
                  {SIG_DEFS.map(([k, label]) => (
                    <label key={k} style={css('display:flex;align-items:center;gap:9px;cursor:pointer;')}><input type="checkbox" checked={filters.sig[k]} onChange={() => toggleSig(k)} style={css('accent-color:var(--accent);width:15px;height:15px;')} />{label}</label>
                  ))}
                </div>
                {covNote && <div style={css('margin-top:16px;padding-top:10px;border-top:1px solid var(--border);font-size:10.5px;color:var(--text3);line-height:1.55;')}>{covNote}</div>}
              </div>
              <div style={css('flex:0 0 auto;border-top:1px solid var(--border);padding:11px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
                <span style={css('font-size:12px;')}><span style={css('font-family:var(--mono);font-weight:600;color:var(--text);')}>{fmtInt(matchShown)}</span><span style={css('color:var(--text2);')}> of {fmtInt(propsData.length)} match</span></span>
                <div style={css('display:flex;gap:8px;')}>
                  <button className="hov" onClick={clearAll} style={css('background:none;border:none;color:var(--accent);font-size:11.5px;font-weight:500;')}>Clear all</button>
                  <button className="rail-close tap hov" onClick={() => setRailOpen(false)} style={css('height:30px;padding:0 16px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12px;')}>Apply</button>
                </div>
              </div>
            </div>
            {railOpen && <div onClick={() => setRailOpen(false)} style={css('position:absolute;inset:0;background:rgba(0,0,0,.5);z-index:55;animation:fadein .15s ease;')} />}

            {/* CONTENT */}
            <div style={css('flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;')}>
              {/* header row */}
              <div style={css('display:flex;align-items:center;gap:12px;height:46px;flex:0 0 46px;padding:0 16px;border-bottom:1px solid var(--border);background:var(--bg);')}>
                <button className="filters-btn tap hov" onClick={() => setRailOpen(true)} aria-label="Open filters" style={css('align-items:center;gap:7px;height:30px;padding:0 12px;background:var(--surface);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12px;')}><Icon name="funnel" size={13} />Filters{filterCount > 0 && <span style={css('display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;background:var(--accent);color:#06120F;border-radius:8px;font-size:10px;font-weight:600;')}>{filterCount}</span>}</button>
                <span className="hide-phone" style={css('font-weight:600;font-size:13.5px;')}>{headerTitle}</span>
                <span className="hide-phone" style={css('font-family:var(--mono);font-size:11.5px;color:var(--text2);padding:2px 7px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;')}>{view === 'brokers' ? brokersData.length : matchShown} {view === 'brokers' ? 'brokers' : 'matching'}</span>
                <div className="legend-phone" style={css('align-items:center;gap:12px;font-size:10.5px;color:var(--text2);font-family:var(--mono);')}>
                  <span style={css('display:flex;align-items:center;gap:5px;')}><span style={css('width:8px;height:8px;border-radius:50%;border:2px solid var(--off);box-sizing:border-box;')} />Off</span>
                  <span style={css('display:flex;align-items:center;gap:5px;')}><span style={css('width:8px;height:8px;border-radius:50%;background:var(--on);')} />On</span>
                </div>
                <div style={css('flex:1;')} />
              </div>

              {/* view tab row — moved UNDER "All properties", more visual */}
              <div style={css('display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:0 10px;border-bottom:1px solid var(--border);background:var(--bg);')}>
                {TABS.map((t) => (
                  <button key={t.k} className="tap hov" onClick={() => setView(t.k)} style={css(viewTab(view === t.k))}><Icon name={t.icon} size={15} sw={1.8} />{t.label}</button>
                ))}
              </div>

              {/* active filter chips */}
              {activeChips.length > 0 && (
                <div className="active-chips" style={css('gap:7px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--bg);')}>
                  {activeChips.map((c, i) => (
                    <button key={i} onClick={c.onClear} style={css('display:flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 11px;background:var(--surface2);border:1px solid var(--border2);border-radius:14px;color:var(--text);font-size:11.5px;')}>{c.label}<Icon name="x" size={12} sw={2.2} style={css('color:var(--text3);')} /></button>
                  ))}
                </div>
              )}

              {/* TABLE / CARD-LIST */}
              {view === 'table' && !showEmpty && (
                <>
                  <div className="data-table-wrap" style={css('flex:1;overflow:auto;min-height:0;')}>
                    <table style={css('width:100%;border-collapse:collapse;font-size:12.5px;')}>
                      <thead><tr style={css('position:sticky;top:0;z-index:2;background:var(--surface);')}>
                        <th style={css('width:34px;padding:9px 0 9px 14px;border-bottom:1px solid var(--border);')}><input type="checkbox" checked={allPropsSel} onChange={selAllProps} aria-label="Select all" style={css('accent-color:var(--accent);')} /></th>
                        {[th('left'), th('left'), th('left'), th('right'), th('left'), th('left'), th('left'), th('right', 'col-secondary'), th('right', 'col-secondary'), th('right', 'col-secondary'), th('right', 'col-secondary'), th('right', 'col-secondary'), th('left', 'col-secondary')].map((c, i) => (
                          <th key={i} className={c.cls} style={css(c.s)}>{['CH', 'ADDRESS', 'MARKET', 'SF', 'SCORE', 'KEY SIGNAL', 'OWNER / BROKER', 'ASK $/SF', 'YEAR', 'CLR FT', 'DIST MI', 'HELD YR', 'CONTACT'][i]}</th>
                        ))}
                        <th style={css('width:28px;border-bottom:1px solid var(--border);')} />
                      </tr></thead>
                      <tbody>
                        {visibleProps.map((p) => (
                          <tr key={p.id} className="hov" tabIndex={0} role="button" onClick={() => setDrawerId(p.id)} style={css(rowStyle(p.cat))}>
                            <td style={css('padding:0 0 0 14px;')} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selProps.includes(p.id)} onChange={() => toggleProp(p.id)} aria-label="Select property" style={css('accent-color:var(--accent);')} /></td>
                            <td style={css('padding:9px 8px;')}><span style={css(chDot(p.channel))} /></td>
                            <td style={css('padding:9px 8px;font-weight:500;white-space:nowrap;')}>{p.addr}{p.lease && <a href={p.lease.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={`${p.lease.note} — open on LoopNet`} style={css('display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:10px;font-weight:600;color:var(--green);background:var(--green-tint);border:1px solid var(--border);padding:2px 7px;border-radius:5px;text-decoration:none;vertical-align:middle;')}>For Lease<Icon name="chevronRight" size={9} sw={2.4} /></a>}</td>
                            <td style={css('padding:9px 8px;color:var(--text2);')}>{p.mkt}</td>
                            <td style={css('padding:9px 8px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;')}>{fmtSF(p.sf)}</td>
                            <td style={css('padding:9px 8px;')}><span style={css('display:inline-flex;align-items:center;gap:6px;')}><span style={css(scDot(p.cat))} /><span style={css(scLabel(p.cat))}>{p.cat}</span><span style={css('font-family:var(--mono);font-size:11.5px;color:var(--text3);')}>{p.score}</span></span></td>
                            <td style={css('padding:9px 8px;color:var(--text2);font-size:12px;white-space:nowrap;')}>{p.signal}</td>
                            <td style={css('padding:9px 8px;color:var(--text2);white-space:nowrap;')}>{ownerOrBroker(p)}</td>
                            <td className="col-secondary" style={css('padding:9px 8px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--text2);')}>{p.channel === 'on' ? fmtMoney2(p.ask) : '—'}</td>
                            <td className="col-secondary" style={css('padding:9px 8px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--text2);')}>{p.year ?? '—'}</td>
                            <td className="col-secondary" style={css('padding:9px 8px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--text2);')}>{p.clear ?? '—'}</td>
                            <td className="col-secondary" style={css('padding:9px 8px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--text2);')}>{p.distMi ?? '—'}</td>
                            <td className="col-secondary" style={css('padding:9px 8px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--text2);')}>{p.holdYears != null ? Math.round(p.holdYears) : '—'}</td>
                            <td className="col-secondary" style={css('padding:9px 8px;')}><span title={p.person || undefined} style={css(contactStyle(p.contact))}>{p.contact}</span></td>
                            <td style={css('padding:9px 14px 9px 4px;text-align:right;color:var(--text3);')}><Icon name="chevronRight" size={14} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-list" style={css('flex-direction:column;flex:1;overflow-y:auto;min-height:0;')}>
                    {visibleProps.map((p) => (
                      <div key={p.id} className="hov" tabIndex={0} role="button" onClick={() => setDrawerId(p.id)} style={css(cardStyle(p.cat))}>
                        <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css(scDot(p.cat))} /><span style={css('font-weight:600;font-size:14.5px;flex:1;')}>{p.addr}</span><Icon name="chevronRight" size={16} stroke="var(--text3)" /></div>
                        <div style={css('display:flex;align-items:center;gap:8px;flex-wrap:wrap;')}><span style={css(chTag(p.channel))}>{chLabel(p.channel)}</span><span style={css(scChip(p.cat))}><span style={css(scDot(p.cat))} />{p.cat} · {p.score}</span>{p.lease && <a href={p.lease.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={css('font-size:11px;font-weight:600;color:var(--green);background:var(--green-tint);border:1px solid var(--border);padding:2px 8px;border-radius:5px;text-decoration:none;')}>For Lease</a>}</div>
                        <div style={css('display:flex;gap:16px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{p.mkt}</span><span style={css('font-family:var(--mono);')}>{fmtSF(p.sf)} SF</span><span>{cardSub(p)}</span></div>
                        <div style={css('font-size:11.5px;color:var(--text3);')}>{p.signal}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* BROKERS */}
              {view === 'brokers' && (
                <>
                  <div className="data-table-wrap" style={css('flex:1;overflow:auto;min-height:0;')}>
                    <table style={css('width:100%;border-collapse:collapse;font-size:12.5px;')}>
                      <thead><tr style={css('position:sticky;top:0;z-index:2;background:var(--surface);')}>
                        <th style={css('width:34px;padding:9px 0 9px 14px;border-bottom:1px solid var(--border);')}><input type="checkbox" checked={allBrokSel} onChange={selAllBrok} aria-label="Select all brokers" style={css('accent-color:var(--accent);')} /></th>
                        {[th('left'), th('left'), th('left', 'col-secondary'), th('left'), th('left', 'col-secondary'), th('left'), th('right'), th('left'), th('left', 'col-secondary')].map((c, i) => (
                          <th key={i} className={c.cls} style={css(c.s)}>{['BROKER', 'FIRM', 'PHONE', 'CELL', 'EMAIL', 'MARKET(S)', '# LIST', 'PIPEDRIVE', 'ACTIONS'][i]}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {brokersData.map((b) => (
                          <tr key={b.id} className="hov" style={css('border-bottom:1px solid var(--border);')}>
                            <td style={css('padding:0 0 0 14px;')}><input type="checkbox" checked={selBrokers.includes(b.id)} onChange={() => toggleBrok(b.id)} aria-label="Select broker" style={css('accent-color:var(--accent);')} /></td>
                            <td style={css('padding:10px 8px;font-weight:500;white-space:nowrap;')}>{b.name}</td>
                            <td style={css('padding:10px 8px;color:var(--text2);white-space:nowrap;')}>{b.firm}</td>
                            <td className="col-secondary" style={css('padding:10px 8px;color:var(--text2);font-family:var(--mono);font-size:11.5px;')}>{b.phone}</td>
                            <td style={css('padding:10px 8px;font-family:var(--mono);font-size:11.5px;')}><span style={css('color:var(--accent);background:var(--accent-dim);padding:2px 6px;border-radius:4px;')}>{b.cell}</span></td>
                            <td className="col-secondary" style={css('padding:10px 8px;color:var(--text2);font-size:11.5px;')}>{b.email}</td>
                            <td style={css('padding:10px 8px;color:var(--text2);white-space:nowrap;')}>{b.mkts}</td>
                            <td style={css('padding:10px 8px;text-align:right;font-family:var(--mono);')}>{b.listings}</td>
                            <td style={css('padding:10px 8px;')}><span style={css(`display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 7px;border-radius:5px;border:1px solid var(--border);${b.synced ? 'color:var(--green);background:var(--green-tint);' : 'color:var(--text3);background:var(--surface2);'}`)}>{b.synced && <Icon name="check" size={11} sw={2.4} />}{b.synced ? 'Synced' : 'Not synced'}</span></td>
                            <td className="col-secondary" style={css('padding:10px 14px 10px 8px;white-space:nowrap;')}><button className="tap hov" onClick={() => setView('table')} style={css('height:26px;padding:0 9px;background:var(--surface3);border:1px solid var(--border2);border-radius:5px;color:var(--text2);font-size:11px;')}>View listings</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-list" style={css('flex-direction:column;flex:1;overflow-y:auto;min-height:0;')}>
                    {brokersData.map((b) => (
                      <div key={b.id} style={css('display:flex;flex-direction:column;gap:9px;padding:14px 16px;border-bottom:1px solid var(--border);')}>
                        <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css('font-weight:600;font-size:14.5px;flex:1;')}>{b.name}</span><span style={css(`display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 7px;border-radius:5px;border:1px solid var(--border);${b.synced ? 'color:var(--green);background:var(--green-tint);' : 'color:var(--text3);background:var(--surface2);'}`)}>{b.synced && <Icon name="check" size={11} sw={2.4} />}{b.synced ? 'Synced' : 'Not synced'}</span></div>
                        <div style={css('display:flex;gap:16px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{b.firm}</span><span>{b.mkts}</span><span style={css('font-family:var(--mono);')}>{b.listings} listings</span></div>
                        <div style={css('display:flex;align-items:center;gap:10px;')}><span style={css('font-family:var(--mono);font-size:11.5px;color:var(--accent);background:var(--accent-dim);padding:2px 7px;border-radius:4px;')}>{b.cell}</span><button className="tap hov" onClick={() => setView('table')} style={css('margin-left:auto;height:30px;padding:0 12px;background:var(--surface3);border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:11.5px;')}>View listings</button></div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* MAP */}
              {view === 'map' && !showEmpty && (
                // isolation contains Leaflet's internal z-indexes (panes 200-700, controls 1000, our overlays 1100) so the detail drawer (z-index 26) can sit above the whole map
                <div className="map-view" data-map={mapStyle} style={css('flex:1;position:relative;isolation:isolate;min-height:0;overflow:hidden;background:var(--map-land);')}>
                  <DealMap props={visibleProps} meta={dataset.meta} mapStyle={mapStyle} theme={theme} onOpen={setDrawerId} />

                  <div style={css('position:absolute;top:12px;left:12px;display:flex;gap:2px;padding:3px;background:var(--surface);border:1px solid var(--border);border-radius:7px;z-index:1100;')}>
                    <button className="tap hov" onClick={() => setMapStyle('clean')} aria-label="Clean basemap" style={css(seg(mapStyle === 'clean') + 'height:26px;')}>Clean</button>
                    <button className="tap hov" onClick={() => setMapStyle('sat')} aria-label="Satellite basemap" style={css(seg(mapStyle === 'sat') + 'height:26px;')}>Satellite</button>
                  </div>
                  <div style={css('position:absolute;top:12px;right:12px;display:flex;flex-direction:column;gap:6px;padding:9px 11px;background:var(--surface);border:1px solid var(--border);border-radius:8px;z-index:1100;font-size:11px;color:var(--text2);')}>
                    <div style={css('display:flex;align-items:center;gap:7px;')}><span style={css('width:9px;height:9px;border-radius:50%;background:var(--green);')} />Actionable</div>
                    <div style={css('display:flex;align-items:center;gap:7px;')}><span style={css('width:9px;height:9px;border-radius:50%;background:var(--amber);')} />Tentative</div>
                    <div style={css('display:flex;align-items:center;gap:7px;')}><span style={css('width:9px;height:9px;border-radius:50%;background:var(--red);')} />Pass</div>
                    <div style={css('height:1px;background:var(--border);margin:2px 0;')} />
                    <div style={css('display:flex;align-items:center;gap:7px;')}><span style={css('width:10px;height:10px;border-radius:50%;border:2px solid var(--text2);box-sizing:border-box;')} />Off-market</div>
                    <div style={css('display:flex;align-items:center;gap:7px;')}><span style={css('display:inline-block;width:9px;height:9px;background:var(--text2);border-radius:50% 50% 50% 0;transform:rotate(-45deg);')} />On-market</div>
                  </div>
                  <div style={css('position:absolute;left:12px;bottom:12px;z-index:1100;display:flex;align-items:center;gap:7px;height:24px;padding:0 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:10.5px;')}><span style={css(`width:6px;height:6px;border-radius:50%;background:${dataset.isReal ? 'var(--accent)' : 'var(--text3)'};`)} />{fmtInt(matchShown)} mapped · {dataset.isReal ? 'live data' : 'sample'}</div>
                </div>
              )}

              {/* EMPTY */}
              {showEmpty && (
                <div style={css('flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;')}>
                  <div style={css('width:48px;height:48px;border-radius:12px;border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;color:var(--text3);')}><Icon name="slashCircle" size={22} sw={1.6} /></div>
                  <div style={css('text-align:center;')}><div style={css('font-size:14px;color:var(--text2);font-weight:500;margin-bottom:4px;')}>No properties match these filters</div><div style={css('font-size:12px;color:var(--text3);')}>Re-enable a score category or widen the channel.</div></div>
                  <button className="tap hov" onClick={clearAll} style={css('height:34px;padding:0 14px;background:var(--surface3);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12px;')}>Clear all filters</button>
                </div>
              )}

              {/* BULK BAR */}
              {showBulk && (
                <div className="bulk-bar" style={css('position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;padding:9px 10px 9px 18px;background:var(--surface3);border:1px solid var(--border2);border-radius:11px;box-shadow:0 12px 34px rgba(0,0,0,.45);z-index:20;')}>
                  <span style={css('font-size:12.5px;font-weight:500;white-space:nowrap;')}><span style={css('font-family:var(--mono);color:var(--accent);')}>{bulkCount}</span> selected</span>
                  <div style={css('width:1px;height:20px;background:var(--border2);')} />
                  <button className="tap hov" style={css('height:32px;padding:0 13px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12px;white-space:nowrap;')}>Send {bulkCount} to Pipedrive</button>
                  {view === 'table' && <button className="tap hov" style={css('height:32px;padding:0 13px;background:var(--surface);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12px;white-space:nowrap;')}>Add {bulkCount} to call queue</button>}
                  <button onClick={clearSel} aria-label="Clear selection" style={css('display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:transparent;border:none;color:var(--text3);')}><Icon name="x" size={15} /></button>
                </div>
              )}

              {/* DETAIL DRAWER */}
              {drawerProp && (
                <>
                  <div className="detail-scrim" onClick={() => setDrawerId(null)} style={css('position:absolute;inset:0;background:rgba(0,0,0,.4);z-index:25;')} />
                  <div className="detail-drawer" onClick={(e) => e.stopPropagation()} style={css('position:absolute;top:0;right:0;bottom:0;width:430px;background:var(--surface);border-left:1px solid var(--border2);z-index:26;display:flex;flex-direction:column;animation:drawerin .18s ease;box-shadow:-14px 0 40px rgba(0,0,0,.35);')}>
                    <div style={css('flex:0 0 auto;padding:16px 18px;border-bottom:1px solid var(--border);')}>
                      <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:6px;')}>
                        <span style={css(chDot(drawerProp.channel))} /><span style={css(chTag(drawerProp.channel))}>{chLabel(drawerProp.channel)}</span>
                        <button onClick={() => setDrawerId(null)} aria-label="Close detail" className="tap" style={css('display:flex;align-items:center;justify-content:center;margin-left:auto;background:none;border:none;color:var(--text3);width:30px;height:30px;')}><Icon name="x" size={17} /></button>
                      </div>
                      <div style={css('font-size:17px;font-weight:600;letter-spacing:-.01em;')}>{drawerProp.addr}</div>
                      <div style={css('color:var(--text2);font-size:12.5px;margin-top:2px;')}>{drawerProp.mkt}, {drawerProp.st}{drawerProp.apn ? ` · APN ${drawerProp.apn}` : ''}</div>
                      {drawerProp.landUse && <div style={css('color:var(--text3);font-size:11px;margin-top:2px;')}>{drawerProp.landUse}</div>}
                    </div>
                    <div style={css('flex:1;overflow-y:auto;padding:16px 18px;')}>
                      <div style={css('display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:18px;')}>
                        {[
                          ['Building SF', `${fmtSF(drawerProp.sfTotal || drawerProp.sf)}${drawerProp.buildings > 1 ? ` · ${drawerProp.buildings} bldgs` : ''}`],
                          ['Year built', drawerProp.year ?? '—'],
                          ['Clear ht', drawerProp.clear != null ? `${drawerProp.clear} ft${drawerProp.clearSrc ? ` · ${drawerProp.clearSrc}` : ''}` : '—'],
                        ].map(([l, v]) => (
                          <div key={l} style={css('background:var(--surface2);padding:10px 12px;')}><div style={css('font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;')}>{l}</div><div style={css('font-family:var(--mono);font-size:15px;margin-top:3px;')}>{v}</div></div>
                        ))}
                      </div>
                      <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;')}>
                        <div style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;')}>Score breakdown</div>
                        <span style={css('display:inline-flex;align-items:center;gap:6px;font-size:12px;')}><span style={css(scDot(drawerProp.cat))} /><span style={css(scLabel(drawerProp.cat))}>{drawerProp.cat}</span><span style={css('font-family:var(--mono);')}>{drawerProp.score}/{(drawerProp.channel === 'off' && dataset.meta?.cityCeil?.[drawerProp.mkt]) || 100}</span></span>
                      </div>
                      <div style={css('display:flex;flex-direction:column;gap:8px;margin-bottom:20px;')}>
                        {breakdownFor(drawerProp).map((c) => (
                          <div key={c.label}><div style={css('display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;')}><span style={css('color:var(--text2);')}>{c.label}</span><span style={css('font-family:var(--mono);color:var(--text3);')}>{c.val}</span></div><div style={css('height:5px;border-radius:3px;background:var(--surface3);overflow:hidden;')}><div style={css(c.barStyle)} /></div></div>
                        ))}
                      </div>
                      {drawerProp.channel === 'off' ? (
                        <>
                          <div style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:8px;')}>Owner on title</div>
                          <div style={css('background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:18px;')}>
                            <div style={css('font-weight:600;margin-bottom:4px;')}>{drawerProp.owner}</div>
                            <div style={css('font-size:11.5px;color:var(--text2);')}>{drawerProp.ownerType} · Mailing: {drawerProp.mail}</div>
                            {drawerProp.oos && <div style={css('margin-top:8px;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--off);background:rgba(147,137,214,.14);padding:3px 8px;border-radius:5px;')}><Icon name="flag" size={12} sw={1.8} />Out-of-state owner · {drawerProp.oos}</div>}
                            {(drawerProp.phones?.length || drawerProp.emails?.length || drawerProp.person) && (
                              <div style={css('margin-top:9px;padding-top:9px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text2);display:flex;flex-direction:column;gap:3px;')}>
                                {drawerProp.person && <div style={css('color:var(--text);')}>{drawerProp.person}</div>}
                                {drawerProp.phones?.length > 0 && <div style={css('font-family:var(--mono);')}>{fmtPhone(drawerProp.phones[0])}{drawerProp.phones.length > 1 ? ` · +${drawerProp.phones.length - 1} more` : ''}</div>}
                                {drawerProp.emails?.length > 0 && <div>{drawerProp.emails[0]}</div>}
                                {drawerProp.contactConf && <div style={css('font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;')}>contact confidence · {drawerProp.contactConf}</div>}
                              </div>
                            )}
                          </div>
                          <div style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:8px;')}>Distress evidence</div>
                          <div style={css('background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:18px;font-size:12px;color:var(--text2);line-height:1.7;')}>
                            {drawerProp.sigs?.length > 0
                              ? drawerProp.sigs.map((s, i) => <div key={i}>• {humanizeSig(s.type)}{s.date ? ` · ${s.date}` : ''}{s.detail ? ` — ${s.detail}` : ''}</div>)
                              : <div>• {drawerProp.signal}</div>}
                            {drawerProp.nViol > 0 && <div>• {drawerProp.nViol} code violation{drawerProp.nViol > 1 ? 's' : ''} (24mo)</div>}
                            {drawerProp.lastSale && <div>• Last sale: {drawerProp.lastSale}{drawerProp.lastPrice ? ` · $${fmtInt(drawerProp.lastPrice)}` : ''}{drawerProp.holdYears != null ? ` · held ${drawerProp.holdYears}y` : ''}</div>}
                            {drawerProp.assessed > 0 && <div>• Assessed value: ${fmtInt(drawerProp.assessed)}</div>}
                            {drawerProp.distMi != null && <div>• {drawerProp.distMi} mi from core{drawerProp.bucket === 'manual review' ? ' · 60–75k manual-review band' : ''}</div>}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:8px;')}>Listing</div>
                          <div style={css('background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:18px;')}>
                            <div style={css('display:flex;justify-content:space-between;margin-bottom:6px;')}><span style={css('font-weight:600;')}>{drawerProp.broker}</span><span style={css('font-family:var(--mono);color:var(--accent);')}>{fmtMoney2(drawerProp.ask)}/SF</span></div>
                            <div style={css('font-size:11.5px;color:var(--text2);')}>{drawerProp.firm}{drawerProp.daysOn != null ? ` · ${drawerProp.daysOn} days on market` : ''} · {drawerProp.signal}</div>
                          </div>
                        </>
                      )}
                      {drawerProp.lease && (
                        <>
                          <div style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--green);font-weight:600;margin-bottom:8px;')}>Listed for lease · LoopNet</div>
                          <div style={css('background:var(--green-tint);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:18px;')}>
                            <div style={css('font-size:11.5px;color:var(--text2);line-height:1.55;margin-bottom:10px;')}>{drawerProp.lease.note}{drawerProp.lease.n > 1 ? ` · ${drawerProp.lease.n} active listings at this address` : ''}</div>
                            <div style={css('display:flex;flex-direction:column;gap:7px;')}>
                              {(drawerProp.lease.listings || [drawerProp.lease]).map((l, i) => (
                                <a key={i} href={l.url} target="_blank" rel="noreferrer" className="tap hov" style={css('height:36px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:8px;background:var(--surface);border:1px solid var(--border2);color:var(--text);font-size:12px;font-weight:600;text-decoration:none;')}><Icon name="search" size={13} sw={1.9} />Open on LoopNet{drawerProp.lease.n > 1 ? ` · ${(l.note || l.addr).slice(0, 44)}` : ''}</a>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                      <div style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:8px;')}>Imagery</div>
                      <div style={css('display:flex;gap:8px;')}>
                        <a href={`https://www.google.com/maps/@${drawerProp.lat},${drawerProp.lng},19z/data=!3m1!1e3`} target="_blank" rel="noreferrer" className="tap hov" style={css('flex:1;height:38px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:8px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-size:12px;text-decoration:none;')}><Icon name="map" size={14} sw={1.8} />Aerial</a>
                        <a href={`https://www.google.com/maps?q=&layer=c&cbll=${drawerProp.lat},${drawerProp.lng}`} target="_blank" rel="noreferrer" className="tap hov" style={css('flex:1;height:38px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:8px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-size:12px;text-decoration:none;')}><Icon name="map" size={14} sw={1.8} />Street View</a>
                      </div>
                    </div>
                    <div style={css('flex:0 0 auto;padding:13px 18px;border-top:1px solid var(--border);display:flex;gap:9px;')}>
                      <button className="tap hov" style={css('flex:1;height:38px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12.5px;')}>{drawerProp.channel === 'off' ? 'Push owner Lead to Pipedrive' : 'Push broker Deal to Pipedrive'}</button>
                      <button className="tap hov" style={css('height:38px;padding:0 14px;background:var(--surface3);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12.5px;')}>Add to call queue</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {module === 'supply' && <SupplyModel />}
        {module === 'caller' && <AICaller />}
        {module === 'deals' && <DealsDB />}
        {module === 'reuse' && <ReuseFinder />}
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
            <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:14px;')}><span style={css(`width:9px;height:9px;border-radius:50%;background:${sourcing ? 'var(--accent)' : 'var(--text3)'};${sourcing ? 'animation:pulse 1.1s infinite;' : ''}`)} /><span style={css('font-size:15px;font-weight:600;')}>{sourcing ? 'Sourcing live' : 'Sourcing paused'}</span><button className="tap" onClick={() => setStatusOpen(false)} aria-label="Close" style={css('display:flex;align-items:center;justify-content:center;margin-left:auto;width:34px;height:34px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text2);')}><Icon name="x" size={15} /></button></div>
            <div style={css('display:flex;gap:18px;margin-bottom:16px;')}>
              <div><div style={css('font-family:var(--mono);font-size:22px;font-weight:500;')}>{fmtInt(total)}</div><div style={css('font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;')}>scanned</div></div>
              <div><div style={css('font-family:var(--mono);font-size:22px;font-weight:500;color:var(--accent);')}>+{newCount}</div><div style={css('font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;')}>new</div></div>
              <div style={css('margin-left:auto;text-align:right;')}><div style={css('font-size:11px;color:var(--text2);')}>Updated</div><div style={css('font-size:11px;color:var(--text3);')}>{lastUpdated}</div></div>
            </div>
            <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:10px;')}>Per-source</div>
            <div style={css('display:flex;flex-direction:column;gap:10px;margin-bottom:18px;')}>
              {sources.map((s) => (
                <div key={s.n}><div style={css('display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;')}><span style={css('color:var(--text2);')}>{s.n}</span><span style={css('font-family:var(--mono);color:var(--text3);')}>{fmtInt(s.c || 0)} listings</span></div><div style={css('height:5px;border-radius:3px;background:var(--surface3);overflow:hidden;')}><div style={css(`height:100%;width:${Math.round(s.p * 100)}%;background:var(--accent);border-radius:3px;`)} /></div></div>
              ))}
            </div>
            <button className="tap" onClick={() => (sourcing ? stopSourcing() : startSourcing())} style={css(`width:100%;height:48px;border-radius:9px;font-size:13.5px;font-weight:600;${sourcing ? 'background:var(--surface2);border:1px solid var(--border2);color:var(--text);' : 'background:var(--accent);border:none;color:#06120F;'}`)}>{sourcing ? 'Stop sourcing' : 'Keep Sourcing'}</button>
          </div>
        </>
      )}

      {acctOpen && (
        <>
          <div onClick={() => setAcctOpen(false)} style={css('position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:120;animation:fadein .15s ease;')} />
          <div style={css('position:fixed;left:0;right:0;bottom:0;z-index:121;background:var(--surface);border-radius:18px 18px 0 0;border-top:1px solid var(--border2);padding:18px;animation:sheetup .24s ease;')}>
            <div style={css('width:38px;height:4px;border-radius:2px;background:var(--border2);margin:0 auto 14px;')} />
            <div style={css('display:flex;align-items:center;gap:11px;margin-bottom:18px;')}><div style={css('width:42px;height:42px;border-radius:50%;background:var(--surface3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--text2);')}>{me.initials}</div><div style={css('flex:1;min-width:0;')}><div style={css('font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{me.name}</div><div style={css('font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{me.sub}</div></div><button className="tap" onClick={() => setAcctOpen(false)} aria-label="Close" style={css('display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text2);')}><Icon name="x" size={15} /></button></div>
            <button className="tap" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} style={css('display:flex;align-items:center;gap:10px;width:100%;height:48px;padding:0 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--text);font-size:13.5px;margin-bottom:10px;')}><Icon name="moon" size={17} sw={1.7} />Toggle light / dark theme</button>
            <button className="tap" onClick={signOut} style={css('display:flex;align-items:center;gap:10px;width:100%;height:48px;padding:0 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--red);font-size:13.5px;')}><Icon name="slashCircle" size={17} sw={1.7} />Sign out</button>
          </div>
        </>
      )}
    </div>
  )
}
