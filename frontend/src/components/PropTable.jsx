import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { fmtSF, fmtMoney2, scDot, scLabel, chDot, rowStyle } from '../helpers.js'

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
    <>{p.addr}{p.lease && (
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
]
const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c]))
const ORDER = COLUMNS.map((c) => c.key)
// greedy priority: whichever of these is visible absorbs slack (no fixed width,
// no resize handle) so the table always fills 100% with no dead gap.
const GREEDY_PRIORITY = ['owner', 'addr', 'signal', 'score', 'contact']
const STORE_KEY = 'simicap.propcols.v1'

const loadPrefs = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    return { vis: raw.vis && typeof raw.vis === 'object' ? raw.vis : {}, w: raw.w && typeof raw.w === 'object' ? raw.w : {} }
  } catch { return { vis: {}, w: {} } }
}

export default function PropTable({ rows, selProps, toggleProp, allSel, onToggleAll, onOpen }) {
  const [prefs, setPrefs] = useState(loadPrefs) // { vis:{key:bool}, w:{key:px} }
  const [menuOpen, setMenuOpen] = useState(false)
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

  const isVisible = (k) => prefs.vis[k] !== false // default visible
  const widthOf = (k) => prefs.w[k] ?? COL_BY_KEY[k].w
  const visibleCols = useMemo(() => ORDER.filter(isVisible).map((k) => COL_BY_KEY[k]), [prefs.vis]) // eslint-disable-line
  const visCount = visibleCols.length
  // pick the greedy (stretch) column among the visible ones
  const greedyKey = useMemo(() => {
    const vis = new Set(visibleCols.map((c) => c.key))
    return GREEDY_PRIORITY.find((k) => vis.has(k)) || (visibleCols[0]?.key ?? null)
  }, [visibleCols])

  const CHECK_W = 34
  const CHEV_W = 28
  const minTableW = CHECK_W + CHEV_W + visibleCols.reduce((a, c) => a + (c.key === greedyKey ? c.min : widthOf(c.key)), 0)

  const setVis = (k, on) => setPrefs((p) => ({ ...p, vis: { ...p.vis, [k]: on } }))
  const resetCols = () => setPrefs({ vis: {}, w: {} })

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

  return (
    <div className="data-table-wrap" style={css('flex:1;display:flex;flex-direction:column;min-height:0;')}>
      {/* toolbar */}
      <div style={css('flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:6px 14px;border-bottom:1px solid var(--border);background:var(--bg);position:relative;')}>
        <div ref={menuRef} style={css('position:relative;')}>
          <button className="hov" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="true" aria-expanded={menuOpen} title="Show, hide, and resize table columns" style={css('display:flex;align-items:center;gap:7px;height:28px;padding:0 11px;background:var(--surface);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:11.5px;')}>
            <Icon name="list" size={13} sw={1.8} />Columns<span style={css('font-family:var(--mono);color:var(--text3);')}>{visCount}/{COLUMNS.length}</span><Icon name="chevronDown" size={11} sw={2} style={css('color:var(--text3);')} />
          </button>
          {menuOpen && (
            <div style={css('position:absolute;top:34px;right:0;z-index:40;width:224px;background:var(--surface);border:1px solid var(--border2);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.45);padding:7px;')}>
              <div style={css('font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:4px 8px 7px;')}>Visible columns</div>
              <div style={css('max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;')}>
                {COLUMNS.map((c) => {
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
                <button className="hov" onClick={resetCols} style={css('width:100%;height:30px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text2);font-size:11.5px;')}>Reset to defaults</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* scroll area */}
      <div style={css('flex:1;overflow:auto;min-height:0;')}>
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
                return (
                  <th key={c.key} title={c.label} style={css(thBase + `text-align:${c.align};`)}>
                    {c.label}
                    {resizable && (
                      <span onPointerDown={(e) => startResize(e, c.key)} className="col-rsz" style={css('position:absolute;top:0;right:0;width:9px;height:100%;cursor:col-resize;touch-action:none;')} />
                    )}
                  </th>
                )
              })}
              <th style={css('border-bottom:1px solid var(--border);')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hov" tabIndex={0} role="button" onClick={() => onOpen(p.id)} style={css(rowStyle(p.cat))}>
                <td style={css('padding:0 0 0 14px;')} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selProps.includes(p.id)} onChange={() => toggleProp(p.id)} aria-label="Select property" style={css('accent-color:var(--accent);')} /></td>
                {visibleCols.map((c) => (
                  <td key={c.key} style={css(cellBase + `text-align:${c.align};color:${c.key === 'addr' ? 'var(--text)' : 'var(--text2)'};${c.key === 'addr' ? 'font-weight:500;' : ''}${c.mono ? 'font-family:var(--mono);font-variant-numeric:tabular-nums;' : ''}`)}>{c.cell(p)}</td>
                ))}
                <td style={css('padding:9px 14px 9px 4px;text-align:right;color:var(--text3);')}><Icon name="chevronRight" size={14} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
