// Formatting + reusable style-string fragments shared across modules.

export const fmtInt = (n) => Number(n).toLocaleString('en-US')
export const fmtSF = (n) => Number(n).toLocaleString('en-US')
export const fmtMoney2 = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `$${Number(n).toFixed(2)}`)
// asking lease rate ($/SF/yr) — whole dollars stay whole ($19), cents get two
// places ($8.50), so the For Lease badges read cleanly. '' when there's no rate.
export const fmtRate = (n) => (n == null || Number.isNaN(Number(n)) ? '' : `$${Number.isInteger(Number(n)) ? n : Number(n).toFixed(2)}`)
export const fmtPhone = (p) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '') }
export const humanizeSig = (t) => { const s = String(t ?? '').replace(/_/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : 'Signal' }
// short display date for backend UTC ISO stamps (no Z suffix — e.g. first_seen);
// year shown only when it isn't the current one: "Jul 22" / "Jul 22, 2025"
export const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (Number.isNaN(d.getTime())) return '—'
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

export const catVar = (cat) => (cat === 'Actionable' ? '--green' : cat === 'Tentative' ? '--amber' : '--red')
export const catTintVar = (cat) => (cat === 'Actionable' ? '--green-tint' : cat === 'Tentative' ? '--amber-tint' : '--red-tint')

export const scDot = (cat) => `width:6px;height:6px;border-radius:50%;background:var(${catVar(cat)});flex:0 0 auto;`
export const scLabel = (cat) => `color:var(${catVar(cat)});font-weight:500;`

// channel marker — off-market = ring (outline), on-market = filled circle (matches the legend)
export const chDot = (channel) =>
  channel === 'off'
    ? 'width:9px;height:9px;border-radius:50%;border:2px solid var(--off);box-sizing:border-box;flex:0 0 auto;'
    : 'width:9px;height:9px;border-radius:50%;background:var(--on);flex:0 0 auto;'

export const chLabel = (channel) => (channel === 'off' ? 'Off-market' : 'On-market')
export const chTag = (channel) =>
  `font-size:11px;padding:2px 8px;border-radius:5px;white-space:nowrap;color:var(${channel === 'off' ? '--off' : '--on'});background:${channel === 'off' ? 'rgba(147,137,214,.14)' : 'rgba(94,138,192,.14)'};`

// score chip used on mobile cards
export const scChip = (cat) =>
  `display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:2px 8px;border-radius:5px;border:1px solid var(${catVar(cat)});background:var(${catTintVar(cat)});color:var(--text);`

// whole-row tint by score category (subtle)
export const rowStyle = (cat) => `cursor:pointer;border-bottom:1px solid var(--border);background:var(${catTintVar(cat)});`
export const cardStyle = (cat) => `display:flex;flex-direction:column;gap:9px;padding:14px 16px;border-bottom:1px solid var(--border);background:var(${catTintVar(cat)});cursor:pointer;`

// real off-market scoring weights (0–100-capped model); lets the drawer render
// a genuine per-component breakdown from each row's `comp` dict.
export const COMP_MAX = { vacancy_evidence: 22, tax_delinquency: 15, proximity_score: 15, physical_fit: 12, code_violations: 12, hold_period: 8, owner_profile: 7, condition_distress: 6, permit_anomaly: 5, year_built_band: 5, truck_access_inverse: 4 }
const COMP_LABEL = { vacancy_evidence: 'Vacancy evidence', tax_delinquency: 'Tax delinquency', proximity_score: 'Proximity', physical_fit: 'Physical fit', code_violations: 'Code violations', hold_period: 'Hold period', owner_profile: 'Owner profile', condition_distress: 'Condition', permit_anomaly: 'Permit anomaly', year_built_band: 'Year built', truck_access_inverse: 'Truck access' }

// per-component score breakdown for the detail drawer — real `comp` when the
// record carries it (off-market), else a synthetic split from the total.
export const breakdownFor = (p) => {
  if (p.comp && Object.keys(p.comp).length) {
    const entries = Object.entries(p.comp)
      .filter(([k, v]) => COMP_MAX[k] && v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
    if (entries.length)
      return entries.map(([k, v]) => ({
        label: COMP_LABEL[k] ?? k,
        val: `+${Math.round(v)}`,
        barStyle: `height:100%;width:${Math.round((v / COMP_MAX[k]) * 100)}%;background:var(${catVar(p.cat)});border-radius:3px;`,
      }))
  }
  const rows =
    p.channel === 'off'
      ? [['Vacancy evidence', 22], ['Tax delinquency', 15], ['Proximity', 15], ['Owner profile', 12]]
      : [['Buy-box fit', 24], ['Price vs implied', 20], ['Physical specs', 16], ['Days on market', 10]]
  const k = (p.score || 0) / 100
  return rows.map(([label, max]) => {
    const val = Math.round(max * k)
    return { label, val: `+${val}`, barStyle: `height:100%;width:${Math.round((val / max) * 100)}%;background:var(${catVar(p.cat)});border-radius:3px;` }
  })
}

// Hex palette for contexts that can't read CSS vars (Leaflet marker HTML, the
// fixed-white map popup). The hex sibling of catVar; fallback = neutral slate.
export const CAT_HEX = { Actionable: '#22c55e', Tentative: '#f59e0b', Pass: '#ef4444' }
export const CAT_HEX_FALLBACK = '#94a3b8'

// segmented-control style builder — module switcher (shell), map basemap toggle
// (Properties), and the Reuse Finder view segments.
export const seg = (active) =>
  `display:flex;align-items:center;gap:7px;height:28px;padding:0 12px;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;${active ? 'background:var(--surface3);color:var(--text);box-shadow:inset 0 0 0 1px var(--border2);' : 'background:transparent;color:var(--text2);'}`

// table header cell style builder — Properties brokers table + Reuse Finder tables.
export const th = (align = 'left', cls = '') => ({ cls, s: `text-align:${align};padding:9px 8px;font-weight:600;color:var(--text2);font-size:10.5px;letter-spacing:.04em;border-bottom:1px solid var(--border);` })

// surface card + KPI fragments shared by SupplyModel and ReuseFinder.
export const cardBox = 'background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;'
export const kpiLabel = 'font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);'
export const kpiNum = 'font-family:var(--mono);font-size:26px;font-weight:500;margin-top:7px;'
