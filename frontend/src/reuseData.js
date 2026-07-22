// Adaptive Reuse Finder data — REAL sweep output (not synthetic). Split out of
// data.js (whose header describes synthetic sample data) so provenance is honest.
// Consumed only by modules/ReuseFinder.jsx.

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
  // ORLANDO — FOR LEASE (LoopNet pull, 2026-07-20). Industrial / flex / warehouse
  // availability — lease comps + market read, not acquisition targets. SF = max
  // contiguous available per the LoopNet card; rates as quoted — verify.
  { id: 'bb-orl-l01', metro: 'Orlando', addr: '3443-3479 Parkway Center Ct', note: 'Lake Orlando Industrial Park', sf: 76386, year: 1981, status: 'Lease · $14.75–18/SF/YR', url: 'https://www.loopnet.com/Listing/3443-3479-Parkway-Center-Ct-Orlando-FL/26564512/', source: 'found' },
  { id: 'bb-orl-l02', metro: 'Orlando', addr: '7600 Southland Blvd', note: 'BaySpace Gateway & Commerce', sf: 58216, year: 1983, status: 'Lease · $16.50–25/SF/YR', url: 'https://www.loopnet.com/Listing/7600-Southland-Blvd-Orlando-FL/39462069/', source: 'found' },
  { id: 'bb-orl-l03', metro: 'Orlando', addr: '5501 Lee Vista Blvd', note: 'Mahogany Pointe Logistics Park', sf: 228460, year: 2025, status: 'Lease', url: 'https://www.loopnet.com/Listing/5501-Lee-Vista-Blvd-Orlando-FL/25662228/', source: 'found' },
  { id: 'bb-orl-l04', metro: 'Orlando', addr: '4121 34th St', note: 'Portal Warehousing', sf: 25334, year: 1983, status: 'Lease', url: 'https://www.loopnet.com/Listing/4121-34th-St-Orlando-FL/33193549/', source: 'found' },
  { id: 'bb-orl-l05', metro: 'Orlando', addr: '6925 Lake Ellenor Dr', note: 'Heaven III', sf: 19736, year: 1975, status: 'Lease · $12–20/SF/YR', url: 'https://www.loopnet.com/Listing/6925-Lake-Ellenor-Dr-Orlando-FL/33259913/', source: 'found' },
  { id: 'bb-orl-l06', metro: 'Orlando', addr: '6220 Hazeltine National Dr', note: 'BaySpace Lake Point', sf: 13199, year: 1985, status: 'Lease', url: 'https://www.loopnet.com/Listing/6220-Hazeltine-National-Dr-Orlando-FL/37561822/', source: 'found' },
  { id: 'bb-orl-l07', metro: 'Orlando', addr: '1271 La Quinta Dr', note: 'La Quinta Business Center', sf: 13100, year: 1972, status: 'Lease · $15.50–17.75/SF/YR', url: 'https://www.loopnet.com/Listing/1271-La-Quinta-Dr-Orlando-FL/25150919/', source: 'found' },
]
