// Formatting + reusable style-string fragments shared across modules.

export const fmtInt = (n) => Number(n).toLocaleString('en-US')
export const fmtSF = (n) => Number(n).toLocaleString('en-US')
export const fmtMoney2 = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `$${Number(n).toFixed(2)}`)
export const fmtPhone = (p) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '') }
export const humanizeSig = (t) => { const s = String(t ?? '').replace(/_/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : 'Signal' }

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

// map pin: off = ring, on = teardrop; colored by score; positioned at p.x/p.y
export const pinStyle = (p, hovered = false) => {
  const color = `var(${catVar(p.cat)})`
  const base = `position:absolute;left:${p.x}%;top:${p.y}%;width:15px;height:15px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.5);z-index:${hovered ? 9 : 5};`
  const scale = hovered ? ' scale(1.3)' : ''
  return p.channel === 'off'
    ? `${base}border-radius:50%;background:transparent;border:2.5px solid ${color};transform:translate(-50%,-50%)${scale};`
    : `${base}border-radius:50% 50% 50% 0;background:${color};border:1.5px solid var(--bg);transform:translate(-50%,-50%) rotate(-45deg)${scale};`
}

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

// a few city labels for the faux basemap (positioned to sit near their pins)
export const MAP_LABELS = [
  { name: 'Columbus', x: 58, y: 16 },
  { name: 'Charlotte', x: 44, y: 28 },
  { name: 'Charleston', x: 74, y: 50 },
  { name: 'Miami', x: 80, y: 84 },
]
