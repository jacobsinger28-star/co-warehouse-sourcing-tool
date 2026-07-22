// build_demo_data.mjs — generate the PUBLIC DEMO dataset (frontend/demo-data.json).
//
// This file is 100% SYNTHETIC. It carries NO real owners, brokers, phones,
// emails, or addresses — everything is procedurally invented (fake LLC names,
// (XXX) 555-01xx reserved phone numbers, @example.com emails). It is SAFE TO
// COMMIT and SAFE TO SERVE PUBLICLY: it is what the /demo surface shows to
// prospects instead of the real, gitignored data.real.json.
//
// The output shape mirrors data.real.json (props[] + brokers[] + meta) so the
// exact same React app renders it with zero special-casing, plus a demo deal
// book (deals[]) for the Deals DB screen.
//
// Deterministic (seeded PRNG, fixed timestamp) so re-running produces a stable
// file — no churn in git. Run:  node tools/build_demo_data.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'demo-data.json')

// ── seeded PRNG (mulberry32) — deterministic output across runs ──────────────
let _s = 1337 >>> 0
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
const round = (n, to = 1000) => Math.round(n / to) * to

// ── market table (center coords + state + area code) ─────────────────────────
const MARKETS = [
  { mkt: 'Charlotte', st: 'NC', lat: 35.227, lng: -80.843, ac: 704 },
  { mkt: 'Raleigh', st: 'NC', lat: 35.780, lng: -78.639, ac: 919 },
  { mkt: 'Charleston', st: 'SC', lat: 32.777, lng: -79.931, ac: 843 },
  { mkt: 'Columbus', st: 'OH', lat: 39.961, lng: -82.999, ac: 614 },
  { mkt: 'Cleveland', st: 'OH', lat: 41.499, lng: -81.694, ac: 216 },
  { mkt: 'Miami', st: 'FL', lat: 25.761, lng: -80.191, ac: 305 },
  { mkt: 'Boca Raton', st: 'FL', lat: 26.368, lng: -80.100, ac: 561 },
  { mkt: 'West Palm Beach', st: 'FL', lat: 26.715, lng: -80.053, ac: 561 },
  { mkt: 'Nashville', st: 'TN', lat: 36.162, lng: -86.781, ac: 615 },
  { mkt: 'Orlando', st: 'FL', lat: 28.538, lng: -81.379, ac: 407 },
]
const OOS = [
  { st: 'TX', city: ['Dallas', 'Houston', 'Austin'] }, { st: 'IL', city: ['Chicago'] },
  { st: 'NY', city: ['New York', 'Brooklyn'] }, { st: 'CA', city: ['Los Angeles', 'San Diego'] },
  { st: 'GA', city: ['Atlanta'] }, { st: 'NJ', city: ['Newark', 'Jersey City'] },
  { st: 'MA', city: ['Boston'] }, { st: 'AZ', city: ['Phoenix'] }, { st: 'PA', city: ['Philadelphia'] },
]

// ── word banks (all invented) ────────────────────────────────────────────────
const STREETS = ['Couchville', 'Westbelt', 'Reading', 'Meeting', 'Aviation', 'Commerce', 'Industrial', 'Sam Wilson', 'Westerville', 'Hazelhurst', 'Rocket', 'Landstreet', 'Foster', 'Antioch', 'Cowan', 'Norris', 'Old Concord', 'Space Park', 'New Hampshire', 'Rio Grande', 'Bartlett', 'Southland', 'Lee Vista', 'Hazeltine', 'Parkway Center', 'Nogales', 'Elm Tree', 'Pecan', 'Westwood', 'Dunn', 'Train', 'Graham', 'Australian', 'Mt Gallant', 'Expressway Park', 'Buick']
const SUFFIX = ['Rd', 'St', 'Ave', 'Dr', 'Blvd', 'Pike', 'Pkwy', 'Ct', 'Way', 'Ln']
const PLACES = ['Maple Ridge', 'Ironwood', 'Cedar Point', 'Northgate', 'Harbor', 'Summit', 'Riverbend', 'Blackstone', 'Greenfield', 'Lakeview', 'Pinecrest', 'Sterling', 'Copperline', 'Whitewater', 'Redstone', 'Foundry', 'Crosscreek', 'Old Mill', 'Kingsway', 'Silverton', 'Fairmount', 'Brookhaven', 'Highpoint', 'Meridian', 'Dockside', 'Warehouse Row', 'Portside', 'Anvil', 'Granite', 'Beacon']
const ENTITY = ['Holdings LLC', 'Industrial LLC', 'Logistics LLC', 'Properties LLC', 'Asset Trust', 'Capital Partners LP', 'Real Estate LLC', 'Warehouse LLC', 'Equities LLC', 'Investments LLC', 'Realty Trust', 'Partners LP']
const OWNER_TYPE_OF = (ent) => (/Trust/.test(ent) ? 'Trust' : / LP$/.test(ent) ? 'Partnership' : 'LLC')
const FIRST = ['Jordan', 'Casey', 'Morgan', 'Avery', 'Riley', 'Quinn', 'Drew', 'Reese', 'Skyler', 'Rowan', 'Emerson', 'Harper', 'Marlowe', 'Sasha', 'Devon', 'Blake', 'Parker', 'Sage', 'Ellis', 'Tatum']
const LAST = ['Ellis', 'Brennan', 'Calloway', 'Vance', 'Marsh', 'Delgado', 'Whitfield', 'Osei', 'Kwan', 'Romano', 'Fletcher', 'Nakamura', 'Abara', 'Petrov', 'Salas', 'Booker', 'Ridley', 'Hoffman', 'Okafor', 'Sandoval']
const FIRMS = ['CBRE', 'JLL', 'Colliers', 'Newmark', 'Crexi', 'Cushman & Wakefield', 'NAI']
const LANDUSE = ['Warehouse', 'Flex / industrial', 'Distribution', 'Manufacturing', 'Truck terminal', 'Cold storage']
const OFF_SIGNALS = ['Out-of-state · vacant', 'Tax-delinquent · 2yr', 'Code violation', 'Inferred vacant', 'Long-held · absentee', 'Permit anomaly', 'Owner-occupier retiring', 'Environmental filing']
const ON_SIGNALS = ['Priced below market', 'Long days-on-market', 'New to market', 'Value-add play', 'Overpriced vs comps', 'Below replacement cost', 'Class A · below market']

const COMP_MAX = { vacancy_evidence: 22, tax_delinquency: 15, proximity_score: 15, physical_fit: 12, code_violations: 12, hold_period: 8, owner_profile: 7, condition_distress: 6, permit_anomaly: 5, year_built_band: 5, truck_access_inverse: 4 }

const catOf = (score) => (score >= 70 ? 'Actionable' : score >= 45 ? 'Tentative' : 'Pass')
const jlat = (m) => +(m.lat + (rnd() - 0.5) * 0.22).toFixed(4)
const jlng = (m) => +(m.lng + (rnd() - 0.5) * 0.30).toFixed(4)
const phone = (ac) => `(${ac}) 555-01${String(ri(0, 99)).padStart(2, '0')}`
const streetAddr = () => `${ri(100, 9900)} ${pick(STREETS)} ${pick(SUFFIX)}`
const emailFrom = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`
const person = () => `${pick(FIRST)} ${pick(LAST)}`
const isoDate = (y0 = 2024, y1 = 2026) => `${ri(y0, y1)}-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`

// distribute exactly `score` points across the distress components (each capped
// at its max), so sum(comp) === score and the drawer breakdown stays consistent.
function synthComp(score) {
  const keys = Object.keys(COMP_MAX)
  const w = keys.map(() => rnd() + 0.05)
  const wsum = w.reduce((a, b) => a + b, 0)
  const comp = {}
  let allocated = 0
  keys.forEach((k, idx) => { const v = Math.min(COMP_MAX[k], Math.round(score * w[idx] / wsum)); comp[k] = v; allocated += v })
  // correct rounding drift so the parts sum to exactly `score`
  let diff = score - allocated
  for (const k of keys.slice().sort(() => rnd() - 0.5)) {
    if (diff === 0) break
    if (diff > 0) { const add = Math.min(COMP_MAX[k] - comp[k], diff); comp[k] += add; diff -= add }
    else { const take = Math.min(comp[k], -diff); comp[k] -= take; diff += take }
  }
  return comp
}

function offProp(i) {
  const m = pick(MARKETS)
  // tier-first so the mix is realistic: ~15% Actionable / ~35% Tentative / ~50% Pass
  const r = rnd()
  const score = r < 0.15 ? ri(70, 95) : r < 0.5 ? ri(45, 69) : ri(8, 44)
  const comp = synthComp(score)
  const cat = catOf(score)
  const ent = pick(ENTITY)
  const owner = `${pick(PLACES)} ${ent}`
  const oosRec = chance(0.55) ? pick(OOS) : null
  const hasPhone = chance(0.5)
  const hasEmail = !hasPhone && chance(0.5)
  const skip = !hasPhone && !hasEmail && chance(0.5)
  const per = (hasPhone || hasEmail || skip) ? person() : null
  const contact = hasPhone ? 'Owner phone found' : hasEmail ? 'Email found' : skip ? 'Skip-traced' : 'No contact'
  const sf = round(ri(42000, 255000), 500)
  const saleY = chance(0.6) ? ri(1998, 2021) : null
  const sigs = []
  if (comp.tax_delinquency > 0) sigs.push({ type: 'tax', detail: `Tax-delinquent — ${ri(1, 3)} years past due per county records`, date: isoDate(2024, 2025) })
  if (comp.code_violations > 0) sigs.push({ type: 'code', detail: 'Open code-enforcement case — exterior / life-safety', date: isoDate(2024, 2025) })
  if (comp.vacancy_evidence > 0) sigs.push({ type: 'vacant', detail: 'Inferred vacant — utility + USPS vacancy signals', date: isoDate(2024, 2025) })
  if (comp.permit_anomaly > 0) sigs.push({ type: 'permit', detail: 'Permit anomaly — no active permits in 6+ years', date: isoDate(2023, 2025) })
  const apn = `${ri(10, 89)}${ri(10000000, 99999999)}0000`
  return {
    id: `off-${apn}`, channel: 'off', addr: streetAddr(), mkt: m.mkt, st: m.st,
    lat: jlat(m), lng: jlng(m), sf, sfTotal: round(sf * (1 + rnd() * 0.4), 500), sfLargest: sf,
    cat, score, signal: pick(OFF_SIGNALS), owner, ownerType: OWNER_TYPE_OF(ent),
    oos: oosRec?.st || null, clear: chance(0.5) ? ri(18, 34) : null, year: chance(0.7) ? ri(1955, 2022) : null,
    contact, apn, comp,
    phones: hasPhone ? [phone(m.ac)] : [], emails: hasEmail ? [emailFrom(per || owner)] : [],
    person: per, personRole: per ? pick(['Manager', 'Member', 'Registered agent', 'Trustee']) : null,
    contactConf: hasPhone ? 'high' : hasEmail ? 'medium' : 'low',
    mail: oosRec ? `${ri(100, 4000)} ${pick(STREETS)} ${pick(SUFFIX)}, ${pick(oosRec.city)}, ${oosRec.st} ${ri(10000, 99999)}` : '—',
    sigs, nViol: comp.code_violations > 0 ? ri(1, 3) : 0, nPermit: comp.permit_anomaly > 0 ? ri(1, 2) : 0,
    lastSale: saleY ? String(saleY) : null, lastPrice: saleY ? round(ri(1200000, 9000000), 10000) : null,
    parcelsInSale: 1, assessed: round(ri(900000, 6500000), 10000),
    holdYears: saleY ? 2026 - saleY : null, distMi: +(ri(1, 18) + rnd()).toFixed(1),
    buildings: ri(1, 4), landUse: pick(LANDUSE), bucket: chance(0.85) ? 'universe' : 'manual review',
  }
}

function onProp(i) {
  const m = pick(MARKETS)
  const r = rnd()
  const score = r < 0.2 ? ri(70, 90) : r < 0.55 ? ri(45, 69) : ri(20, 44)
  return {
    id: `on-${100000 + i}`, channel: 'on', addr: streetAddr(), mkt: m.mkt, st: m.st,
    lat: jlat(m), lng: jlng(m), sf: round(ri(45000, 240000), 500), cat: catOf(score), score,
    signal: pick(ON_SIGNALS), broker: person(), firm: pick(FIRMS),
    ask: +(6.5 + rnd() * 8).toFixed(2), clear: chance(0.5) ? ri(20, 36) : null,
    year: chance(0.6) ? ri(1975, 2023) : null, contact: 'Broker contact',
    daysOn: ri(5, 140), listing_url: '#',
  }
}

function broker(i) {
  const m = MARKETS[i % MARKETS.length]
  const m2 = chance(0.4) ? MARKETS[(i + 3) % MARKETS.length] : null
  const name = person()
  return {
    id: `bk-${i + 1}`, name, firm: pick(FIRMS), phone: phone(m.ac), cell: phone(m.ac),
    email: emailFrom(name), mkts: m2 ? `${m.mkt} · ${m2.mkt}` : m.mkt,
    spec: chance(0.5) ? 'Industrial' : 'Industrial · Flex', listings: ri(2, 11),
    source: pick(FIRMS), synced: chance(0.5),
  }
}

const STAGES = ['Prospect', 'Contacted', 'LOI out', 'Under LOI', 'Diligence', 'Closed']
const PIPELINES = ['Tracking', 'Acquisitions']
const LOST_WHY = ['Seller countered above buy box', 'Outbid by institutional buyer', 'Environmental Phase II flag', 'Financing fell through', 'Owner pulled the listing']
function deal(i) {
  const m = pick(MARKETS)
  const st = pick(['open', 'open', 'open', 'won', 'lost'])
  const stage = st === 'won' ? 'Closed' : st === 'lost' ? pick(STAGES) : pick(STAGES.slice(0, 5))
  const owner = `${pick(PLACES)} ${pick(ENTITY)}`
  const value = round(ri(2400000, 24000000), 100000)
  const title = `${pick(STREETS)} ${pick(['Logistics', 'Distribution', 'Industrial', 'Box', 'Warehouse', 'Flex'])} — ${m.mkt}`
  const why = st === 'lost' ? pick(LOST_WHY) : ''
  const doc = [
    `Deal: ${title}`, `Owner: ${owner} · ${m.mkt}, ${m.st}`,
    `Status: ${st} · ${stage}`, `Our offer: $${(value / 1e6).toFixed(1)}M · cap ${(5.5 + rnd() * 2.5).toFixed(1)}%`,
    why ? `Outcome: ${why}` : `Note: sourced off-market; owner ${chance(0.5) ? 'responsive' : 'slow to engage'}.`,
  ].join('\n')
  return {
    id: 5000 + i, title, status: st, stage, pipeline: pick(PIPELINES), value, currency: 'USD',
    added: isoDate(2023, 2025), updated: isoDate(2025, 2026), person: person(), org: owner,
    notesCount: ri(0, 9), url: '#', why, doc,
  }
}

// ── build ────────────────────────────────────────────────────────────────────
const OFF_N = 400, ON_N = 120, BROK_N = 18, DEAL_N = 42
const off = Array.from({ length: OFF_N }, (_, i) => offProp(i))
const on = Array.from({ length: ON_N }, (_, i) => onProp(i))
const props = [...off, ...on]
const brokers = Array.from({ length: BROK_N }, (_, i) => broker(i))
const deals = Array.from({ length: DEAL_N }, (_, i) => deal(i))

const data = {
  synthetic: true,
  generatedAt: '2026-07-21T00:00:00.000Z',
  source: { note: 'Fully synthetic demo dataset — no real owner/broker/PII. Built by tools/build_demo_data.mjs.' },
  counts: { props: props.length, off: off.length, on: on.length, brokers: brokers.length },
  markets: [...new Set(MARKETS.map((m) => m.mkt))].sort(),
  compMax: COMP_MAX,
  cityLive: {}, cityCeil: {},
  props, brokers, deals,
}

writeFileSync(OUT, JSON.stringify(data))
const mix = off.reduce((a, p) => (a[p.cat] = (a[p.cat] || 0) + 1, a), {})
console.log(`[demo] wrote ${OUT}`)
console.log(`[demo] ${props.length} props (${off.length} off / ${on.length} on), ${brokers.length} brokers, ${deals.length} deals`)
console.log(`[demo] off-market mix:`, mix)
