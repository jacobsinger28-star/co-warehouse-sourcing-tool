import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { css } from './css.js'
import { RealDataContext } from './RealDataContext.js'
import Icon from './Icon.jsx'
import { PROPS, BROKERS, SCRAPE_SOURCES, MARKETS, SOURCES } from './data.js'
import { liveScrape, liveStop, liveStatus, liveRows } from './liveApi.js'
import { identity, signOut } from './session.js'
import { addToQueue, removeFromQueue, isQueued, useQueueCount } from './callQueue.js'
import { pdStatus, pdSyncBroker, pdPushLead, pdPushLeads } from './pipedrive.js'
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
import PropTable from './components/PropTable.jsx'

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
// Brokers table columns — `key` is the sort field (null = not sortable, e.g. Actions).
const BROK_COLS = [
  { label: 'BROKER', key: 'name', align: 'left' },
  { label: 'FIRM', key: 'firm', align: 'left' },
  { label: 'PHONE', key: 'phone', align: 'left', cls: 'col-secondary' },
  { label: 'CELL', key: 'cell', align: 'left' },
  { label: 'EMAIL', key: 'email', align: 'left', cls: 'col-secondary' },
  { label: 'MARKET(S)', key: 'mkts', align: 'left' },
  { label: '# LIST', key: 'listings', align: 'right' },
  { label: 'PIPEDRIVE', key: 'synced', align: 'left' },
  { label: 'ACTIONS', key: null, align: 'left', cls: 'col-secondary' },
]
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
  markets: [], ownerTypes: [], ownerLoc: 'all', bucket: 'all',
  clearMax: '', yearMin: '', yearMax: '', sfMin: '', sfMax: '',
  distMax: '', holdMin: '', heldSince: '',
  saleYearMin: '', salePriceMin: '', salePriceMax: '', salePsfMax: '',
  askMax: '', domMin: '',
  sig: { oos: false, tax: false, code: false, permit: false, vacant: false, distress: false, contact: false, lease: false },
}
const OWNER_TYPES = ['LLC', 'Trust', 'Individual', 'Partnership', 'Corp']
const numInput = 'height:32px;padding:0 9px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px;outline:none;width:100%;'

// true at/below the mobile breakpoint (matches index.css @media max-width:767px).
// Lets the table view mount only the visible renderer — the desktop <PropTable>
// OR the mobile card list — instead of both; the hidden one still pays a full
// mount of every row otherwise.
function useIsNarrow(bp = 767) {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${bp}px)`).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${bp}px)`)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [bp])
  return narrow
}

export default function App() {
  const isNarrow = useIsNarrow()
  const [theme, setTheme] = useState('dark')
  const [module, setModule] = useState('properties')
  const [view, setView] = useState('map')          // ← default view = Map
  const [channel, setChannel] = useState('both')
  const [score, setScore] = useState({ Actionable: true, Tentative: true, Pass: true })
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [q, setQ] = useState('')                 // search: address · owner · broker · APN · contact
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const toggleSig = (k) => setFilters((f) => ({ ...f, sig: { ...f.sig, [k]: !f.sig[k] } }))
  // toggle one value in a multi-select array filter (markets, ownerTypes)
  const toggleInArr = (k, v) => setFilters((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }))
  const [selProps, setSelProps] = useState([])
  const [selBrokers, setSelBrokers] = useState([])
  const [drawerId, setDrawerId] = useState(null)
  // brokers view — click-sortable columns (key=null → default phone-first order)
  const [brokSort, setBrokSort] = useState({ key: null, dir: 'asc' })
  // brokers view — listings drawer + email composer, both open on the right (no routing)
  const [listBrokId, setListBrokId] = useState(null)
  // email composer is shared by brokers AND properties — at most one of these ids is set
  const [emailBrokId, setEmailBrokId] = useState(null)
  const [emailPropId, setEmailPropId] = useState(null)
  const [emailDraft, setEmailDraft] = useState({ subject: '', body: '' })
  const [emailSent, setEmailSent] = useState(false)
  const [mapStyle, setMapStyle] = useState('sat')   // ← default basemap = Satellite

  // Pipedrive write integration: token-configured? + in-flight + a transient toast.
  const [pdOk, setPdOk] = useState(null)   // null=checking, true/false=token configured
  const [pdBusy, setPdBusy] = useState('') // '', 'bulk', 'lead', or `brok:<id>`
  const [pdMsg, setPdMsg] = useState(null) // { kind:'ok'|'err', text, url? }
  useEffect(() => { pdStatus().then((s) => setPdOk(Boolean(s.configured))).catch(() => setPdOk(false)) }, [])
  useEffect(() => { if (!pdMsg) return undefined; const t = setTimeout(() => setPdMsg(null), 6000); return () => clearTimeout(t) }, [pdMsg])

  const [sourcing, setSourcing] = useState(false)
  const [stopping, setStopping] = useState(false)  // stop requested, waiting for the backend job to actually halt
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
  // Subscribe to the shared call queue so the drawer button's queued-state and the
  // "AI Caller" nav badge re-render the moment something is added or removed.
  const queueCount = useQueueCount()
  // On-market listings we can actually show, grouped per broker by normalized name.
  // A broker's own `listings` field is a source-claimed count that frequently doesn't
  // match rows we hold (in live data the broker directory and the on-market listings are
  // separate scrapes with no shared key) — so the # LIST badge, the sort, and the drawer
  // ALL read from this map. That keeps the count honest: it never shows a phantom number
  // that opens an empty drawer.
  const normName = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const listingsByBroker = useMemo(() => {
    const m = new Map()
    for (const p of propsData) {
      if (p.channel !== 'on') continue
      const k = normName(p.broker)
      if (!k) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(p)
    }
    return m
  }, [propsData])
  const listingsFor = (b) => (b ? listingsByBroker.get(normName(b.name)) || [] : [])
  // broker directory keyed by normalized name — lets an on-market property borrow its
  // listing broker's email when the row itself carries no scraped email.
  const brokerByName = useMemo(() => {
    const m = new Map()
    for (const b of dataset.brokers) { const k = normName(b.name); if (k && !m.has(k)) m.set(k, b) }
    return m
  }, [dataset.brokers])
  // best email + contact name to reach about a property: the scraped owner/contact
  // email if present, else (on-market) the listing broker's email from the directory.
  const propEmail = (p) => (p ? (p.emails?.[0] || (p.channel === 'on' ? brokerByName.get(normName(p.broker))?.email : '') || '') : '')
  const propContactName = (p) => (p ? (p.person || (p.channel === 'on' ? p.broker : p.owner) || 'there') : 'there')
  // owners are frequently LLCs/entities, not people — don't greet "Hi Couchville Holdings,"
  const ENTITY_RE = /\b(LLC|INC|CORP|TRUST|LP|LLP|PARTNERS?|HOLDINGS?|PROPERT(Y|IES)|REALTY|GROUP|CO|COMPANY|ENTERPRISES?|INVESTMENTS?|CAPITAL|ASSOCIATES?|VENTURES?|MANAGEMENT)\b|L\.L\.C|&/i
  const contactFirst = (p) => {
    if (p?.person) return p.person.trim().split(' ')[0]
    const nm = p?.channel === 'on' ? p?.broker : p?.owner
    return nm && !ENTITY_RE.test(nm) ? nm.trim().split(' ')[0] : 'there'
  }
  // short recipient label for buttons — a real first name, else the neutral role noun
  const propEmailLabel = (p) => (p?.person ? p.person.trim().split(' ')[0] : (p?.channel === 'on' ? (p?.broker?.trim().split(' ')[0] || 'broker') : 'owner'))
  // Columns aren't click-sortable, so default the brokers list to the useful order:
  // anyone we can actually call (a phone or cell on file) floats to the top. Digit-count
  // guards against blanks / placeholder dashes in live data. Stable sort keeps the rest as-is.
  const hasPhoneNum = (b) => ((b.cell || '').replace(/\D/g, '').length >= 7 || (b.phone || '').replace(/\D/g, '').length >= 7)
  // sort value per column: phone/cell by digits, # LIST = real matched-listing count, synced boolean, rest alpha
  const brokSortVal = (b, key) => {
    if (key === 'listings') return listingsFor(b).length
    if (key === 'synced') return b.synced ? 1 : 0
    if (key === 'phone' || key === 'cell') return (b[key] || '').replace(/\D/g, '')
    return (b[key] || '').toString().toLowerCase()
  }
  // header click cycles: none → asc → desc → none (none = phone-first default)
  const toggleBrokSort = (key) => setBrokSort((s) => (
    s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' }
  ))
  const brokersData = (() => {
    const base = [...dataset.brokers]
    if (!brokSort.key) return base.sort((a, b) => (hasPhoneNum(b) ? 1 : 0) - (hasPhoneNum(a) ? 1 : 0))
    const dir = brokSort.dir === 'desc' ? -1 : 1
    return base.sort((a, b) => {
      const av = brokSortVal(a, brokSort.key), bv = brokSortVal(b, brokSort.key)
      return av < bv ? -dir : av > bv ? dir : 0
    })
  })()

  // ── brokers view interactions: sync, listings drawer, email composer ──────
  const listBroker = listBrokId != null ? brokersData.find((b) => b.id === listBrokId) : null
  const brokerListings = listingsFor(listBroker)
  const emailBroker = emailBrokId != null ? brokersData.find((b) => b.id === emailBrokId) : null
  const emailProp = emailPropId != null ? propsData.find((p) => p.id === emailPropId) : null
  // the composer renders one recipient — a broker or a property contact — as { name, email }
  const emailTo = emailBroker
    ? { name: emailBroker.name, email: emailBroker.email || '' }
    : emailProp
      ? { name: propContactName(emailProp), email: propEmail(emailProp) }
      : null
  const closeEmail = () => { setEmailBrokId(null); setEmailPropId(null) }
  // Sync a broker to Pipedrive as a Person (dedupes server-side). On success flip
  // the local "Synced" chip + remember the person URL; on failure show the reason.
  const syncBroker = async (id) => {
    const b = dataset.brokers.find((x) => x.id === id)
    if (!b || pdBusy) return
    setPdBusy(`brok:${id}`); setPdMsg(null)
    try {
      const r = await pdSyncBroker(b)
      setDataset((d) => ({ ...d, brokers: d.brokers.map((x) => (x.id === id ? { ...x, synced: true, pdUrl: r.url } : x)) }))
      setPdMsg({ kind: 'ok', text: `${b.name} ${r.status === 'exists' ? 'already in' : 'synced to'} Pipedrive`, url: r.url })
    } catch (e) { setPdMsg({ kind: 'err', text: `Pipedrive sync failed: ${e.message}` }) }
    finally { setPdBusy('') }
  }
  // Push one property to Pipedrive: an owner Lead (off-market) or broker Deal (on-market).
  const pushPropToPd = async (p) => {
    if (!p || pdBusy) return
    setPdBusy('lead'); setPdMsg(null)
    try {
      const r = await pdPushLead(p)
      const noun = p.channel === 'off' ? 'lead' : 'deal'
      setPdMsg({ kind: 'ok', text: `${p.addr} — ${r.status === 'exists' ? `already a ${noun} in` : `pushed as a ${noun} to`} Pipedrive`, url: r.url })
    } catch (e) { setPdMsg({ kind: 'err', text: `Push failed: ${e.message}` }) }
    finally { setPdBusy('') }
  }
  // Bulk-push the current selection: brokers → Person sync, properties → lead/deal.
  const pushSelectionToPd = async () => {
    if (pdBusy) return
    if (view === 'brokers') {
      const bs = selBrokers.map((id) => dataset.brokers.find((b) => b.id === id)).filter(Boolean)
      if (!bs.length) return
      setPdBusy('bulk'); setPdMsg(null)
      const done = {}; let ok = 0
      for (const b of bs) { try { const r = await pdSyncBroker(b); ok++; done[b.id] = r.url } catch { /* keep going */ } }
      setDataset((d) => ({ ...d, brokers: d.brokers.map((x) => (done[x.id] ? { ...x, synced: true, pdUrl: done[x.id] } : x)) }))
      setPdMsg({ kind: ok === bs.length ? 'ok' : 'err', text: `${ok}/${bs.length} broker${bs.length > 1 ? 's' : ''} synced to Pipedrive` })
      clearSel(); setPdBusy(''); return
    }
    const props = selProps.map((id) => propsData.find((p) => p.id === id)).filter(Boolean)
    if (!props.length) return
    setPdBusy('bulk'); setPdMsg(null)
    try {
      const r = await pdPushLeads(props)
      setPdMsg({ kind: r.ok === r.total ? 'ok' : 'err', text: `${r.ok}/${r.total} pushed to Pipedrive` })
      clearSel()
    } catch (e) { setPdMsg({ kind: 'err', text: `Bulk push failed: ${e.message}` }) }
    finally { setPdBusy('') }
  }
  const openEmail = (b) => {
    const first = (b.name || '').trim().split(' ')[0] || 'there'
    const n = b.listings || 0
    setEmailDraft({
      subject: `SimiCapital — active industrial buyer in ${b.mkts}`,
      body: `Hi ${first},\n\nI'm with SimiCapital — we're an active buyer of infill industrial (roughly 100–200k SF, a fenced yard / IOS component a plus) in ${b.mkts}.\n\nI saw you're running ${n} listing${n === 1 ? '' : 's'} out of ${b.firm}. We close quickly with clean terms and would welcome a look at anything you have on- or off-market that fits the box.\n\nDo you have 15 minutes this week for a quick call?\n\nBest,\nSimiCapital Acquisitions`,
    })
    setEmailSent(false)
    setEmailPropId(null)
    setEmailBrokId(b.id)
  }
  // properties email — mirrors openEmail, but the draft is owner-direct (off-market) or
  // broker-to-listing (on-market). Recipient resolves via propContactName / propEmail.
  const openPropEmail = (p) => {
    const first = contactFirst(p)
    const onMkt = p.channel === 'on'
    setEmailDraft(onMkt ? {
      subject: `SimiCapital — interest in your ${p.mkt} listing at ${p.addr}`,
      body: `Hi ${first},\n\nI'm with SimiCapital — we're an active buyer of infill industrial (roughly 100–200k SF, a fenced yard / IOS component a plus).\n\nYour listing at ${p.addr} in ${p.mkt}${p.ask ? ` (asking ${fmtMoney2(p.ask)}/SF)` : ''} looks like a strong fit for our box. We close quickly with clean terms.\n\nIs it still available, and could we grab 15 minutes this week?\n\nBest,\nSimiCapital Acquisitions`,
    } : {
      subject: `SimiCapital — interest in ${p.addr}`,
      body: `Hi ${first},\n\nI'm with SimiCapital — we're an active, direct buyer of infill industrial (roughly 100–200k SF, a fenced yard / IOS component a plus)${p.mkt ? ` in ${p.mkt}` : ''}.\n\nWe're interested in your property at ${p.addr}${p.sf ? ` (~${fmtSF(p.sf)} SF)` : ''}. We're not brokers — we buy directly, close quickly, and can work around your timeline. No listing required and no obligation.\n\nWould you be open to a short conversation about a potential off-market sale?\n\nBest,\nSimiCapital Acquisitions`,
    })
    setEmailSent(false)
    setEmailBrokId(null)
    setEmailPropId(p.id)
  }
  const sendEmail = () => setEmailSent(true)

  // mobile shell state
  const [railOpen, setRailOpen] = useState(false)
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
    if (filters.markets.length && !filters.markets.includes(p.mkt)) return false
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
    // LoopNet / on-market price + aged-listing screens — null-inclusive
    if (filters.askMax && p.ask != null && p.ask > +filters.askMax) return false
    if (filters.domMin && p.daysOn != null && p.daysOn < +filters.domMin) return false
    if (filters.ownerTypes.length && !filters.ownerTypes.includes(p.ownerType)) return false
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
    ...filters.markets.map((m) => ({ label: m, onClear: () => setF('markets', filters.markets.filter((x) => x !== m)) })),
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
    ...(filters.askMax ? [{ label: `Asking ≤ $${filters.askMax}/SF`, onClear: () => setF('askMax', '') }] : []),
    ...(filters.domMin ? [{ label: `On market ≥ ${filters.domMin} days`, onClear: () => setF('domMin', '') }] : []),
    ...filters.ownerTypes.map((o) => ({ label: `${o} owner`, onClear: () => setF('ownerTypes', filters.ownerTypes.filter((x) => x !== o)) })),
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
  const FILTER_KEYS = ['ownerLoc', 'bucket', 'clearMax', 'yearMin', 'yearMax', 'sfMin', 'sfMax', 'distMax', 'holdMin', 'heldSince', 'saleYearMin', 'salePriceMin', 'salePriceMax', 'salePsfMax', 'askMax', 'domMin']
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
      // MULTI markets: union to add, subtract to remove, *All to clear (= all)
      let markets = base.markets
      if (p.marketsAll) markets = []
      if (p.markets) markets = [...new Set([...markets, ...p.markets])]
      if (p.marketsRemove) markets = markets.filter((m) => !p.marketsRemove.includes(m))
      next.markets = markets
      // MULTI owner types: same three ops
      let ots = base.ownerTypes
      if (p.ownerTypesAll) ots = []
      if (p.ownerTypes) ots = [...new Set([...ots, ...p.ownerTypes])]
      if (p.ownerTypesRemove) ots = ots.filter((o) => !p.ownerTypesRemove.includes(o))
      next.ownerTypes = ots
      return next
    })
    if (p.q !== undefined) setQ(p.q)
    if (p.view) setView(p.view)
  }

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
                  <div style={css('display:flex;flex-direction:column;gap:6px;')}>
                    <div style={css('display:flex;align-items:center;justify-content:space-between;')}><label style={css(fieldLabel)}>Markets{filters.markets.length ? ` · ${filters.markets.length}` : ''}</label>{filters.markets.length > 0 && <button className="hov" onClick={() => setF('markets', [])} style={css('background:none;border:none;color:var(--accent);font-size:10.5px;font-weight:500;')}>All markets</button>}</div>
                    <div style={css('display:flex;flex-wrap:wrap;gap:5px;')}>
                      {MARKETS.filter((m) => ALLOWED_MARKETS.has(m)).map((m) => {
                        const on = filters.markets.includes(m)
                        return <button key={m} className={on ? 'ms-chip on' : 'ms-chip'} aria-pressed={on} onClick={() => toggleInArr('markets', m)} style={css('height:24px;padding:0 9px;background:var(--surface2);border:1px solid var(--border2);border-radius:12px;color:var(--text2);font-size:11px;')}>{m}</button>
                      })}
                    </div>
                  </div>
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
                  <div style={css('display:flex;gap:8px;')}>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Max asking $/SF</label><input type="number" value={filters.askMax} onChange={(e) => setF('askMax', e.target.value)} placeholder="≤ 8 (on-market)" aria-label="Maximum asking price per SF" style={css(numInput)} /></div>
                    <div style={css('flex:1;display:flex;flex-direction:column;gap:5px;')}><label style={css(fieldLabel)}>Min days on market</label><input type="number" value={filters.domMin} onChange={(e) => setF('domMin', e.target.value)} placeholder="≥ 90 (aged)" aria-label="Minimum days on market" style={css(numInput)} /></div>
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:6px;')}>
                    <div style={css('display:flex;align-items:center;justify-content:space-between;')}><label style={css(fieldLabel)}>Owner type{filters.ownerTypes.length ? ` · ${filters.ownerTypes.length}` : ''}</label>{filters.ownerTypes.length > 0 && <button className="hov" onClick={() => setF('ownerTypes', [])} style={css('background:none;border:none;color:var(--accent);font-size:10.5px;font-weight:500;')}>Any type</button>}</div>
                    <div style={css('display:flex;flex-wrap:wrap;gap:5px;')}>
                      {OWNER_TYPES.map((o) => {
                        const on = filters.ownerTypes.includes(o)
                        return <button key={o} className={on ? 'ms-chip on' : 'ms-chip'} aria-pressed={on} onClick={() => toggleInArr('ownerTypes', o)} style={css('height:24px;padding:0 9px;background:var(--surface2);border:1px solid var(--border2);border-radius:12px;color:var(--text2);font-size:11px;')}>{o}</button>
                      })}
                    </div>
                  </div>
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

              {/* TABLE (desktop) / CARD-LIST (mobile) — mount only the active one */}
              {view === 'table' && !showEmpty && (isNarrow ? (
                <div className="card-list" style={css('flex-direction:column;flex:1;overflow-y:auto;min-height:0;')}>
                  {visibleProps.map((p) => (
                    <div key={p.id} className="hov" tabIndex={0} role="button" onClick={() => setDrawerId(p.id)} style={css(cardStyle(p.cat))}>
                      <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css(scDot(p.cat))} /><span style={css('font-weight:600;font-size:14.5px;flex:1;')}>{p.addr}</span><Icon name="chevronRight" size={16} stroke="var(--text3)" /></div>
                      <div style={css('display:flex;align-items:center;gap:8px;flex-wrap:wrap;')}><span style={css(chTag(p.channel))}>{chLabel(p.channel)}</span><span style={css(scChip(p.cat))}><span style={css(scDot(p.cat))} />{p.cat} · {p.score}</span>{p.lease && <a href={p.lease.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={css('font-size:11px;font-weight:600;color:var(--green);background:var(--green-tint);border:1px solid var(--border);padding:2px 8px;border-radius:5px;text-decoration:none;')}>For Lease</a>}{propEmail(p) && <button className="tap hov" onClick={(e) => { e.stopPropagation(); openPropEmail(p) }} aria-label={`Email ${propEmailLabel(p)}`} style={css('display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--accent);background:var(--accent-dim);border:1px solid var(--border);padding:2px 8px;border-radius:5px;')}><Icon name="mail" size={11} sw={2} />Email</button>}</div>
                      <div style={css('display:flex;gap:16px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{p.mkt}</span><span style={css('font-family:var(--mono);')}>{fmtSF(p.sf)} SF</span><span>{cardSub(p)}</span></div>
                      <div style={css('font-size:11.5px;color:var(--text3);')}>{p.signal}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <PropTable rows={visibleProps} selProps={selProps} toggleProp={toggleProp} allSel={allPropsSel} onToggleAll={selAllProps} onOpen={setDrawerId} onEmail={openPropEmail} emailOf={propEmail} />
              ))}

              {/* BROKERS */}
              {view === 'brokers' && (
                <>
                  <div className="data-table-wrap" style={css('flex:1;overflow:auto;min-height:0;')}>
                    <table style={css('width:100%;border-collapse:collapse;font-size:12.5px;')}>
                      <thead><tr style={css('position:sticky;top:0;z-index:2;background:var(--surface);')}>
                        <th style={css('width:34px;padding:9px 0 9px 14px;border-bottom:1px solid var(--border);')}><input type="checkbox" checked={allBrokSel} onChange={selAllBrok} aria-label="Select all brokers" style={css('accent-color:var(--accent);')} /></th>
                        {BROK_COLS.map((c, i) => {
                          const active = c.key && brokSort.key === c.key
                          const t = th(c.align, c.cls || '')
                          const cls = [t.cls, c.key ? 'brok-th' : ''].filter(Boolean).join(' ')
                          return (
                            <th key={i} className={cls} style={css(t.s)} aria-sort={active ? (brokSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'} onClick={c.key ? () => toggleBrokSort(c.key) : undefined}>
                              <span style={css(`display:inline-flex;align-items:center;gap:4px;${c.align === 'right' ? 'flex-direction:row-reverse;' : ''}`)}>
                                <span style={css(active ? 'color:var(--text);' : '')}>{c.label}</span>
                                {c.key && <span style={css(`font-size:9px;line-height:1;${active ? 'color:var(--accent);' : 'color:var(--text3);opacity:.45;'}`)}>{active ? (brokSort.dir === 'desc' ? '▼' : '▲') : '↕'}</span>}
                              </span>
                            </th>
                          )
                        })}
                      </tr></thead>
                      <tbody>
                        {brokersData.map((b) => (
                          <tr key={b.id} className="hov" style={css('border-bottom:1px solid var(--border);')}>
                            <td style={css('padding:0 0 0 14px;')}><input type="checkbox" checked={selBrokers.includes(b.id)} onChange={() => toggleBrok(b.id)} aria-label="Select broker" style={css('accent-color:var(--accent);')} /></td>
                            <td style={css('padding:10px 8px;font-weight:500;white-space:nowrap;')}>{b.name}</td>
                            <td style={css('padding:10px 8px;color:var(--text2);white-space:nowrap;')}>{b.firm}</td>
                            <td className="col-secondary" style={css('padding:10px 8px;color:var(--text2);font-family:var(--mono);font-size:11.5px;')}>{b.phone}</td>
                            <td style={css('padding:10px 8px;font-family:var(--mono);font-size:11.5px;')}><span style={css('color:var(--accent);background:var(--accent-dim);padding:2px 6px;border-radius:4px;')}>{b.cell}</span></td>
                            <td className="col-secondary" style={css('padding:10px 8px;font-size:11.5px;')}><button className="tap hov" onClick={() => openEmail(b)} title={`Email ${b.name}`} style={css('display:inline-flex;align-items:center;gap:5px;max-width:190px;background:none;border:none;padding:0;color:var(--accent);font-size:11.5px;cursor:pointer;')}><Icon name="mail" size={12} sw={1.9} /><span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{b.email}</span></button></td>
                            <td style={css('padding:10px 8px;color:var(--text2);white-space:nowrap;')}>{b.mkts}</td>
                            <td style={css('padding:10px 8px;text-align:right;font-family:var(--mono);')}>{listingsFor(b).length}</td>
                            <td style={css('padding:10px 8px;')}>{b.synced ? (
                              <span style={css('display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);color:var(--green);background:var(--green-tint);')}><Icon name="check" size={11} sw={2.4} />Synced</span>
                            ) : (
                              <button className="tap sync-chip" onClick={() => syncBroker(b.id)} disabled={pdOk === false || pdBusy === `brok:${b.id}`} title={pdOk === false ? 'Pipedrive not configured — set PIPEDRIVE_API_TOKEN' : `Sync ${b.name} to Pipedrive`} style={css('display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);color:var(--text3);background:var(--surface2);' + (pdOk === false ? 'opacity:.5;cursor:not-allowed;' : ''))}><Icon name="sync" size={11} sw={2.2} /><span className="off-hover">{pdBusy === `brok:${b.id}` ? 'Syncing…' : 'Not synced'}</span><span className="on-hover">{pdBusy === `brok:${b.id}` ? 'Syncing…' : 'Sync now'}</span></button>
                            )}</td>
                            <td className="col-secondary" style={css('padding:10px 14px 10px 8px;white-space:nowrap;')}>{listingsFor(b).length > 0 ? (
                              <button className="tap hov" onClick={() => setListBrokId(b.id)} style={css('height:26px;padding:0 9px;background:var(--surface3);border:1px solid var(--border2);border-radius:5px;color:var(--text2);font-size:11px;')}>View listings</button>
                            ) : (
                              <span style={css('font-size:11px;color:var(--text3);')}>No listings</span>
                            )}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-list" style={css('flex-direction:column;flex:1;overflow-y:auto;min-height:0;')}>
                    {brokersData.map((b) => (
                      <div key={b.id} style={css('display:flex;flex-direction:column;gap:9px;padding:14px 16px;border-bottom:1px solid var(--border);')}>
                        <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css('font-weight:600;font-size:14.5px;flex:1;')}>{b.name}</span>{b.synced ? (
                          <span style={css('display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);color:var(--green);background:var(--green-tint);')}><Icon name="check" size={11} sw={2.4} />Synced</span>
                        ) : (
                          <button className="tap sync-chip" onClick={() => syncBroker(b.id)} disabled={pdOk === false || pdBusy === `brok:${b.id}`} title={pdOk === false ? 'Pipedrive not configured — set PIPEDRIVE_API_TOKEN' : `Sync ${b.name} to Pipedrive`} style={css('display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);color:var(--text3);background:var(--surface2);' + (pdOk === false ? 'opacity:.5;cursor:not-allowed;' : ''))}><Icon name="sync" size={11} sw={2.2} /><span className="off-hover">{pdBusy === `brok:${b.id}` ? 'Syncing…' : 'Not synced'}</span><span className="on-hover">{pdBusy === `brok:${b.id}` ? 'Syncing…' : 'Sync now'}</span></button>
                        )}</div>
                        <div style={css('display:flex;gap:16px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{b.firm}</span><span>{b.mkts}</span><span style={css('font-family:var(--mono);')}>{listingsFor(b).length} listings</span></div>
                        <div style={css('display:flex;align-items:center;gap:8px;')}><span style={css('font-family:var(--mono);font-size:11.5px;color:var(--accent);background:var(--accent-dim);padding:2px 7px;border-radius:4px;')}>{b.cell}</span><button className="tap hov" onClick={() => openEmail(b)} aria-label={`Email ${b.name}`} style={css('margin-left:auto;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px;background:var(--surface3);border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:11.5px;')}><Icon name="mail" size={13} sw={1.8} />Email</button>{listingsFor(b).length > 0 && <button className="tap hov" onClick={() => setListBrokId(b.id)} style={css('display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px;background:var(--surface3);border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:11.5px;')}>Listings</button>}</div>
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
                  <button className="tap hov" onClick={pushSelectionToPd} disabled={pdOk === false || pdBusy === 'bulk'} title={pdOk === false ? 'Pipedrive not configured — set PIPEDRIVE_API_TOKEN' : ''} style={css('height:32px;padding:0 13px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12px;white-space:nowrap;' + (pdOk === false ? 'opacity:.55;cursor:not-allowed;' : ''))}>{pdBusy === 'bulk' ? 'Sending…' : `Send ${bulkCount} to Pipedrive`}</button>
                  {view === 'table' && <button className="tap hov" onClick={() => { addToQueue(selProps.map((id) => propsData.find((p) => p.id === id)).filter(Boolean)); clearSel() }} style={css('height:32px;padding:0 13px;background:var(--surface);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12px;white-space:nowrap;')}>Add {bulkCount} to call queue</button>}
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
                      {/* PREPARED OUTREACH — opens the shared email composer with a personalized draft */}
                      <div style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:8px;')}>Prepared outreach</div>
                      <button className="tap hov" onClick={() => openPropEmail(drawerProp)} title={propEmail(drawerProp) ? `Email ${propEmail(drawerProp)}` : 'Prepare an email draft'} style={css('display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:40px;margin-bottom:18px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:8px;color:var(--accent);font-weight:600;font-size:12.5px;cursor:pointer;')}><Icon name="mail" size={14} sw={2} />Email {propEmailLabel(drawerProp)}{propEmail(drawerProp) ? '' : ' · draft'}</button>
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
                      <button className="tap hov" onClick={() => pushPropToPd(drawerProp)} disabled={pdOk === false || pdBusy === 'lead'} title={pdOk === false ? 'Pipedrive not configured — set PIPEDRIVE_API_TOKEN' : ''} style={css('flex:1;height:38px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12.5px;' + (pdOk === false ? 'opacity:.55;cursor:not-allowed;' : ''))}>{pdBusy === 'lead' ? 'Pushing…' : (drawerProp.channel === 'off' ? 'Push owner Lead to Pipedrive' : 'Push broker Deal to Pipedrive')}</button>
                      {(() => {
                        const queued = isQueued(drawerProp.id)
                        return (
                          <button className="tap hov" onClick={() => (queued ? removeFromQueue(drawerProp.id) : addToQueue(drawerProp))} title={queued ? 'Remove from call queue' : 'Add to call queue'} style={css(`height:38px;padding:0 14px;background:var(--surface3);border:1px solid ${queued ? 'var(--accent)' : 'var(--border2)'};border-radius:7px;color:${queued ? 'var(--accent)' : 'var(--text)'};font-size:12.5px;display:flex;align-items:center;gap:6px;white-space:nowrap;`)}>{queued ? <><Icon name="check" size={13} sw={2.4} />In queue</> : 'Add to call queue'}</button>
                        )
                      })()}
                    </div>
                  </div>
                </>
              )}

              {/* BROKER LISTINGS DRAWER — opens on the right, no route change */}
              {listBroker && (
                <>
                  <div className="detail-scrim" onClick={() => setListBrokId(null)} style={css('position:absolute;inset:0;background:rgba(0,0,0,.4);z-index:25;')} />
                  <div className="detail-drawer" onClick={(e) => e.stopPropagation()} style={css('position:absolute;top:0;right:0;bottom:0;width:430px;max-width:100%;background:var(--surface);border-left:1px solid var(--border2);z-index:26;display:flex;flex-direction:column;animation:drawerin .18s ease;box-shadow:-14px 0 40px rgba(0,0,0,.35);')}>
                    <div style={css('flex:0 0 auto;padding:16px 18px;border-bottom:1px solid var(--border);')}>
                      <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:6px;')}>
                        <span style={css('display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;')}><Icon name="users" size={13} sw={1.9} />Broker listings</span>
                        <button onClick={() => setListBrokId(null)} aria-label="Close listings" className="tap" style={css('display:flex;align-items:center;justify-content:center;margin-left:auto;background:none;border:none;color:var(--text3);width:30px;height:30px;')}><Icon name="x" size={17} /></button>
                      </div>
                      <div style={css('font-size:17px;font-weight:600;letter-spacing:-.01em;')}>{listBroker.name}</div>
                      <div style={css('color:var(--text2);font-size:12.5px;margin-top:2px;')}>{listBroker.firm} · {listBroker.mkts}</div>
                    </div>
                    <div style={css('flex:1;overflow-y:auto;padding:16px 18px;')}>
                      <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;')}>
                        <span style={css('font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;')}>On-market listings</span>
                        <span style={css('font-family:var(--mono);font-size:11.5px;color:var(--text3);')}>{brokerListings.length} listing{brokerListings.length === 1 ? '' : 's'}</span>
                      </div>
                      {brokerListings.length > 0 ? (
                        <div style={css('display:flex;flex-direction:column;gap:8px;')}>
                          {brokerListings.map((p) => (
                            <button key={p.id} className="tap hov" onClick={() => { setDrawerId(p.id); setListBrokId(null) }} style={css('display:flex;flex-direction:column;gap:6px;text-align:left;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;cursor:pointer;')}>
                              <div style={css('display:flex;align-items:center;gap:8px;')}><span style={css('font-weight:600;font-size:13px;flex:1;')}>{p.addr}</span><span style={css('font-family:var(--mono);color:var(--accent);font-size:12.5px;')}>{fmtMoney2(p.ask)}/SF</span></div>
                              <div style={css('display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--text2);')}><span style={css(scChip(p.cat))}><span style={css(scDot(p.cat))} />{p.cat} · {p.score}</span><span>{p.mkt}, {p.st}</span><span style={css('font-family:var(--mono);')}>{fmtSF(p.sf)} SF</span>{p.daysOn != null && <span>{p.daysOn}d on mkt</span>}</div>
                              <div style={css('font-size:11px;color:var(--text3);')}>{p.signal}</div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div style={css('padding:24px 12px;text-align:center;color:var(--text3);font-size:12px;border:1px dashed var(--border2);border-radius:8px;line-height:1.6;')}>No on-market listings on file for {listBroker.name} in the current dataset.</div>
                      )}
                    </div>
                    <div style={css('flex:0 0 auto;padding:13px 18px;border-top:1px solid var(--border);display:flex;gap:9px;')}>
                      <button className="tap hov" onClick={() => openEmail(listBroker)} style={css('flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12.5px;')}><Icon name="mail" size={14} sw={2} />Email {listBroker.name.split(' ')[0]}</button>
                      {!listBroker.synced && <button className="tap hov" onClick={() => syncBroker(listBroker.id)} disabled={pdOk === false || pdBusy === `brok:${listBroker.id}`} title={pdOk === false ? 'Pipedrive not configured — set PIPEDRIVE_API_TOKEN' : 'Sync to Pipedrive'} style={css('display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;background:var(--surface3);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12.5px;' + (pdOk === false ? 'opacity:.55;cursor:not-allowed;' : ''))}><Icon name="sync" size={13} sw={2} />{pdBusy === `brok:${listBroker.id}` ? 'Syncing…' : 'Sync'}</button>}
                    </div>
                  </div>
                </>
              )}

              {/* EMAIL COMPOSER — pre-filled, editable, sends in-app. Shared by brokers + properties. */}
              {emailTo && (
                <>
                  <div className="detail-scrim" onClick={closeEmail} style={css('position:absolute;inset:0;background:rgba(0,0,0,.4);z-index:27;')} />
                  <div className="detail-drawer" onClick={(e) => e.stopPropagation()} style={css('position:absolute;top:0;right:0;bottom:0;width:460px;max-width:100%;background:var(--surface);border-left:1px solid var(--border2);z-index:28;display:flex;flex-direction:column;animation:drawerin .18s ease;box-shadow:-14px 0 40px rgba(0,0,0,.35);')}>
                    <div style={css('flex:0 0 auto;padding:16px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px;')}>
                      <span style={css('display:inline-flex;align-items:center;gap:7px;font-size:14px;font-weight:600;')}><Icon name="mail" size={16} sw={1.9} />New email</span>
                      <button onClick={closeEmail} aria-label="Close composer" className="tap" style={css('display:flex;align-items:center;justify-content:center;margin-left:auto;background:none;border:none;color:var(--text3);width:30px;height:30px;')}><Icon name="x" size={17} /></button>
                    </div>
                    <div style={css('flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;')}>
                      <div style={css('display:flex;align-items:center;gap:9px;')}>
                        <span style={css('font-size:10.5px;color:var(--text3);width:52px;text-transform:uppercase;letter-spacing:.05em;')}>To</span>
                        <div style={css('flex:1;min-width:0;display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:8px 11px;font-size:12.5px;')}><span style={css('font-weight:600;white-space:nowrap;')}>{emailTo.name}</span>{emailTo.email ? <span style={css('color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{emailTo.email}</span> : <span style={css('color:var(--text3);font-style:italic;white-space:nowrap;')}>no email on file — draft ready to copy</span>}</div>
                      </div>
                      <div style={css('display:flex;align-items:center;gap:9px;')}>
                        <span style={css('font-size:10.5px;color:var(--text3);width:52px;text-transform:uppercase;letter-spacing:.05em;')}>Subject</span>
                        <input value={emailDraft.subject} onChange={(e) => setEmailDraft((d) => ({ ...d, subject: e.target.value }))} disabled={emailSent} aria-label="Email subject" style={css('flex:1;min-width:0;background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:9px 11px;color:var(--text);font-size:12.5px;outline:none;')} />
                      </div>
                      <textarea value={emailDraft.body} onChange={(e) => setEmailDraft((d) => ({ ...d, body: e.target.value }))} disabled={emailSent} aria-label="Email body" style={css('flex:1;min-height:270px;resize:vertical;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 13px;color:var(--text);font-size:12.5px;line-height:1.6;outline:none;font-family:inherit;')} />
                      {emailSent && <div style={css('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--green);background:var(--green-tint);border:1px solid var(--border);border-radius:7px;padding:9px 12px;')}><Icon name="check" size={14} sw={2.2} />Sent to {emailTo.name}{emailTo.email ? ` · ${emailTo.email}` : ''}</div>}
                    </div>
                    <div style={css('flex:0 0 auto;padding:13px 18px;border-top:1px solid var(--border);display:flex;align-items:center;gap:9px;')}>
                      {!emailSent ? (
                        <>
                          <button className="tap hov" onClick={sendEmail} disabled={!emailDraft.subject.trim() && !emailDraft.body.trim()} style={css('display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 16px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12.5px;')}><Icon name="send" size={14} sw={2} />Send email</button>
                          <a href={`mailto:${emailTo.email}?subject=${encodeURIComponent(emailDraft.subject)}&body=${encodeURIComponent(emailDraft.body)}`} className="tap hov" style={css('display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 13px;background:var(--surface3);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12px;text-decoration:none;')}>Open in mail app</a>
                          <button onClick={closeEmail} className="tap hov" style={css('margin-left:auto;height:38px;padding:0 13px;background:none;border:1px solid var(--border2);border-radius:7px;color:var(--text2);font-size:12px;')}>Cancel</button>
                        </>
                      ) : (
                        <button onClick={closeEmail} className="tap hov" style={css('margin-left:auto;height:38px;padding:0 16px;background:var(--surface3);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12.5px;')}>Done</button>
                      )}
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
            <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:14px;')}><span style={css(`width:9px;height:9px;border-radius:50%;background:${sourcing && !stopping ? 'var(--accent)' : 'var(--text3)'};${sourcing && !stopping ? 'animation:pulse 1.1s infinite;' : ''}`)} /><span style={css('font-size:15px;font-weight:600;')}>{stopping ? 'Stopping…' : sourcing ? 'Sourcing live' : 'Sourcing paused'}</span><button className="tap" onClick={() => setStatusOpen(false)} aria-label="Close" style={css('display:flex;align-items:center;justify-content:center;margin-left:auto;width:34px;height:34px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text2);')}><Icon name="x" size={15} /></button></div>
            <div style={css('display:flex;gap:18px;margin-bottom:16px;')}>
              <div><div style={css('font-family:var(--mono);font-size:22px;font-weight:500;')}>{fmtInt(total)}</div><div style={css('font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;')}>scanned</div></div>
              <div><div style={css('font-family:var(--mono);font-size:22px;font-weight:500;color:var(--accent);')}>+{newCount}</div><div style={css('font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;')}>new</div></div>
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
            <button className="hov tap" onClick={signOut} style={css('display:flex;align-items:center;gap:9px;width:100%;height:40px;padding:0 10px;background:transparent;border:none;border-radius:7px;color:var(--red);font-size:13px;font-weight:500;text-align:left;')}><Icon name="slashCircle" size={16} sw={1.8} />Sign out</button>
          </div>
        </>
      )}

      {/* Pipedrive write toast — success/error feedback for the sync + push actions */}
      {pdMsg && (
        <div onClick={() => setPdMsg(null)} style={css(`position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:3000;display:flex;align-items:center;gap:10px;max-width:92vw;padding:11px 15px;border-radius:9px;font-size:12.5px;cursor:pointer;box-shadow:0 12px 34px rgba(0,0,0,.45);background:var(--surface3);border:1px solid ${pdMsg.kind === 'err' ? 'var(--red)' : 'var(--accent-line)'};color:${pdMsg.kind === 'err' ? 'var(--red)' : 'var(--text)'};`)}>
          <Icon name={pdMsg.kind === 'err' ? 'alert' : 'check'} size={15} sw={2} />
          <span>{pdMsg.text}</span>
          {pdMsg.url && <a href={pdMsg.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={css('color:var(--accent);text-decoration:none;font-weight:600;white-space:nowrap;')}>Open ↗</a>}
        </div>
      )}
    </div>
  )
}
