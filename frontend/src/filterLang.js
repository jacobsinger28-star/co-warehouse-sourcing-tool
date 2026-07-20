// Keyword filter language — NO LLM, no API key. parseQuery() turns plain
// English into the same validated patch shape the rail understands, entirely
// client-side. Multiple criteria per query are fine; each query MERGES onto the
// current filters (stacking), and "reset / clear filters" starts over.
// VOCAB below is the single source for the "known terms" popup — keep the two
// in sync when adding rules.

const BUCKET_WORD = { actionable: 'Actionable', green: 'Actionable', tentative: 'Tentative', yellow: 'Tentative', pass: 'Pass', red: 'Pass', passes: 'Pass' }

export const MARKET_ALIASES = {
  Nashville: ['nashville', 'nash', 'davidson county', 'bna'],
  Charlotte: ['charlotte', 'clt', 'mecklenburg'],
  Columbus: ['columbus', 'cbus', 'cmh', 'franklin county'],
  Cleveland: ['cleveland', 'cle', 'cuyahoga'],
  Cincinnati: ['cincinnati', 'cincy', 'hamilton county'],
  Charleston: ['charleston', 'chs', 'lowcountry'],
  Raleigh: ['raleigh', 'rdu', 'wake county', 'wake'],
  Orlando: ['orlando', 'orl', 'mco', 'orange county'],
  Miami: ['miami', 'mia', 'dade', 'miami-dade'],
  'Boca Raton': ['boca raton', 'boca'],
  'West Palm Beach': ['west palm beach', 'west palm', 'wpb'],
}

const fmtK = (n) => (n >= 1e6 ? `$${n / 1e6}M` : n.toLocaleString())

// "100,000" · "100k" · "1.2m" · "$5m" → integer
const toNum = (raw, suf) => {
  let v = parseFloat(String(raw).replace(/[$,]/g, ''))
  if (!isFinite(v)) return null
  if (/^k|thousand$/.test(suf || '')) v *= 1e3
  else if (/^m|mm|million$/.test(suf || '')) v *= 1e6
  return Math.round(v)
}

const N = String.raw`\$?\s*(\d[\d,.]*)\s*(k|m|mm|million|thousand)?`
const SF_UNIT = String.raw`(?:sf|sqft|sq\.?\s?ft\.?|square\s+fee?t)`
const MINW = String.raw`(?:over|above|at\s+least|min(?:imum)?|more\s+than|larger\s+than|bigger\s+than|from|>=?|≥)`
const MAXW = String.raw`(?:under|below|less\s+than|max(?:imum)?|smaller\s+than|up\s+to|no\s+more\s+than|<=?|≤)`

export function parseQuery(text) {
  let t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ').trim() + ' '
  const patch = {}
  const applied = []
  const notes = []
  const sig = {}
  const score = {}

  const eat = (re, fn) => {
    const m = t.match(re)
    if (!m) return false
    if (fn(m) !== false) t = t.replace(m[0], ' ')
    return true
  }
  const eatAll = (re, fn) => { let hit = false; while (eat(re, fn)) hit = true; return hit }
  const rx = (s, f = 'i') => new RegExp(s, f)

  // ── reset ──────────────────────────────────────────────────────────────────
  eat(/\b(reset( (all|the))?( filters)?|clear (all|the|every)?\s?(filters?|everything)|start over|remove (all )?filters)\b/, () => {
    patch.reset = true
    applied.push('Reset all filters')
  })

  // ── quoted text → search box ───────────────────────────────────────────────
  eat(/"([^"]{2,})"/, (m) => { patch.q = m[1].slice(0, 120); applied.push(`Search “${m[1]}”`) })
  eat(/\b(?:clear|empty)\s+(?:the\s+)?search\b/, () => { patch.q = ''; applied.push('Search cleared') })

  // ── signals BEFORE broker/contact-adjacent rules ───────────────────────────
  eat(/\b(?:no|without)\s+contact\b/, () => notes.push('signals can only require contact, not exclude it'))
  eat(/\b(has (?:a )?contact|with contact|contactable|reachable|skip[- ]?traced|has (?:a )?phone|with (?:a )?phone|has email|with email|(?:owner|broker) contact)\b/, () => { sig.contact = true; applied.push('Has contact') })
  eat(/\b(tax[- ]?delinquen\w*|delinquen\w*|back taxes|owes tax\w*|tax lien\w*|unpaid tax\w*)\b/, () => { sig.tax = true; applied.push('Tax-delinquent') })
  eat(/\b(code violation\w*|violation\w*|code enforcement)\b/, () => { sig.code = true; applied.push('Code violations') })
  eat(/\b(permit anomal\w*|permit gap|no permits?|permit issues?|permits?)\b/, () => { sig.permit = true; applied.push('Permit anomaly') })
  eat(/\b(vacant|vacancy|vacancies|empty|abandoned|unoccupied)\b/, () => { sig.vacant = true; applied.push('Inferred vacant') })
  eat(/\b(distress\w*|any signal)\b/, () => { sig.distress = true; applied.push('Any distress signal') })

  // ── channel ────────────────────────────────────────────────────────────────
  eat(/\b(both channels?|all channels?|on and off|off and on)\b/, () => { patch.channel = 'both'; applied.push('Both channels') })
  || eat(/\b(off[- ]?market|owner leads?|county leads?|unlisted|not listed)\b/, () => { patch.channel = 'off'; applied.push('Off-market') })
  || eat(/\b(on[- ]?market|brokered|for[- ]sale|listed|listings?)\b/, () => { patch.channel = 'on'; applied.push('On-market') })

  // ── score buckets ──────────────────────────────────────────────────────────
  eat(/\b(?:all scores|any score|show everything|every score)\b/, () => {
    Object.assign(score, { Actionable: true, Tentative: true, Pass: true })
    applied.push('All score buckets')
  })
  eatAll(/\b(?:hide|exclude|no|without|drop|remove|skip)\s+(actionable|tentative|pass(?:es)?|green|yellow|red)\b/, (m) => {
    score[BUCKET_WORD[m[1]]] = false
    applied.push(`Hide ${BUCKET_WORD[m[1]]}`)
  })
  eat(/\b(?:only|just)\s+(actionable|tentative|pass|green|yellow|red)\b|\b(actionable|tentative|pass)\s+only\b/, (m) => {
    const b = BUCKET_WORD[m[1] || m[2]]
    Object.assign(score, { Actionable: false, Tentative: false, Pass: false, [b]: true })
    applied.push(`Only ${b}`)
  })
  // bare bucket word = "only that bucket" (natural reading of "actionable nashville")
  eatAll(/\b(actionable|tentative)\b/, (m) => {
    if (!Object.keys(score).length) {
      const b = BUCKET_WORD[m[1]]
      Object.assign(score, { Actionable: false, Tentative: false, Pass: false, [b]: true })
      applied.push(`Only ${b}`)
    } else if (score[BUCKET_WORD[m[1]]] === undefined) {
      score[BUCKET_WORD[m[1]]] = true
      applied.push(`Show ${BUCKET_WORD[m[1]]}`)
    }
  })

  // ── markets (one active at a time — the rail is a single select) ──────────
  eat(/\b(all markets|anywhere|nationwide|every market|all metros)\b/, () => { patch.market = 'all'; applied.push('All markets') })
  for (const [name, aliases] of Object.entries(MARKET_ALIASES)) {
    for (const a of aliases) {
      const re = rx(String.raw`\b${a.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\b`)
      if (re.test(t)) {
        if (patch.market && patch.market !== name) notes.push(`one market at a time — kept ${patch.market}`)
        else { patch.market = name; applied.push(name) }
        t = t.replace(re, ' ')
        break
      }
    }
  }

  // ── owner ──────────────────────────────────────────────────────────────────
  eat(/\bany owner( type)?s?\b/, () => { patch.ownerType = 'all'; applied.push('Any owner type') })
  eat(/\bllcs?\b/, () => { patch.ownerType = 'LLC'; applied.push('LLC owners') })
  eat(/\btrusts?\b/, () => { patch.ownerType = 'Trust'; applied.push('Trust owners') })
  eat(/\b(individuals?|private owners?|mom[- ]and[- ]pop)\b/, () => { patch.ownerType = 'Individual'; applied.push('Individual owners') })
  eat(/\b(partnerships?|lps?)\b/, () => { patch.ownerType = 'Partnership'; applied.push('Partnership owners') })
  eat(/\b(corporations?|corp|corporate owners?|inc)\b/, () => { patch.ownerType = 'Corp'; applied.push('Corp owners') })
  eat(/\b(out[- ]of[- ]state|oos|absentee|out of town|remote owners?|non[- ]local)\b/, () => { patch.ownerLoc = 'out'; applied.push('Out-of-state owner') })
  eat(/\b(in[- ]state|instate|local owners?|in town)\b/, () => { patch.ownerLoc = 'in'; applied.push('In-state owner') })

  // ── parcel bucket ──────────────────────────────────────────────────────────
  eat(/\b(manual[- ]review( bucket| parcels)?|review bucket|60[- ]?(?:to[- ])?75k?)\b/, () => { patch.bucket = 'review'; applied.push('Manual-review parcels') })
  eat(/\b(scored universe|universe only|universe)\b/, () => { patch.bucket = 'universe'; applied.push('Scored universe') })
  eat(/\ball parcels\b/, () => { patch.bucket = 'all'; applied.push('All parcels') })

  // ── previous sale (before generic $ rules) ────────────────────────────────
  eat(rx(String.raw`${MAXW}\s*\$?\s*(\d[\d,.]*)\s*(?:\/|per)\s*(?:sf|sq ?ft|foot|ft)\b`), (m) => {
    const v = toNum(m[1]); if (v == null) return false
    patch.salePsfMax = String(v); applied.push(`Last sale ≤ $${v}/SF`)
  })
  eat(rx(String.raw`\b(?:sold|sale|bought|purchased|traded|acquired)\b[^.]{0,24}?\b(?:after|since|in or after)\s+((?:19|20)\d\d)\b`), (m) => {
    patch.saleYearMin = m[1]; applied.push(`Sold since ${m[1]}`)
  })
  eat(rx(String.raw`\b(?:sold|sale|bought|purchased|traded|acquired)\b[^.]{0,24}?${MAXW}\s*${N}`), (m) => {
    const v = toNum(m[1], m[2]); if (v == null) return false
    patch.salePriceMax = String(v); applied.push(`Last sale ≤ ${fmtK(v)}`)
  })
  eat(rx(String.raw`\b(?:sold|sale|bought|purchased|traded|acquired)\b[^.]{0,24}?${MINW}\s*${N}`), (m) => {
    const v = toNum(m[1], m[2]); if (v == null) return false
    patch.salePriceMin = String(v); applied.push(`Last sale ≥ ${fmtK(v)}`)
  })

  // ── hold ───────────────────────────────────────────────────────────────────
  eat(/\b(?:owned|held|holding|hold)\b[^.]{0,16}?\bsince\s+(?:before\s+)?((?:19|20)\d\d)\b/, (m) => {
    patch.heldSince = m[1]; applied.push(`Owned since ${m[1]} or earlier`)
  })
  eat(/\b(?:held|owned|hold(?:ing)?)\b[^.]{0,20}?(\d{1,2})\s*\+?\s*(?:yrs?|years?)\b/, (m) => {
    patch.holdMin = m[1]; applied.push(`Held ${m[1]}+ years`)
  })
  eat(/\blong[- ]hold(?:ers?)?\b/, () => { patch.holdMin = '10'; applied.push('Held 10+ years') })

  // ── clear height (a MAX — the buy-box wants LOW clear) ────────────────────
  eat(rx(String.raw`\b(?:clear(?:ance)?|ceiling)s?(?:\s*(?:height|ht))?\b[^0-9]{0,14}${MINW}\s*(\d{1,2})`), (m) => {
    notes.push(`clear height filters as a MAX only (buy-box targets low-clear) — ignored "clear over ${m[1]}"`)
  })
  eat(rx(String.raw`\b(?:clear(?:ance)?|ceiling)s?(?:\s*(?:height|ht))?\b[^0-9]{0,14}(?:${MAXW}\s*)?(\d{1,2})\s*(?:ft|feet|foot|')?`), (m) => {
    const v = +m[1]; if (!v || v > 60) return false
    patch.clearMax = String(v); applied.push(`Clear ht ≤ ${v} ft`)
  })
  eat(rx(String.raw`${MAXW}\s*(\d{1,2})\s*(?:ft|feet|foot|')?\s*(?:clear|ceiling)`), (m) => {
    const v = +m[1]; if (!v || v > 60) return false
    patch.clearMax = String(v); applied.push(`Clear ht ≤ ${v} ft`)
  })
  eat(/\blow[- ]clear\b/, () => { patch.clearMax = '24'; applied.push('Clear ht ≤ 24 ft (low clear)') })

  // ── year built ────────────────────────────────────────────────────────────
  eat(/\b(?:built|constructed|vintage)?\s*((?:19|20)\d\d)\s*(?:-|–|to|through)\s*((?:19|20)\d\d)\b/, (m) => {
    patch.yearMin = m[1]; patch.yearMax = m[2]; applied.push(`Built ${m[1]}–${m[2]}`)
  })
  eat(/\b(?:built|constructed|vintage)\s+(?:after|since|from|in or after)\s+((?:19|20)\d\d)\b|\b(?:newer than|post)[- ]?((?:19|20)\d\d)\b/, (m) => {
    const y = m[1] || m[2]; patch.yearMin = y; applied.push(`Built ≥ ${y}`)
  })
  eat(/\b(?:built|constructed|vintage)\s+(?:before|prior to)\s+((?:19|20)\d\d)\b|\b(?:older than|pre)[- ]?((?:19|20)\d\d)\b/, (m) => {
    const y = m[1] || m[2]; patch.yearMax = y; applied.push(`Built ≤ ${y}`)
  })
  {
    // decades: "60s", "1970s", "60s and 70s" → a year range
    const ds = [...t.matchAll(/\b(?:19)?([5-9]0)s\b/g)].map((m) => 1900 + +m[1])
    if (ds.length) {
      patch.yearMin = String(Math.min(...ds))
      patch.yearMax = String(Math.max(...ds) + 9)
      applied.push(`Built ${patch.yearMin}–${patch.yearMax}`)
      t = t.replace(/\b(?:19)?[5-9]0s\b/g, ' ')
    }
  }

  // ── distance ──────────────────────────────────────────────────────────────
  eat(rx(String.raw`\b(?:within|${MAXW})\s*(\d{1,3})\s*(?:mi|miles?)\b`), (m) => {
    const v = +m[1]; if (v > 100) return false
    patch.distMax = String(v); applied.push(`≤ ${v} mi to core`)
  })
  eat(/\b(\d{1,3})\s*(?:mi|miles?)\s*(?:of|to|from)\s*(?:core|downtown|cbd|center)\b/, (m) => {
    patch.distMax = m[1]; applied.push(`≤ ${m[1]} mi to core`)
  })

  // ── building SF ───────────────────────────────────────────────────────────
  eat(rx(String.raw`\bbetween\s+${N}\s+(?:and|to|-)\s+${N}\s*${SF_UNIT}?`), (m) => {
    const a = toNum(m[1], m[2]); const b = toNum(m[3], m[4])
    if (a == null || b == null) return false
    patch.sfMin = String(Math.min(a, b)); patch.sfMax = String(Math.max(a, b))
    applied.push(`SF ${fmtK(Math.min(a, b))}–${fmtK(Math.max(a, b))}`)
  })
  eat(rx(String.raw`${MINW}\s*${N}\s*${SF_UNIT}`), (m) => {
    const v = toNum(m[1], m[2]); if (v == null) return false
    patch.sfMin = String(v); applied.push(`SF ≥ ${fmtK(v)}`)
  })
  eat(rx(String.raw`${MAXW}\s*${N}\s*${SF_UNIT}`), (m) => {
    const v = toNum(m[1], m[2]); if (v == null) return false
    patch.sfMax = String(v); applied.push(`SF ≤ ${fmtK(v)}`)
  })
  eat(rx(String.raw`${N}\s*\+\s*${SF_UNIT}?`), (m) => {
    const v = toNum(m[1], m[2]); if (v == null || v < 10000) return false
    patch.sfMin = String(v); applied.push(`SF ≥ ${fmtK(v)}`)
  })
  // bare "over 100k" / "under 150k" with no unit → SF when plausibly a building size
  eat(rx(String.raw`${MINW}\s*${N}`), (m) => {
    const v = toNum(m[1], m[2]); if (v == null || v < 20000 || v > 2e6 || patch.sfMin) return false
    patch.sfMin = String(v); applied.push(`SF ≥ ${fmtK(v)}`)
  })
  eat(rx(String.raw`${MAXW}\s*${N}`), (m) => {
    const v = toNum(m[1], m[2]); if (v == null || v < 20000 || v > 2e6 || patch.sfMax) return false
    patch.sfMax = String(v); applied.push(`SF ≤ ${fmtK(v)}`)
  })

  // ── view (after signal/contact rules so "broker contact" wasn't stolen) ───
  eat(/\b(map view|show (?:the )?map|on the map|map)\b/, () => { patch.view = 'map'; applied.push('Map view') })
  eat(/\b(table view|list view|as a list|table|list)\b/, () => { patch.view = 'table'; applied.push('Table view') })
  eat(/\b(brokers? (?:view|tab)|brokers)\b/, () => { patch.view = 'brokers'; applied.push('Brokers view') })

  // ── trailing explicit search ──────────────────────────────────────────────
  eat(/\b(?:search|find|look ?up)\s+(?:for\s+)?([a-z0-9][a-z0-9 .,'-]{2,})$/, (m) => {
    patch.q = m[1].trim().slice(0, 120); applied.push(`Search “${patch.q}”`)
  })

  if (Object.keys(score).length) patch.score = score
  if (Object.keys(sig).length) patch.sig = sig

  // leftover words the parser didn't understand (minus filler)
  const STOP = new Set(['a', 'an', 'and', 'or', 'the', 'in', 'on', 'at', 'of', 'with', 'for', 'to', 'me', 'show', 'give', 'get', 'want', 'need', 'please', 'then', 'also', 'add', 'plus', 'property', 'properties', 'warehouse', 'warehouses', 'building', 'buildings', 'industrial', 'deal', 'deals', 'site', 'sites', 'space', 'spaces', 'owner', 'owners', 'that', 'are', 'is', 'ft', 'feet', 'sf'])
  const leftover = t.split(/[^a-z0-9$]+/).filter((w) => w.length > 2 && !STOP.has(w))

  let reply
  if (!applied.length && !notes.length) {
    reply = 'No known terms matched — tap ? for the full list of things you can say.'
  } else {
    reply = applied.join(' · ')
    if (notes.length) reply += (reply ? ' — ' : '') + notes.join('; ')
    if (leftover.length) reply += ` (ignored: ${leftover.slice(0, 6).join(' ')})`
  }
  return { patch: applied.length ? patch : {}, reply, applied, notes, leftover }
}

// ── the "known terms" popup content — mirrors the rules above ───────────────
export const VOCAB = [
  { title: 'Channel', rows: [
    ['Off-market owner leads', 'off-market · owner leads · county leads · unlisted · not listed'],
    ['On-market listings', 'on-market · listed · listings · brokered · for-sale'],
    ['Both', 'both channels · all channels'],
  ] },
  { title: 'Score buckets', rows: [
    ['Only one bucket', 'only actionable · just tentative · actionable only · green / yellow / red'],
    ['Hide a bucket', 'hide pass · no pass · without tentative · exclude red'],
    ['Everything', 'all scores · any score · show everything'],
  ] },
  { title: 'Markets (one at a time)', rows: [
    ...Object.entries(MARKET_ALIASES).map(([name, a]) => [name, a.join(' · ')]),
    ['All markets', 'all markets · anywhere · nationwide'],
  ] },
  { title: 'Size (building SF)', rows: [
    ['Minimum', 'over 100k sf · at least 80,000 sf · 100k+ sf · more than 120k'],
    ['Maximum', 'under 200k sf · up to 150k sf · less than 90k'],
    ['Range', 'between 100k and 200k sf'],
  ] },
  { title: 'Clear height (max — buy-box wants low clear)', rows: [
    ['Max clear', 'clear under 24 · ceiling below 22 ft · under 24 ft clear · low clear'],
  ] },
  { title: 'Year built', rows: [
    ['After', 'built after 1970 · built since 1975 · newer than 1980 · post-1970'],
    ['Before', 'built before 1990 · pre-1985 · older than 1990'],
    ['Range / decades', 'built 1960 to 1979 · 1960-1990 · 60s · 60s and 70s'],
  ] },
  { title: 'Owner', rows: [
    ['Type', 'llc · trust · individual · private owner · partnership · corp · any owner'],
    ['Location', 'out-of-state · oos · absentee · out of town · local owner · in-state'],
    ['Hold', 'held 10+ years · owned for 15 years · long hold · owned since 2005'],
  ] },
  { title: 'Distress signals', rows: [
    ['Tax', 'tax-delinquent · delinquent · back taxes · tax lien · unpaid taxes'],
    ['Code', 'code violations · violations · code enforcement'],
    ['Permits', 'permit anomaly · permit gap · no permits'],
    ['Vacancy', 'vacant · empty · abandoned · unoccupied'],
    ['Any distress', 'distressed · any signal'],
    ['Contact', 'has contact · with phone · has email · skip-traced · reachable'],
  ] },
  { title: 'Previous sale', rows: [
    ['Sold since', 'sold after 2015 · bought since 2018'],
    ['Price', 'bought for under $5m · sold over $1m · purchased below $3,500,000'],
    ['$ per SF', 'under $80/sf · below $60 per sf'],
  ] },
  { title: 'Distance & parcels', rows: [
    ['Distance to core', 'within 5 miles · under 10 mi · 5 miles of downtown'],
    ['Parcel bucket', 'manual review · review bucket · 60-75k · scored universe · all parcels'],
  ] },
  { title: 'View, search & stacking', rows: [
    ['Switch view', 'map · table · list · brokers'],
    ['Text search', '"1106 davidson" (in quotes) · search couchville pike'],
    ['Stacking', 'each query ADDS to the current filters — e.g. “nashville”, then “over 100k sf”, then “only actionable”'],
    ['Start over', 'reset · clear filters · start over'],
  ] },
]

export const EXAMPLES = [
  'vacant nashville llc over 100k sf only actionable',
  'out-of-state owners held 10+ years, built before 1985',
  'under $80/sf sold after 2015',
  'hide pass · low clear · within 5 miles',
  'reset',
]
