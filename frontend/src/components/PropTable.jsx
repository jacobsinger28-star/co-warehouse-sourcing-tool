import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { fmtSF, fmtInt, fmtMoney2, fmtPhone, fmtDate, scDot, scLabel, chDot, rowStyle } from '../helpers.js'

// Adjustable Properties table: show/hide + drag-to-resize columns, persisted to
// localStorage. Extracted from App.jsx so the column machinery lives in one place.
// Structural columns (row-select checkbox, open-chevron) are fixed and not
// user-adjustable; only the data columns below are.

// contactStyle / ownerOrBroker are duplicated from App.jsx (small + stable) to
// keep this component free of prop-drilling. Keep in sync if the App copies change.
const contactStyle = (c) =>
  c === 'No contact'
    ? 'font-size:11px;color:var(--text3);background:var(--surface2);border:1px solid var(--border);padding:2px 7px;border-radius:5px;white-space:nowrap;'
    : 'font-size:11px;color:var(--green);background:var(--green-tint);border:1px solid var(--border);padding:2px 7px;border-radius:5px;white-space:nowrap;'
const ownerOrBroker = (p) => (p.channel === 'off' ? p.owner : `${p.broker} · ${p.firm}`)

// Each data column: key (stable id + storage key), label (header), align, default
// width (px), min width (px), mono (tabular figures), and cell(p) → content.
const COLUMNS = [
  { key: 'ch', label: 'CH', align: 'left', w: 44, min: 36, cell: (p) => <span style={css(chDot(p.channel))} /> },
  { key: 'addr', label: 'ADDRESS', align: 'left', w: 230, min: 130, cell: (p) => (
    <>{p.isNew && <span title="First found by the latest sourcing run" style={css('display:inline-block;margin-right:7px;font-size:9.5px;font-weight:700;letter-spacing:.05em;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-line);padding:1px 6px;border-radius:4px;vertical-align:middle;')}>NEW</span>}{p.addr}{p.lease && (
      <a href={p.lease.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={`${p.lease.note} — open on LoopNet`} style={css('display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:10px;font-weight:600;color:var(--green);background:var(--green-tint);border:1px solid var(--border);padding:2px 7px;border-radius:5px;text-decoration:none;vertical-align:middle;')}>For Lease<Icon name="chevronRight" size={9} sw={2.4} /></a>
    )}</>
  ) },
  { key: 'mkt', label: 'MARKET', align: 'left', w: 104, min: 70, cell: (p) => p.mkt },
  { key: 'sf', label: 'SF', align: 'right', w: 88, min: 60, mono: true, cell: (p) => fmtSF(p.sf) },
  { key: 'score', label: 'SCORE', align: 'left', w: 152, min: 110, cell: (p) => (
    <span style={css('display:inline-flex;align-items:center;gap:6px;')}><span style={css(scDot(p.cat))} /><span style={css(scLabel(p.cat))}>{p.cat}</span><span style={css('font-family:var(--mono);font-size:11.5px;color:var(--text3);')}>{p.score}</span></span>
  ) },
  { key: 'signal', label: 'KEY SIGNAL', align: 'left', w: 156, min: 100, cell: (p) => p.signal },
  { key: 'owner', label: 'OWNER / BROKER', align: 'left', w: 200, min: 140, greedy: true, cell: (p) => ownerOrBroker(p) },
  { key: 'ask', label: 'ASK $/SF', align: 'right', w: 92, min: 62, mono: true, cell: (p) => (p.channel === 'on' ? fmtMoney2(p.ask) : '—') },
  { key: 'year', label: 'YEAR', align: 'right', w: 68, min: 50, mono: true, cell: (p) => p.year ?? '—' },
  { key: 'clear', label: 'CLR FT', align: 'right', w: 70, min: 52, mono: true, cell: (p) => p.clear ?? '—' },
  { key: 'dist', label: 'DIST MI', align: 'right', w: 76, min: 56, mono: true, cell: (p) => p.distMi ?? '—' },
  { key: 'held', label: 'HELD YR', align: 'right', w: 76, min: 56, mono: true, cell: (p) => (p.holdYears != null ? Math.round(p.holdYears) : '—') },
  { key: 'contact', label: 'CONTACT', align: 'left', w: 130, min: 90, cell: (p) => <span title={p.person || undefined} style={css(contactStyle(p.contact))}>{p.contact}</span> },
  // EMAIL: click opens the prepared-email composer (like the brokers table). Address
  // is resolved by the parent via ctx.emailOf (owner/contact email, or the listing
  // broker's email for on-market rows); '—' when none is on file.
  { key: 'email', label: 'EMAIL', align: 'left', w: 176, min: 110, cell: (p, ctx) => {
    const em = ctx?.emailOf?.(p) || p.emails?.[0] || ''
    return em
      ? <button className="tap hov" onClick={(e) => { e.stopPropagation(); ctx?.onEmail?.(p) }} title={`Prepare email — ${em}`} style={css('display:inline-flex;align-items:center;gap:5px;max-width:100%;background:none;border:none;padding:0;color:var(--accent);font-size:12px;cursor:pointer;')}><Icon name="mail" size={12} sw={1.9} /><span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{em}</span></button>
      : '—'
  } },
  // when the listing first entered the scrape DB (first_seen) — sample/off-market
  // rows have no stamp and show '—'; NEW-badged rows are the latest run's cohort
  { key: 'added', label: 'ADDED', align: 'right', w: 84, min: 60, mono: true, cell: (p) => fmtDate(p.firstSeen) },
  // ── extra columns: off by default (defOff), available in the Columns menu ──
  { key: 'st', label: 'ST', align: 'left', w: 52, min: 40, defOff: true, cell: (p) => p.st ?? '—' },
  { key: 'ownerType', label: 'OWNER TYPE', align: 'left', w: 108, min: 72, defOff: true, cell: (p) => p.ownerType ?? '—' },
  { key: 'oos', label: 'OUT-OF-STATE', align: 'left', w: 116, min: 76, defOff: true, cell: (p) => p.oos || '—' },
  { key: 'lastSale', label: 'LAST SALE', align: 'right', w: 100, min: 70, mono: true, defOff: true, cell: (p) => p.lastSale ?? '—' },
  { key: 'lastPrice', label: 'LAST $', align: 'right', w: 112, min: 80, mono: true, defOff: true, cell: (p) => (p.lastPrice != null ? `$${fmtInt(p.lastPrice)}` : '—') },
  { key: 'assessed', label: 'ASSESSED', align: 'right', w: 112, min: 80, mono: true, defOff: true, cell: (p) => (p.assessed ? `$${fmtInt(p.assessed)}` : '—') },
  { key: 'viol', label: 'VIOL', align: 'right', w: 66, min: 48, mono: true, defOff: true, cell: (p) => p.nViol ?? '—' },
  { key: 'permit', label: 'PERMITS', align: 'right', w: 80, min: 56, mono: true, defOff: true, cell: (p) => p.nPermit ?? '—' },
  { key: 'landUse', label: 'LAND USE', align: 'left', w: 160, min: 90, defOff: true, cell: (p) => p.landUse ?? '—' },
  { key: 'apn', label: 'APN', align: 'left', w: 132, min: 80, mono: true, defOff: true, cell: (p) => p.apn ?? '—' },
  { key: 'phone', label: 'PHONE', align: 'left', w: 132, min: 92, mono: true, defOff: true, cell: (p) => (p.phones?.[0] ? fmtPhone(p.phones[0]) : '—') },
  { key: 'lease', label: 'LEASE', align: 'left', w: 96, min: 66, defOff: true, cell: (p) => (p.lease ? <span style={css('color:var(--green);font-weight:600;')}>For Lease</span> : '—') },
]
const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c]))
const ORDER = COLUMNS.map((c) => c.key)
// Merge a stored custom order (drag-to-reorder) with the canonical ORDER: keep the
// stored keys in their chosen order, drop any that no longer exist, and splice back
// any columns the stored order never knew about (newly added) at their canonical
// spot. Empty/absent stored order → canonical order.
const effectiveOrder = (stored) => {
  if (!stored || !stored.length) return ORDER
  const known = stored.filter((k) => COL_BY_KEY[k])
  const missing = ORDER.filter((k) => !known.includes(k))
  if (!missing.length) return known
  const result = [...known]
  for (const k of missing) {
    const canon = ORDER.indexOf(k)
    let at = result.length
    for (let i = 0; i < result.length; i++) { if (ORDER.indexOf(result[i]) > canon) { at = i; break } }
    result.splice(at, 0, k)
  }
  return result
}
// greedy priority: whichever of these is visible absorbs slack (no fixed width,
// no resize handle) so the table always fills 100% with no dead gap.
const GREEDY_PRIORITY = ['owner', 'addr', 'signal', 'score', 'contact']
// per-column sort key (the raw comparable value behind each cell)
const SORT_VAL = {
  ch: (p) => p.channel, addr: (p) => p.addr, mkt: (p) => p.mkt, sf: (p) => p.sf,
  score: (p) => p.score, signal: (p) => p.signal, owner: (p) => ownerOrBroker(p),
  ask: (p) => (p.channel === 'on' ? p.ask : null), year: (p) => p.year,
  clear: (p) => p.clear, dist: (p) => p.distMi, held: (p) => p.holdYears, contact: (p) => p.contact,
  email: (p) => p.emails?.[0] || null,
  added: (p) => p.firstSeen || null, // ISO strings — lexicographic order is chronological
  st: (p) => p.st, ownerType: (p) => p.ownerType, oos: (p) => p.oos || null,
  lastSale: (p) => p.lastSale, lastPrice: (p) => p.lastPrice, assessed: (p) => p.assessed,
  viol: (p) => p.nViol, permit: (p) => p.nPermit, landUse: (p) => p.landUse,
  apn: (p) => p.apn, phone: (p) => p.phones?.[0] || null, lease: (p) => (p.lease ? 1 : 0),
}
// comparator: nulls/undefined always sort last; numbers numerically, else localeCompare
const cmp = (a, b, dir) => {
  const an = a == null || a === '', bn = b == null || b === ''
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  let r
  if (typeof a === 'number' && typeof b === 'number') r = a - b
  else r = String(a).localeCompare(String(b), undefined, { numeric: true })
  return dir === 'desc' ? -r : r
}
const STORE_KEY = 'simicap.propcols.v1'

const loadPrefs = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    return {
      vis: raw.vis && typeof raw.vis === 'object' ? raw.vis : {},
      w: raw.w && typeof raw.w === 'object' ? raw.w : {},
      order: Array.isArray(raw.order) ? raw.order.filter((k) => COL_BY_KEY[k]) : [],
    }
  } catch { return { vis: {}, w: {}, order: [] } }
}

export default function PropTable({ rows, selProps, toggleProp, allSel, onToggleAll, onOpen, onEmail, emailOf }) {
  const [prefs, setPrefs] = useState(loadPrefs) // { vis:{key:bool}, w:{key:px} }
  const [menuOpen, setMenuOpen] = useState(false)
  const [sort, setSort] = useState({ key: null, dir: 'asc' }) // click header to order by
  // click a header: none → asc → desc → none (cycle), one sort column at a time
  const toggleSort = (key) => setSort((s) => (
    s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' }
  ))
  const menuRef = useRef(null)
  const prefsRef = useRef(prefs)
  useEffect(() => { prefsRef.current = prefs }, [prefs])
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)) } catch { /* private mode / quota — non-fatal */ }
  }, [prefs])

  // close the Columns menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  // explicit user choice wins; otherwise visible unless the column is defOff
  const isVisible = (k) => { const v = prefs.vis[k]; return v === true ? true : v === false ? false : !COL_BY_KEY[k].defOff }
  const widthOf = (k) => prefs.w[k] ?? COL_BY_KEY[k].w
  // full column order (canonical unless the user has dragged headers to reorder)
  const order = useMemo(() => effectiveOrder(prefs.order), [prefs.order])
  const visibleCols = useMemo(() => order.filter(isVisible).map((k) => COL_BY_KEY[k]), [order, prefs.vis]) // eslint-disable-line
  const visCount = visibleCols.length
  // drag-to-reorder headers: dragKey = column being dragged; dragOver = { key, after }
  // marks where it will land (left/right of the hovered header).
  const [dragKey, setDragKey] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const moveColumn = (from, to, after) => {
    if (!from || from === to) return
    setPrefs((p) => {
      const base = effectiveOrder(p.order).filter((k) => k !== from)
      let idx = base.indexOf(to)
      if (idx < 0) return p
      base.splice(after ? idx + 1 : idx, 0, from)
      return { ...p, order: base }
    })
  }
  // pick the greedy (stretch) column among the visible ones
  const greedyKey = useMemo(() => {
    const vis = new Set(visibleCols.map((c) => c.key))
    return GREEDY_PRIORITY.find((k) => vis.has(k)) || (visibleCols[0]?.key ?? null)
  }, [visibleCols])

  // rows sorted by the active column (stable; sorts a copy, never the prop)
  const sortedRows = useMemo(() => {
    if (!sort.key || !SORT_VAL[sort.key]) return rows
    const val = SORT_VAL[sort.key]
    return rows.map((p, i) => [p, i]).sort((A, B) => {
      const r = cmp(val(A[0]), val(B[0]), sort.dir)
      return r !== 0 ? r : A[1] - B[1]
    }).map(([p]) => p)
  }, [rows, sort])

  // ── row virtualization ─────────────────────────────────────────────────────
  // Mount only the rows in (and just around) the viewport, so the table loads
  // fast whether it shows 50 rows or 5,000. Rows are a fixed height, so exact
  // scrollbar geometry comes from spacer rows above and below the window.
  const scrollRef = useRef(null)
  const firstRowRef = useRef(null)
  const rafRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(720)
  const [rowH, setRowH] = useState(36)   // refined from a real row after mount
  const OVERSCAN = 10                     // rows rendered beyond the viewport each side

  // keep the window height in sync with the scroll container
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewportH(el.clientHeight || 720)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // measure the true row height once rows are on screen (zoom/theme can shift
  // it); update only on a real change so this self-stabilizes (no render loop)
  useEffect(() => {
    const h = firstRowRef.current?.offsetHeight
    if (h && Math.abs(h - rowH) > 0.5) setRowH(h)
  })

  // a new row set (filter/search) → jump back to the top
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [rows])

  // cancel any pending scroll rAF on unmount
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const onScroll = () => {
    if (rafRef.current) return  // coalesce a burst of scroll events into one update
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
    })
  }

  const total = sortedRows.length
  const first = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewportH) / rowH) + OVERSCAN)
  const windowRows = sortedRows.slice(first, last)
  const padTop = first * rowH
  const padBottom = Math.max(0, (total - last) * rowH)

  const CHECK_W = 34
  const CHEV_W = 28
  const minTableW = CHECK_W + CHEV_W + visibleCols.reduce((a, c) => a + (c.key === greedyKey ? c.min : widthOf(c.key)), 0)

  const setVis = (k, on) => setPrefs((p) => ({ ...p, vis: { ...p.vis, [k]: on } }))
  const resetCols = () => { setPrefs({ vis: {}, w: {}, order: [] }); setSort({ key: null, dir: 'asc' }) }

  // drag-to-resize a fixed (non-greedy) column
  const startResize = (e, key) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(key)
    const min = COL_BY_KEY[key].min
    const onMove = (ev) => {
      const next = Math.max(min, Math.round(startW + (ev.clientX - startX)))
      setPrefs((p) => ({ ...p, w: { ...p.w, [key]: next } }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const thBase = 'padding:9px 8px;font-weight:600;color:var(--text2);font-size:10.5px;letter-spacing:.04em;border-bottom:1px solid var(--border);position:relative;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
  const cellBase = 'padding:9px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
  // passed to each column's cell(p, ctx) — only the EMAIL column reads it
  const cellCtx = { onEmail, emailOf }

  return (
    <div className="data-table-wrap" style={css('flex:1;display:flex;flex-direction:column;min-height:0;')}>
      {/* toolbar */}
      <div style={css('flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:6px 14px;border-bottom:1px solid var(--border);background:var(--bg);position:relative;')}>
        <div ref={menuRef} style={css('position:relative;')}>
          <button className="hov" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="true" aria-expanded={menuOpen} title="Show, hide, resize, and reorder table columns" style={css('display:flex;align-items:center;gap:7px;height:28px;padding:0 11px;background:var(--surface);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:11.5px;')}>
            <Icon name="list" size={13} sw={1.8} />Columns<span style={css('font-family:var(--mono);color:var(--text3);')}>{visCount}/{COLUMNS.length}</span><Icon name="chevronDown" size={11} sw={2} style={css('color:var(--text3);')} />
          </button>
          {menuOpen && (
            <div style={css('position:absolute;top:34px;right:0;z-index:40;width:224px;background:var(--surface);border:1px solid var(--border2);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.45);padding:7px;')}>
              <div style={css('font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:4px 8px 7px;')}>Visible columns</div>
              <div style={css('max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;')}>
                {order.map((k) => COL_BY_KEY[k]).map((c) => {
                  const on = isVisible(c.key)
                  const last = visCount === 1 && on // don't let the user hide the final column
                  return (
                    <label key={c.key} className="hov" style={css(`display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:6px;font-size:12.5px;cursor:${last ? 'not-allowed' : 'pointer'};color:${on ? 'var(--text)' : 'var(--text3)'};`)}>
                      <input type="checkbox" checked={on} disabled={last} onChange={(e) => setVis(c.key, e.target.checked)} style={css('accent-color:var(--accent);width:14px;height:14px;')} />
                      {c.label}
                    </label>
                  )
                })}
              </div>
              <div style={css('border-top:1px solid var(--border);margin-top:6px;padding-top:6px;')}>
                <div style={css('font-size:10.5px;color:var(--text3);line-height:1.4;padding:0 8px 7px;')}>Drag a column header to reorder.</div>
                <button className="hov" onClick={resetCols} style={css('width:100%;height:30px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text2);font-size:11.5px;')}>Reset to defaults</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* scroll area */}
      <div ref={scrollRef} onScroll={onScroll} style={css('flex:1;overflow:auto;min-height:0;')}>
        <table style={css(`table-layout:fixed;width:100%;min-width:${minTableW}px;border-collapse:collapse;font-size:12.5px;`)}>
          <colgroup>
            <col style={{ width: `${CHECK_W}px` }} />
            {visibleCols.map((c) => (
              <col key={c.key} style={c.key === greedyKey ? undefined : { width: `${widthOf(c.key)}px` }} />
            ))}
            <col style={{ width: `${CHEV_W}px` }} />
          </colgroup>
          <thead>
            <tr style={css('position:sticky;top:0;z-index:2;background:var(--surface);')}>
              <th style={css('padding:9px 0 9px 14px;border-bottom:1px solid var(--border);')}><input type="checkbox" checked={allSel} onChange={onToggleAll} aria-label="Select all" style={css('accent-color:var(--accent);')} /></th>
              {visibleCols.map((c) => {
                const resizable = c.key !== greedyKey
                const active = sort.key === c.key
                const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
                const over = dragKey && dragOver?.key === c.key && dragKey !== c.key
                return (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    onDragOver={dragKey ? (e) => {
                      e.preventDefault()
                      const r = e.currentTarget.getBoundingClientRect()
                      const after = e.clientX > r.left + r.width / 2
                      if (!dragOver || dragOver.key !== c.key || dragOver.after !== after) setDragOver({ key: c.key, after })
                    } : undefined}
                    onDrop={dragKey ? (e) => { e.preventDefault(); moveColumn(dragKey, c.key, dragOver?.key === c.key ? dragOver.after : false); setDragKey(null); setDragOver(null) } : undefined}
                    style={css(thBase + `text-align:${c.align};cursor:pointer;user-select:none;${active ? 'color:var(--text);' : ''}${over ? (dragOver.after ? 'box-shadow:inset -2px 0 0 0 var(--accent);' : 'box-shadow:inset 2px 0 0 0 var(--accent);') : ''}`)}>
                    <span draggable
                      onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.key) } catch { /* some browsers throw if unset */ } }}
                      onDragEnd={() => { setDragKey(null); setDragOver(null) }}
                      title={`${c.label} — click to sort, drag to reorder`}
                      style={css(`cursor:${dragKey === c.key ? 'grabbing' : 'grab'};${dragKey === c.key ? 'opacity:.45;' : ''}`)}>
                      {c.label}<span style={css('font-size:9px;color:var(--accent);')}>{arrow}</span>
                    </span>
                    {resizable && (
                      <span onPointerDown={(e) => startResize(e, c.key)} onClick={(e) => e.stopPropagation()} draggable={false} onDragStart={(e) => e.preventDefault()} className="col-rsz" style={css('position:absolute;top:0;right:0;width:9px;height:100%;cursor:col-resize;touch-action:none;')} />
                    )}
                  </th>
                )
              })}
              <th style={css('border-bottom:1px solid var(--border);')} />
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden="true"><td colSpan={visibleCols.length + 2} style={{ height: padTop, padding: 0, border: 'none' }} /></tr>
            )}
            {windowRows.map((p, i) => (
              <tr ref={i === 0 ? firstRowRef : undefined} key={p.id} className="hov" tabIndex={0} role="button" onClick={() => onOpen(p.id)} style={css(rowStyle(p.cat))}>
                <td style={css('padding:0 0 0 14px;')} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selProps.includes(p.id)} onChange={() => toggleProp(p.id)} aria-label="Select property" style={css('accent-color:var(--accent);')} /></td>
                {visibleCols.map((c) => (
                  <td key={c.key} style={css(cellBase + `text-align:${c.align};color:${c.key === 'addr' ? 'var(--text)' : 'var(--text2)'};${c.key === 'addr' ? 'font-weight:500;' : ''}${c.mono ? 'font-family:var(--mono);font-variant-numeric:tabular-nums;' : ''}`)}>{c.cell(p, cellCtx)}</td>
                ))}
                <td style={css('padding:9px 14px 9px 4px;text-align:right;color:var(--text3);')}><Icon name="chevronRight" size={14} /></td>
              </tr>
            ))}
            {padBottom > 0 && (
              <tr aria-hidden="true"><td colSpan={visibleCols.length + 2} style={{ height: padBottom, padding: 0, border: 'none' }} /></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
