// ───────────────────────────────────────────────────────────────────────────
// SAMPLE DATA — synthetic fallback for the prototype UI (PROPS/BROKERS/DEALS are
// not real SimiCapital deals; the app renders these when no live/demo data loads).
// Exception: the SUBMARKETS/SUPPLY_TOTAL_SF supply figures are real (Sabre-licensed).
// The real Reuse-Finder sweep output was split out to reuseData.js.
// ───────────────────────────────────────────────────────────────────────────

export const MARKETS = ['Nashville', 'Charlotte', 'Columbus', 'Cleveland', 'Cincinnati', 'Charleston', 'Raleigh', 'Orlando', 'Miami', 'Boca Raton', 'West Palm Beach']
export const SOURCES = ['County GIS', 'Crexi', 'Colliers', 'CBRE', 'JLL', 'Cushman', 'Newmark', 'NAI']

// live "Keep Sourcing" per-source progress strip — the real brokerage scrapers.
// `key` matches the scrape backend's source names (/live/status source_counts);
// p (relative bar fill) and c (listing count) are filled in from live status.
// Live scrape sources shown in the sourcing strip. Cushman + NAI were removed
// 2026-07-21 after an audit: both yielded 0 in production. NAI needs a real
// browser session (BuildOut CSRF fails headless — confirmed via the Chrome
// extension); Cushman is revivable headless but is fragile HTML scraping with no
// broker contacts. See scrapers/brokerage.py _BUILTIN_SITES for the full note.
export const SCRAPE_SOURCES = [
  { n: 'CBRE', short: 'CBRE', key: 'cbre', p: 0, c: 0 },
  { n: 'JLL', short: 'JLL', key: 'jll', p: 0, c: 0 },
  { n: 'Colliers', short: 'Coll', key: 'colliers', p: 0, c: 0 },
  { n: 'Newmark', short: 'Nmrk', key: 'newmark', p: 0, c: 0 },
  { n: 'Crexi', short: 'Crexi', key: 'crexi', p: 0, c: 0 },
]

export const PROPS = [
  { id: 1, channel: 'off', addr: '2400 Couchville Pike', mkt: 'Nashville', st: 'TN', lat: 36.103, lng: -86.661, sf: 142000, cat: 'Actionable', score: 88, signal: 'Tax-delinquent · 2yr', owner: 'Couchville Holdings LLC', ownerType: 'LLC', oos: 'TX', clear: 28, year: 1998, contact: 'Skip-traced', x: 23, y: 40, mail: '1200 Main St, Dallas, TX 75201' },
  { id: 2, channel: 'off', addr: '1180 N Graham St', mkt: 'Charlotte', st: 'NC', lat: 35.246, lng: -80.847, sf: 96000, cat: 'Tentative', score: 64, signal: 'Inferred vacant', owner: 'Graham Industrial Trust', ownerType: 'Trust', oos: 'IL', clear: 22, year: 1985, contact: 'No contact', x: 47, y: 31, mail: '55 W Wacker Dr, Chicago, IL 60601' },
  { id: 3, channel: 'off', addr: '5500 Westbelt Dr', mkt: 'Columbus', st: 'OH', lat: 39.974, lng: -83.103, sf: 210000, cat: 'Actionable', score: 81, signal: 'Code violation', owner: 'Westbelt Logistics LLC', ownerType: 'LLC', oos: 'FL', clear: 32, year: 2001, contact: 'Owner phone found', x: 58, y: 21, mail: '700 Brickell Ave, Miami, FL 33131' },
  { id: 4, channel: 'off', addr: '3401 Train Ave', mkt: 'Cleveland', st: 'OH', lat: 41.474, lng: -81.711, sf: 78000, cat: 'Pass', score: 28, signal: 'No material signal', owner: 'Train Ave Properties LLC', ownerType: 'LLC', oos: null, clear: 18, year: 1972, contact: 'No contact', x: 64, y: 13, mail: '3401 Train Ave, Cleveland, OH 44113' },
  { id: 5, channel: 'off', addr: '8120 Reading Rd', mkt: 'Cincinnati', st: 'OH', lat: 39.231, lng: -84.459, sf: 124000, cat: 'Tentative', score: 58, signal: 'Tax-delinquent · 1yr', owner: 'Reading Road LLC', ownerType: 'LLC', oos: null, clear: 24, year: 1990, contact: 'Skip-traced', x: 54, y: 41, mail: '8120 Reading Rd, Cincinnati, OH 45215' },
  { id: 6, channel: 'off', addr: '1450 Meeting St', mkt: 'Charleston', st: 'SC', lat: 32.809, lng: -79.957, sf: 88000, cat: 'Actionable', score: 76, signal: 'Out-of-state · vacant', owner: 'Lowcountry Asset Trust', ownerType: 'Trust', oos: 'NY', clear: 26, year: 1995, contact: 'Owner phone found', x: 73, y: 58, mail: '410 Park Ave, New York, NY 10022' },
  { id: 7, channel: 'on', addr: '4225 Sam Wilson Rd', mkt: 'Charlotte', st: 'NC', lat: 35.268, lng: -80.991, sf: 165000, cat: 'Actionable', score: 84, signal: 'Priced below market', broker: 'Marcus Hale', firm: 'CBRE', ask: 7.85, clear: 32, year: 2016, contact: 'Broker contact', x: 45, y: 35, daysOn: 41 },
  { id: 8, channel: 'on', addr: '900 Aviation Pkwy', mkt: 'Raleigh', st: 'NC', lat: 35.852, lng: -78.787, sf: 118000, cat: 'Tentative', score: 61, signal: 'Long days-on-market', broker: 'Dana Pruitt', firm: 'JLL', ask: 8.20, clear: 28, year: 2008, contact: 'Broker contact', x: 51, y: 37, daysOn: 96 },
  { id: 9, channel: 'on', addr: '2600 Charleston Regional Pkwy', mkt: 'Charleston', st: 'SC', lat: 32.951, lng: -80.053, sf: 192000, cat: 'Actionable', score: 79, signal: 'New to market', broker: 'Will Tanner', firm: 'Colliers', ask: 7.40, clear: 36, year: 2019, contact: 'Broker contact', x: 71, y: 56, daysOn: 12 },
  { id: 10, channel: 'on', addr: '7300 NW 25th St', mkt: 'Miami', st: 'FL', lat: 25.802, lng: -80.317, sf: 134000, cat: 'Pass', score: 35, signal: 'Overpriced vs comps', broker: 'Sofia Reyes', firm: 'Cushman & Wakefield', ask: 11.20, clear: 30, year: 2004, contact: 'Broker contact', x: 77, y: 79, daysOn: 58 },
  { id: 11, channel: 'on', addr: '5151 NW 35th Ave', mkt: 'Boca Raton', st: 'FL', lat: 26.372, lng: -80.128, sf: 72000, cat: 'Tentative', score: 55, signal: 'Small footprint', broker: 'Greg Olin', firm: 'Newmark', ask: 13.50, clear: 24, year: 1999, contact: 'Broker contact', x: 79, y: 74, daysOn: 33 },
  { id: 12, channel: 'on', addr: '1980 Australian Ave', mkt: 'West Palm Beach', st: 'FL', lat: 26.731, lng: -80.072, sf: 88000, cat: 'Actionable', score: 72, signal: 'Value-add play', broker: 'Priya Nair', firm: 'NAI', ask: 12.10, clear: 26, year: 2011, contact: 'Broker contact', x: 80, y: 70, daysOn: 21 },
  { id: 13, channel: 'on', addr: '6100 Westerville Rd', mkt: 'Columbus', st: 'OH', lat: 40.078, lng: -82.913, sf: 240000, cat: 'Actionable', score: 86, signal: 'Class A · below market', broker: 'Marcus Hale', firm: 'CBRE', ask: 6.95, clear: 36, year: 2021, contact: 'Broker contact', x: 60, y: 23, daysOn: 18 },
]

export const BROKERS = [
  { id: 1, name: 'Marcus Hale', firm: 'CBRE', phone: '(704) 555-0142', cell: '(704) 555-8890', email: 'marcus.hale@cbre.com', mkts: 'Charlotte · Columbus', spec: 'Industrial', listings: 7, source: 'Crexi', synced: true },
  { id: 2, name: 'Dana Pruitt', firm: 'JLL', phone: '(919) 555-0188', cell: '(919) 555-4410', email: 'dana.pruitt@jll.com', mkts: 'Raleigh', spec: 'Industrial · Flex', listings: 4, source: 'JLL', synced: false },
  { id: 3, name: 'Will Tanner', firm: 'Colliers', phone: '(843) 555-0119', cell: '(843) 555-7723', email: 'will.tanner@colliers.com', mkts: 'Charleston', spec: 'Industrial', listings: 5, source: 'Colliers', synced: true },
  { id: 4, name: 'Sofia Reyes', firm: 'Cushman & Wakefield', phone: '(305) 555-0177', cell: '(305) 555-2204', email: 'sofia.reyes@cushwake.com', mkts: 'Miami', spec: 'Industrial', listings: 9, source: 'Cushman', synced: false },
  { id: 5, name: 'Greg Olin', firm: 'Newmark', phone: '(561) 555-0133', cell: '(561) 555-9981', email: 'greg.olin@nmrk.com', mkts: 'Boca Raton · WPB', spec: 'Industrial', listings: 3, source: 'Newmark', synced: false },
  { id: 6, name: 'Priya Nair', firm: 'NAI', phone: '(561) 555-0166', cell: '(561) 555-6650', email: 'priya.nair@naicommercial.com', mkts: 'West Palm Beach', spec: 'Industrial · Land', listings: 6, source: 'NAI', synced: true },
  { id: 7, name: 'Tom Becker', firm: 'JLL', phone: '(614) 555-0102', cell: '(614) 555-3318', email: 'tom.becker@jll.com', mkts: 'Columbus', spec: 'Industrial', listings: 8, source: 'Crexi', synced: false },
  { id: 8, name: 'Alyssa Crane', firm: 'Colliers', phone: '(615) 555-0150', cell: '(615) 555-7711', email: 'alyssa.crane@colliers.com', mkts: 'Nashville', spec: 'Industrial · Flex', listings: 5, source: 'Colliers', synced: true },
]

export const DEALS = [
  { deal: 'Park Ave Logistics', prop: '870 Park Ave · Nashville', owner: 'Park Ave Holdings LLC', offer: '$9.2M', cap: '6.8%', status: 'Passed', why: 'Seller countered above buy box', date: 'Mar 2022' },
  { deal: 'Westerville Box', prop: '6100 Westerville Rd · Columbus', owner: 'WV Industrial LLC', offer: '$18.5M', cap: '5.9%', status: 'Under LOI', why: '—', date: 'Jan 2026' },
  { deal: 'Meeting St Warehouse', prop: '1450 Meeting St · Charleston', owner: 'Lowcountry Asset Trust', offer: '$7.1M', cap: '7.2%', status: 'Closed', why: '—', date: 'Aug 2024' },
  { deal: 'Reading Rd Flex', prop: '8120 Reading Rd · Cincinnati', owner: 'Reading Road LLC', offer: '$5.4M', cap: '7.8%', status: 'Passed', why: 'Environmental Phase II flag', date: 'Nov 2023' },
  { deal: 'Sam Wilson Distribution', prop: '4225 Sam Wilson Rd · Charlotte', owner: 'CBRE listing', offer: '$13.0M', cap: '6.4%', status: 'Lost', why: 'Outbid by institutional buyer', date: 'Sep 2025' },
]

// CoStar / Columbus supply model (internal · Sabre-licensed figures)
export const SUPPLY_TOTAL_SF = 9833189
export const SUBMARKETS = [
  { name: 'Hilliard', pct: 57, sf: Math.round(9833189 * 0.57) },
  { name: 'SW Columbus', pct: 17, sf: Math.round(9833189 * 0.17) },
  { name: 'Downtown West', pct: 16, sf: Math.round(9833189 * 0.16) },
  { name: 'Grandview', pct: 9, sf: Math.round(9833189 * 0.09) },
]

