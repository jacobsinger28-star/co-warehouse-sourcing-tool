// ───────────────────────────────────────────────────────────────────────────
// SAMPLE DATA — synthetic, for the prototype UI only. Not real SimiCapital deals.
// Ported from the Claude Design handoff; replace with live backend data on wire-up.
// ───────────────────────────────────────────────────────────────────────────

export const MARKETS = ['Nashville', 'Charlotte', 'Columbus', 'Cleveland', 'Cincinnati', 'Charleston', 'Raleigh', 'Miami', 'Boca Raton', 'West Palm Beach']
export const SOURCES = ['County GIS', 'Crexi', 'Colliers', 'CBRE', 'JLL', 'Cushman', 'Newmark', 'NAI']

// live "Keep Sourcing" per-source progress strip
export const SCRAPE_SOURCES = [
  { n: 'County GIS', short: 'GIS', p: 0.62 },
  { n: 'Crexi', short: 'Crexi', p: 0.41 },
  { n: 'Colliers', short: 'Coll', p: 0.78 },
  { n: 'CBRE', short: 'CBRE', p: 0.55 },
  { n: 'JLL', short: 'JLL', p: 0.33 },
  { n: 'Cushman', short: 'Cush', p: 0.69 },
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

export const EXAMPLE_QUERIES = [
  "Have we ever LOI'd this owner?",
  'What did we offer on Park Ave in 2022?',
  'List deals we passed for cap rate',
]

// CoStar / Columbus supply model (internal · Sabre-licensed figures)
export const SUPPLY_TOTAL_SF = 9833189
export const SUBMARKETS = [
  { name: 'Hilliard', pct: 57, sf: Math.round(9833189 * 0.57) },
  { name: 'SW Columbus', pct: 17, sf: Math.round(9833189 * 0.17) },
  { name: 'Downtown West', pct: 16, sf: Math.round(9833189 * 0.16) },
  { name: 'Grandview', pct: 9, sf: Math.round(9833189 * 0.09) },
]

// AI Caller sample state
export const CALL_QUEUE = [
  { addr: '2400 Couchville Pike', owner: 'Couchville Holdings LLC', phone: '(615) 555-2210', score: 88, cat: 'Actionable', last: '—' },
  { addr: '5500 Westbelt Dr', owner: 'Westbelt Logistics LLC', phone: '(614) 555-6677', score: 81, cat: 'Actionable', last: 'queued' },
  { addr: '1450 Meeting St', owner: 'Lowcountry Asset Trust', phone: '(843) 555-9043', score: 76, cat: 'Actionable', last: '—' },
  { addr: '8120 Reading Rd', owner: 'Reading Road LLC', phone: '(513) 555-3380', score: 58, cat: 'Tentative', last: 'warm 34m' },
  { addr: '1180 N Graham St', owner: 'Graham Industrial Trust', phone: '(704) 555-1190', score: 64, cat: 'Tentative', last: '—' },
  { addr: '3401 Train Ave', owner: 'Train Ave Properties LLC', phone: '(216) 555-7720', score: 28, cat: 'Pass', last: 'DNC 26m' },
]

export const ACTIVE_CALL = { phone: '(615) 555-2210', owner: 'Couchville Holdings LLC', addr: '2400 Couchville Pike' }

export const TRANSCRIPT = [
  { who: 'AI', text: 'Hi, this is an automated assistant calling on behalf of SimiCapital. This call may be recorded.' },
  { who: 'Owner', text: 'Okay… what is this regarding?' },
  { who: 'AI', text: "We're reaching out about your property at 2400 Couchville Pike — would you ever consider a sale?" },
]

export const RECENT_CALLS = [
  { owner: 'Reading Road LLC', addr: '8120 Reading Rd', disp: 'Warm', time: '6m' },
  { owner: 'Westbelt Logistics LLC', addr: '5500 Westbelt Dr', disp: 'No answer', time: '11m' },
  { owner: 'Graham Industrial Trust', addr: '1180 N Graham St', disp: 'Not interested', time: '18m' },
  { owner: 'Train Ave Properties LLC', addr: '3401 Train Ave', disp: 'Do-not-call', time: '26m' },
  { owner: 'Couchville Holdings LLC', addr: '2400 Couchville Pike', disp: 'Warm', time: '34m' },
]

// ───────────────────────────────────────────────────────────────────────────
// ADAPTIVE REUSE FINDER — REAL sweep output (not synthetic).
// Provenance: adaptive-reuse-finder/output/adaptive_reuse_candidates.csv, the
// Street View reuse-detection sweep (human-VLM via the Claude-in-Chrome extension,
// 2026-06-25). One row per classified stop. The gate: a building is "reuse" only if
// its CURRENT use ≠ what the envelope was built for — original use still operating
// caps likelihood low. See adaptive-reuse-finder/docs/METHODOLOGY.md + output/SCHEMA.md.
// ───────────────────────────────────────────────────────────────────────────
export const REUSE_AREAS = [
  { area: 'Downtown West Columbus', mkt: 'Columbus', st: 'OH', stops: 1 },
  { area: 'Orlando focus', mkt: 'Orlando', st: 'FL', stops: 1 },
]

export const REUSE_CANDIDATES = [
  {
    id: 'downtown_west_columbus-001',
    area: 'Downtown West Columbus',
    addr: '47 Belle St',
    street: 'Belle Street',
    mkt: 'Columbus',
    st: 'OH',
    lat: 39.959869,
    lng: -83.0086,
    assessedAt: '2026-06-25',
    captureDate: '2025-09',
    likelihood: 0.2,
    band: 'low',
    signals: ['B · industrial-style multi-pane windows', 'C · ground-floor storefront under residential'],
    originalUse: 'Purpose-built mixed-use, industrial aesthetic (uncertain)',
    currentUse: 'Mixed-use — ground-floor cafe/retail + residential/office above',
    useMismatch: false,
    needsReview: true,
    reviewReason: 'Confirm year_built via Franklin County GIS — post-2015 construction settles this as new-build imitation, not a genuine warehouse conversion. The parcel record is the tiebreaker.',
    reasoning:
      'Multi-story brick facade with large dark-framed multi-pane windows reads industrial, but the brick is crisp/uniform with a decorative-relief motif and uniform modern window units — characteristic of new-build industrial-aesthetic construction in the Peninsula / East Franklinton redevelopment, not an aged converted shell. Capped low per the imitation-newbuild knock-down.',
    streetviewUrl: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=39.959869,-83.008600&heading=261.4&pitch=0&fov=80',
  },
  {
    id: 'orlando_focus-001',
    area: 'Orlando focus',
    addr: '1900 W New Hampshire St',
    street: 'W New Hampshire St',
    mkt: 'Orlando',
    st: 'FL',
    lat: 28.5657714,
    lng: -81.4062631,
    assessedAt: '2026-06-25',
    captureDate: '2026-03',
    likelihood: 0.05,
    band: 'very_low',
    signals: [],
    originalUse: 'Factory / industrial warehouse (1962)',
    currentUse: 'Active industrial — building-materials distribution, multi-tenant (Marjam Supply)',
    useMismatch: false,
    needsReview: false,
    reviewReason: '',
    reasoning:
      'Original-use industrial: maintained 1962 brick factory + metal warehouse still in building-materials distribution use. Gate fails — not a conversion. Strong small-bay / flex CANDIDATE on specs, but for-lease / on-market / not distressed; full read in output/assessments/1900-w-new-hampshire-orlando.md.',
    streetviewUrl: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=28.5657714,-81.4062631&heading=0&pitch=0&fov=90',
  },
]

export const BUYBOX_TARGET = { sfMin: 85000, sfMax: 165000 }

// Seed listings = the founder's example properties, pasted from a Teams chat to
// TRAIN the buy-box (the agent learns the target profile from these, then scrapes).
// These are NOT deals the agent found — they're the user-provided reference set;
// each carries source:'seed' and is flagged "Seed" in the UI. Specs from the
// listing copy the user pasted + output/assessments/target-buybox.md (the
// normalized 6-example table). The 6 are the canonical buy-box; the agent-found
// candidates below explicitly EXCLUDE them. coverage = building SF ÷ lot SF.
export const SEED_LISTINGS = [
  { id: 'seed-orl', addr: '1900 W New Hampshire St', metro: 'Orlando', st: 'FL', sf: 150469, landAc: 7.15, coveragePct: 48, built: 1962, clearHt: "30'", zoning: 'I-G', loading: '6 dock + ~4 roll-up', yard: 'Fenced truck court', status: 'Lease', note: 'Marjam Supply — also the gate-failed stop in the Street View sweep', source: 'seed' },
  { id: 'seed-nsh', addr: '801 Space Park S Dr', metro: 'Nashville', st: 'TN', sf: 123000, landAc: 7.0, coveragePct: 40, built: 1973, clearHt: "21–28'", zoning: 'IWD', loading: '18 dock + 1 DI', yard: 'Fenced storage yard', status: 'Lease', note: '~7 AC effective', source: 'seed' },
  { id: 'seed-clt', addr: '5710 Old Concord Rd', metro: 'Charlotte', st: 'NC', sf: 163891, landAc: 9.36, coveragePct: 40, built: null, clearHt: '19\'1"–23\'5"', zoning: 'ML-2', loading: '15 dock (8×8) + 1 DI (6×9)', yard: 'Land-rich (9.36 AC)', status: 'Lease', note: 'Available 22,000–163,891 SF · LED w/ motion sensors', source: 'seed' },
  { id: 'seed-gso', addr: '1103 S Elm St', metro: 'Greensboro', st: 'NC', sf: 111314, landAc: 3.65, coveragePct: 70, built: 1950, clearHt: "14'", zoning: 'HI', loading: '5 dock', yard: 'None — tight site', status: 'Sale (owner-user)', note: 'Manufacturing · Class C · Opportunity Zone · parking 0.13/1k', source: 'seed' },
  { id: 'seed-rkh', addr: '150 Mt Gallant Rd', metro: 'Rock Hill', st: 'SC', sf: 84504, landAc: null, coveragePct: null, built: null, clearHt: '23\'7" (center)', zoning: 'Industrial', loading: '5 dock (10×12) + 2 DI (10×12)', yard: 'Potential laydown yard + rail spur', status: 'Lease', note: '6,447 SF office · heavy power ~4,000A/480V · Norfolk Southern rail spur · new TPO roof 2022 · Trinity Partners (Terry Brennan)', source: 'seed' },
  { id: 'seed-tuc', addr: '5580 S Nogales Hwy', metro: 'Tucson', st: 'AZ', sf: 109229, landAc: 8.08, coveragePct: 31, built: null, clearHt: null, zoning: 'Industrial', loading: null, yard: 'Large fenced yard', status: 'Sale', note: 'Freestanding · heavy power', source: 'seed' },
]

// Agent-found candidates — deals the agent DISCOVERED online (LoopNet sourcing
// pass, Chrome extension, 2026-06-25) by applying the seed buy-box above. These
// were NOT provided by the user; each carries source:'found' and is flagged
// "Found" in the UI. On/near-market for-sale, older mid-large industrial, target
// ~85–165k SF, yard/IOS a plus, ranked by size. ⭐ in-band = SF ≥ 85k (derived).
// Explicitly EXCLUDES the 6 seed examples. SF/year from LoopNet cards — verify.
// Source: output/assessments/orlando-nashville-buybox-batch2.md.
export const BUYBOX_CANDIDATES = [
  // ORLANDO
  { id: 'bb-orl-01', metro: 'Orlando', addr: '2700-2716 Hazelhurst Ave', sf: 105000, year: 1972, status: 'Sale', url: 'https://www.loopnet.com/Listing/2700-2716-Hazelhurst-Ave-Orlando-FL/40161979/', source: 'found' },
  { id: 'bb-orl-02', metro: 'Orlando', addr: '10407 Rocket Blvd', sf: 104641, year: 1981, status: 'Sale', url: 'https://www.loopnet.com/Listing/10407-Rocket-Blvd-Orlando-FL/38167273/', source: 'found' },
  { id: 'bb-orl-03', metro: 'Orlando', addr: '2242 W Taft-Vineland Rd', sf: 80827, year: 2004, status: 'Sale', url: 'https://www.loopnet.com/Listing/2242-W-Taft-Vineland-Rd-Orlando-FL/40584866/', source: 'found' },
  { id: 'bb-orl-04', metro: 'Orlando', addr: '701 W Landstreet Rd', sf: 62418, year: 1977, status: 'Sale · $9M', url: 'https://www.loopnet.com/Listing/701-W-Landstreet-Rd-Orlando-FL/35125805/', source: 'found' },
  { id: 'bb-orl-05', metro: 'Orlando', addr: '603 Central Florida Pky', sf: 60000, year: 1980, status: 'Sale', url: 'https://www.loopnet.com/Listing/603-Central-Florida-Pky-Orlando-FL/39251852/', source: 'found' },
  { id: 'bb-orl-06', metro: 'Orlando', addr: '6031 S Rio Grande Ave', sf: 51240, year: 1978, status: 'Sale · $15M', url: 'https://www.loopnet.com/Listing/6031-S-Rio-Grande-Ave-Orlando-FL/36869932/', source: 'found' },
  { id: 'bb-orl-07', metro: 'Orlando', addr: '3415 Bartlett Blvd', sf: 50400, year: 1980, status: 'Sale', url: 'https://www.loopnet.com/Listing/3415-Bartlett-Blvd-Orlando-FL/40157922/', source: 'found' },
  { id: 'bb-orl-08', metro: 'Orlando', addr: '841 Drive Buick Ave', sf: 42400, year: 1979, status: 'Sale · $7.1M', url: 'https://www.loopnet.com/Listing/841-Drive-Buick-Ave-Orlando-FL/36075042/', source: 'found' },
  { id: 'bb-orl-09', metro: 'Orlando', addr: '3855 St Valentine Way', sf: 42283, year: 1984, status: 'Sale · $8.9M', url: 'https://www.loopnet.com/Listing/3855-St-Valentine-Way-Orlando-FL/32819788/', source: 'found' },
  { id: 'bb-orl-10', metro: 'Orlando', addr: '2140 W Washington St', sf: 33779, year: 1965, status: 'Sale · $5.25M', url: 'https://www.loopnet.com/Listing/2140-W-Washington-St-Orlando-FL/33662950/', source: 'found' },
  // NASHVILLE
  { id: 'bb-nsh-01', metro: 'Nashville', addr: '515 Foster St', sf: 133730, year: 1923, status: 'Sale', url: 'https://www.loopnet.com/Listing/515-Foster-St-Nashville-TN/39626970/', source: 'found' },
  { id: 'bb-nsh-02', metro: 'Nashville', addr: '1530 Antioch Pike', note: 'Antioch', sf: 131487, year: 1986, status: 'Sale', url: 'https://www.loopnet.com/Listing/1530-Antioch-Pike-Antioch-TN/40713212/', source: 'found' },
  { id: 'bb-nsh-03', metro: 'Nashville', addr: '550 Expressway Park Dr', sf: 96267, year: null, status: 'Sale · $2.7M', url: 'https://www.loopnet.com/Listing/550-Expressway-Park-Dr-Nashville-TN/36871778/', source: 'found' },
  { id: 'bb-nsh-04', metro: 'Nashville', addr: '811 Cowan St', sf: 53000, year: 1979, status: 'Sale', url: 'https://www.loopnet.com/Listing/811-Cowan-St-Nashville-TN/41046201/', source: 'found' },
  { id: 'bb-nsh-05', metro: 'Nashville', addr: '617 Norris Ave', sf: 30493, year: 1960, status: 'Sale · $8.9M', url: 'https://www.loopnet.com/Listing/617-Norris-Ave-Nashville-TN/37962935/', source: 'found' },
  { id: 'bb-nsh-06', metro: 'Nashville', addr: '931B Robinson Rd', note: 'Old Hickory', sf: 21411, year: 1986, status: 'Sale', url: 'https://www.loopnet.com/Listing/931B-Robinson-Rd-Old-Hickory-TN/40582481/', source: 'found' },
  { id: 'bb-nsh-07', metro: 'Nashville', addr: '2101 Dunn Ave', sf: 21174, year: 1940, status: 'Sale', url: 'https://www.loopnet.com/Listing/2101-Dunn-Ave-Nashville-TN/40494101/', source: 'found' },
  { id: 'bb-nsh-08', metro: 'Nashville', addr: '1922 Elm Tree Dr', sf: 13250, year: 1976, status: 'Sale · $3.195M', url: 'https://www.loopnet.com/Listing/1922-Elm-Tree-Dr-Nashville-TN/36811956/', source: 'found' },
  { id: 'bb-nsh-09', metro: 'Nashville', addr: '1715 Pecan St', sf: 12000, year: 1930, status: 'Sale · $993k', url: 'https://www.loopnet.com/Listing/1715-Pecan-St-Nashville-TN/38170105/', source: 'found' },
  { id: 'bb-nsh-10', metro: 'Nashville', addr: '2606 Westwood Dr', sf: 12962, year: 2018, status: 'Sale · $4.99M', url: 'https://www.loopnet.com/Listing/2606-Westwood-Dr-Nashville-TN/34671236/', source: 'found' },
]
