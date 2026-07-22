import { css } from '../css.js'
import { fmtSF, fmtInt, fmtMoney2, fmtPhone, fmtDate, COMP_MAX, CAT_HEX, CAT_HEX_FALLBACK } from '../helpers.js'

// Full-detail map popup — parity with the off-market tool's map popup
// (offmarket-scraping/tools/make_map.py): APN, score vs the market's *reachable*
// ceiling, owner/contact/mailing, building + clear-height provenance, sale price
// with bulk / non-arm's-length handling, per-component score breakdown, the
// imagery/VLM site assessment and the distress-evidence list.

const COMP_LABEL = {
  proximity_score: 'Proximity', vacancy_evidence: 'Vacancy', tax_delinquency: 'Tax delinq.',
  physical_fit: 'Physical fit', code_violations: 'Violations', hold_period: 'Hold period',
  owner_profile: 'Owner profile', permit_anomaly: 'Permit anomaly', year_built_band: 'Year-built',
  condition_distress: 'Condition', truck_access_inverse: 'Truck access',
}
const CONF_HEX = { high: '#16a34a', medium: '#d97706', low: '#64748b' }

const MUTED = 'color:#94a3b8;'
const label = 'font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;padding:2.5px 8px 2.5px 0;white-space:nowrap;vertical-align:top;'
const value = 'font-size:11px;color:#475569;padding:2.5px 0;line-height:1.45;'

function chip(text, color, strong = false) {
  return (
    <span key={text} style={css(`font-size:10px;padding:1px 6px;border-radius:4px;background:${color}${strong ? '2b' : '1a'};color:${color};border:1px solid ${color}55;`)}>{text}</span>
  )
}

// signal chips: owner type (trust/individual = warm leads), out-of-state,
// manual review, SF mismatch, violations, no-permits — same set as the old map
export function sigChips(p) {
  const c = []
  if (p.isNew) c.push(['new this run', '#0d9488'])
  const ot = (p.ownerType || '').toLowerCase()
  if (p.ownerType && p.ownerType !== '—') c.push([p.ownerType, ot === 'trust' || ot === 'individual' ? '#dc2626' : '#64748b'])
  if (p.oos) c.push(['out-of-state', '#7c6fd6'])
  if (p.bucket && p.bucket !== 'universe') c.push(['manual review', '#64748b'])
  if (p.sfCheck === 'mismatch') c.push(['SF mismatch', '#dc2626'])
  if (p.nViol > 0) c.push([`${p.nViol} violation${p.nViol > 1 ? 's' : ''}`, '#dc2626'])
  if (p.nPermit > 0) c.push(['no recent permits', '#d97706'])
  return c
}

// county feeds jam "Type: X Description: Y Additional Comments: Z" into one blob,
// permit anomalies carry a machine-key prefix — pull out the readable part
function cleanEv(s) {
  const t = String(s.detail || '').trim()
  if (s.type === 'permit_anomaly') return { typ: '', desc: t.replace(/^[a-z0-9_]+:\s*/, '') }
  let typ = ''
  let desc = t
  const di = t.search(/Description:/i)
  if (di >= 0) {
    const ti = t.search(/Type:/i)
    if (ti >= 0 && ti < di) typ = t.slice(ti + 5, di).trim().replace(/^Property Violations\s*-\s*/i, '').trim()
    desc = t.slice(di + 12)
    const ai = desc.search(/Additional Comments:/i)
    if (ai >= 0) desc = desc.slice(0, ai)
    desc = desc.trim()
  }
  return { typ, desc }
}

// last sale price + $/SF; a bulk/portfolio sale (same date+price on >1 parcel) or
// an absurd >$1,000/SF figure gets the total but the meaningless per-SF suppressed
function salePriceEl(p) {
  if (!p.lastSale) return '—'
  const sf = p.sfTotal || p.sf
  if (!p.lastPrice) return <>$0 <span style={css(MUTED)}>($0 / non-arm's-length recorded)</span></>
  const psf = sf ? p.lastPrice / sf : 0
  if ((p.parcelsInSale ?? 1) > 1 || psf > 1000)
    return <>${fmtInt(p.lastPrice)} <span style={css(MUTED)}>· {(p.parcelsInSale ?? 1) > 1 ? `${p.parcelsInSale}-parcel bulk sale` : 'bulk/portfolio?'} — per-SF n/a</span></>
  return <>${fmtInt(p.lastPrice)}{psf ? <span style={css(MUTED)}> · ${psf.toFixed(2)}/SF</span> : null}</>
}

function contactEl(p) {
  const hasP = p.phones?.length > 0
  const hasE = p.emails?.length > 0
  if (!hasP && !hasE && !p.person) return <span style={css(MUTED)}>— no source-backed contact yet</span>
  return (
    <>
      {p.person && (
        <div style={css('color:#0f172a;font-weight:600;')}>
          {p.person}
          {p.personRole && <span style={css(MUTED + 'font-weight:400;')}> ({String(p.personRole).replace(/_/g, ' ')})</span>}
        </div>
      )}
      {hasP && (
        <div>
          {p.phones.map((ph, i) => (
            <span key={i}>{i > 0 && <span style={css('color:#cbd5e1;')}> · </span>}<a href={`tel:${String(ph).replace(/\D/g, '')}`} style={css('color:#2563eb;text-decoration:none;')}>{fmtPhone(ph)}</a></span>
          ))}
          {p.contactConf && chipConf(p.contactConf)}
        </div>
      )}
      {hasE && (
        <div>
          {p.emails.map((e, i) => (
            <span key={i}>{i > 0 && <span style={css('color:#cbd5e1;')}> · </span>}<a href={`mailto:${e}`} style={css('color:#2563eb;text-decoration:none;')}>{e}</a></span>
          ))}
          {!hasP && p.contactConf && chipConf(p.contactConf)}
        </div>
      )}
    </>
  )
}
function chipConf(cc) {
  const c = CONF_HEX[cc] || '#64748b'
  return <span style={css(`margin-left:6px;font-size:9.5px;padding:1px 6px;border-radius:4px;background:${c}1a;color:${c};border:1px solid ${c}55;`)}>{cc} confidence</span>
}

function Facts({ p }) {
  const sfTotal = p.sfTotal || p.sf
  const rows = [
    ['Owner', <><b style={css('color:#0f172a;font-weight:600;')}>{p.owner}</b>{p.ownerType && p.ownerType !== '—' ? <span style={css(MUTED)}> ({p.ownerType}{p.oos ? ', out-of-state' : ''})</span> : null}</>],
    ['Contact', contactEl(p)],
    ['Mailing', p.mail && p.mail !== '—' ? p.mail : '—'],
    ['Land use', p.landUse || '—'],
    ['Building', <>{fmtSF(sfTotal)} SF total{p.sfLargest && p.sfLargest !== sfTotal ? ` · largest ${fmtSF(p.sfLargest)} SF` : ''}{p.buildings ? ` · ${p.buildings} building${p.buildings > 1 ? 's' : ''}` : ''}</>],
    ['Clear height', p.clear != null
      ? <>~{p.clear} ft <span style={css(MUTED)}>{p.clearSrc || 'est'} roof est — interior ~2–4 ft less</span></>
      : <span style={css(MUTED)}>— no LiDAR estimate</span>],
    ['Year built', p.year ? String(p.year) : '—'],
    ['Assessed', p.assessed > 1
      ? <>${fmtInt(p.assessed)}{sfTotal ? <span style={css(MUTED)}> · ${(p.assessed / sfTotal).toFixed(2)}/SF</span> : null}</>
      : <span style={css(MUTED)}>— not in county feed</span>],
    ['Last sale', p.lastSale || '—'],
    ['Sale price', salePriceEl(p)],
    ['Location', p.distMi != null ? <>{p.distMi} mi to core{p.holdYears != null ? ` · held ${Math.round(p.holdYears)} yr` : ''}</> : '—'],
  ]
  return (
    <table style={css('border-collapse:collapse;width:100%;margin:2px 0 4px;')}>
      <tbody>
        {rows.map(([l, v]) => (
          <tr key={l}>
            <td style={css(label)}>{l}</td>
            <td style={css(value)}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// reachable ceiling for a row's market — dormant components (no scored row in that
// market earns them yet) don't count toward it; falls back to the full model cap
function ceilFor(p, meta) {
  return meta?.cityCeil?.[p.mkt] || Object.values(COMP_MAX).reduce((a, b) => a + b, 0)
}

function Breakdown({ p, meta }) {
  const comp = p.comp || {}
  if (!Object.keys(comp).length)
    return <div style={css('font-size:10.5px;color:#94a3b8;margin:6px 0;')}>Not scored — {p.gate || 'manual review'}</div>
  const cmax = meta?.compMax || COMP_MAX
  const liveKeys = meta?.cityLive?.[p.mkt] || Object.keys(cmax).filter((k) => Object.keys(comp).includes(k))
  const live = Object.keys(cmax).filter((k) => liveKeys.includes(k)).map((k) => [k, comp[k] || 0, cmax[k]]).sort((a, b) => b[1] - a[1])
  const dormant = Object.keys(cmax).filter((k) => !liveKeys.includes(k))
  const barColor = CAT_HEX[p.cat] ?? CAT_HEX_FALLBACK
  return (
    <div style={css('margin:7px 0 4px;')}>
      <div style={css('font-size:10.5px;font-weight:600;color:#475569;margin-bottom:5px;')}>
        Score breakdown — <b style={css('color:#0f172a;')}>{p.score}</b> of {ceilFor(p, meta)} reachable in {p.mkt || 'this market'}
      </div>
      <div style={css('display:grid;grid-template-columns:auto 1fr auto;gap:3px 7px;align-items:center;')}>
        {live.map(([k, v, mx]) => (
          <div key={k} style={css('display:contents;')}>
            <div style={css('font-size:10px;color:#64748b;white-space:nowrap;')}>{COMP_LABEL[k] || k.replace(/_/g, ' ')}</div>
            <div style={css('height:5px;border-radius:3px;background:#e2e8f0;overflow:hidden;min-width:60px;')}>
              <i style={css(`display:block;height:100%;width:${mx ? Math.round((v / mx) * 100) : 0}%;background:${v > 0 ? barColor : 'transparent'};border-radius:3px;`)} />
            </div>
            <div style={css('font-size:10px;color:#64748b;font-variant-numeric:tabular-nums;white-space:nowrap;')}><b style={css('color:#0f172a;')}>{+v}</b>/{mx}</div>
          </div>
        ))}
      </div>
      {dormant.length > 0 && (
        <div style={css('font-size:9.5px;color:#94a3b8;margin-top:5px;line-height:1.5;')}>
          Locked until imagery + tax land: {dormant.map((k) => `${COMP_LABEL[k] || k.replace(/_/g, ' ')} ${(meta?.compMax || COMP_MAX)[k]}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

function occLabel(park, sign) {
  if (park === 'empty' && sign === 'no') return 'vacancy signals — empty lot, no signage'
  if (park === 'empty' || park === 'sparse' || sign === 'no') return 'possible vacancy — sparse / no signage'
  if (park === 'not_visible' && sign === 'not_visible') return 'occupancy unclear from imagery'
  if (!park && !sign) return 'not assessed'
  return 'clearly active (occupied)'
}

function SiteAssess({ p }) {
  const o = p.obs
  if (!o) return null
  const phys = []
  if (o.docks != null) phys.push(`~${o.docks} docks`)
  if (o.drive != null) phys.push(`~${o.drive} drive-ins`)
  if (o.div) phys.push(`divisibility ${o.div}`)
  if (o.truck) phys.push(`truck ${o.truck}`)
  if (o.cond) phys.push(`condition ${o.cond}`)
  const rows = [
    ['Occupancy', <>{occLabel(o.park, o.sign)} <span style={css(MUTED)}>(parking {o.park || '—'}, signage {o.sign || '—'})</span></>],
    ...(o.use ? [['Observed use', <>{o.use}{o.match === false ? <b style={css('color:#dc2626;')}> — ⚠️ no longer matches assessor land use</b> : o.match === true ? <span style={css(MUTED)}> ✓ matches land use</span> : null}</>]] : []),
    ...(o.ten?.length ? [['Tenant(s)', <>{o.ten.join(', ')}{(o.tency || o.occ) && <span style={css(MUTED)}> ({[o.tency, o.occ].filter(Boolean).join(' / ')})</span>}</>]] : []),
    ...(phys.length ? [['Physical', phys.join(' · ')]] : []),
    ...(o.ctx ? [['Context', o.ctx]] : []),
    ...(o.note ? [['Observed', o.note]] : []),
  ]
  return (
    <div style={css('margin:7px 0 4px;')}>
      <div style={css('font-size:10.5px;font-weight:600;color:#475569;margin-bottom:3px;')}>Site assessment <span style={css(MUTED + 'font-weight:400;')}>(imagery / VLM)</span></div>
      <table style={css('border-collapse:collapse;width:100%;')}>
        <tbody>
          {rows.map(([l, v]) => (
            <tr key={l}><td style={css(label)}>{l}</td><td style={css(value)}>{v}</td></tr>
          ))}
        </tbody>
      </table>
      {o.src && (
        <div style={css('font-size:10px;color:#94a3b8;margin-top:2px;')}>
          source: <a href={o.src} target="_blank" rel="noreferrer" style={css('color:#2563eb;text-decoration:none;')}>satellite imagery ↗</a>{o.cap ? ` · ${o.cap}` : ''}{o.ver ? ` · ${o.ver}` : ''}
        </div>
      )}
    </div>
  )
}

function Evidence({ p }) {
  if (!p.sigs?.length) return null
  return (
    <div style={css('margin:7px 0 4px;')}>
      <div style={css('font-size:10.5px;font-weight:600;color:#475569;margin-bottom:4px;')}>Distress evidence</div>
      <div style={css('display:flex;flex-direction:column;gap:4px;')}>
        {p.sigs.map((s, i) => {
          const v = s.type === 'code_violation'
          const vis = s.type === 'visual_distress'
          const tag = v ? 'Violation' : vis ? 'Visual' : 'Permit'
          const c = v || vis ? '#dc2626' : '#d97706'
          const { typ, desc } = cleanEv(s)
          return (
            <div key={i} style={css('display:flex;gap:6px;align-items:flex-start;')}>
              <span style={css(`flex:0 0 auto;font-size:9px;padding:1px 5px;border-radius:4px;background:${c}1a;color:${c};border:1px solid ${c}55;margin-top:1px;`)}>{tag}</span>
              <div style={css('font-size:10.5px;color:#475569;line-height:1.45;')}>
                {s.date && <span style={css(MUTED)}>{s.date} · </span>}
                {typ && <b>{typ} — </b>}{desc}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PropPopup({ p, meta, onOpen }) {
  const qy = encodeURIComponent(`${p.addr}, ${p.mkt || ''}${p.st ? ` ${p.st}` : ''}`)
  const catColor = CAT_HEX[p.cat] ?? CAT_HEX_FALLBACK
  const scored = p.comp && Object.keys(p.comp).length > 0
  const ceil = ceilFor(p, meta)

  return (
    <div style={css('min-width:264px;max-width:320px;font-family:inherit;')}>
      {/* header: address (google-search link) + city · APN */}
      <a href={`https://www.google.com/search?q=${qy}`} target="_blank" rel="noreferrer" style={css('font-weight:600;font-size:13px;color:#0f172a;text-decoration:none;')}>{p.addr} ↗</a>
      <div style={css('font-size:11px;color:#64748b;margin-bottom:6px;')}>
        {p.mkt}{p.st ? `, ${p.st}` : ''}{p.apn ? ` · APN ${p.apn}` : ''}{p.landUse && p.channel === 'on' ? ` · ${p.landUse}` : ''}
      </div>

      {/* score vs the market's reachable ceiling */}
      <div style={css('display:flex;align-items:center;gap:6px;font-size:11.5px;margin-bottom:6px;flex-wrap:wrap;')}>
        <span style={css(`width:6px;height:6px;border-radius:50%;background:${catColor};flex:0 0 auto;`)} />
        <span style={css(`color:${catColor};font-weight:600;`)}>{p.cat}</span>
        {p.channel === 'off' && scored
          ? <span style={css('color:#475569;font-weight:600;')}>Score {p.score} / {ceil}<span style={css(MUTED + 'font-weight:400;')}> ({Math.round((p.score / ceil) * 100)}% fit)</span></span>
          : <span style={css('color:#94a3b8;')}>{p.channel === 'off' ? 'manual review' : p.score}</span>}
        <span style={css('color:#94a3b8;')}>· {p.channel === 'off' ? 'Off-market' : 'On-market'}</span>
      </div>

      {p.channel === 'off' ? (
        <>
          {sigChips(p).length > 0 && (
            <div style={css('display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px;')}>
              {sigChips(p).map(([t, c]) => chip(t, c))}
            </div>
          )}
          <Facts p={p} />
          <Breakdown p={p} meta={meta} />
          <SiteAssess p={p} />
          <Evidence p={p} />
        </>
      ) : (
        <>
          <div style={css('font-size:11px;color:#475569;margin-bottom:6px;line-height:1.5;')}>
            {fmtSF(p.sf)} SF{p.clear != null ? ` · ${p.clear}′ clear` : ''}{p.year ? ` · built ${p.year}` : ''}{p.ask != null ? ` · ${fmtMoney2(p.ask)}/SF` : ''}{p.daysOn != null ? ` · ${p.daysOn} DOM` : ''}{p.firstSeen ? ` · added ${fmtDate(p.firstSeen)}` : ''}{p.updated && fmtDate(p.updated) !== fmtDate(p.firstSeen) ? ` · updated ${fmtDate(p.updated)}` : ''}
          </div>
          <div style={css('font-size:11px;color:#475569;margin-bottom:7px;')}>
            {p.broker} · {p.firm}
            {p.listing_url && <> · <a href={p.listing_url} target="_blank" rel="noreferrer" style={css('color:#2563eb;text-decoration:none;')}>listing ↗</a></>}
          </div>
        </>
      )}

      <div style={css('display:flex;gap:6px;align-items:center;margin-top:8px;')}>
        {onOpen && (
          <button
            onClick={() => onOpen(p.id)}
            style={css('flex:1;height:28px;background:var(--accent);border:none;border-radius:6px;color:#06120F;font-weight:600;font-size:11.5px;cursor:pointer;')}
          >
            Open record
          </button>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${qy}`}
          target="_blank"
          rel="noreferrer"
          style={css('flex:0 0 auto;display:flex;align-items:center;height:28px;padding:0 10px;border:1px solid #e2e8f0;border-radius:6px;color:#2563eb;font-size:11px;text-decoration:none;')}
        >
          Maps ↗
        </a>
      </div>
    </div>
  )
}
