// Natural-language filter control for the Properties module.
// One short Claude call turns "vacant Nashville warehouses over 100k SF" into a
// validated patch of the console's filter state; the client applies it. Haiku:
// this is command parsing, not analysis — fast and cheap beats big.
// Env: ANTHROPIC_API_KEY (same local-dev fallback as dealsChat.mjs).
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODEL = 'claude-haiku-4-5-20251001'

const envFromFile = (p, key) => {
  try {
    if (!existsSync(p)) return ''
    const m = readFileSync(p, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  } catch { return '' }
}
const apiKey = () =>
  process.env.ANTHROPIC_API_KEY
  || envFromFile(join(__dirname, '../../offmarket-scraping/.env'), 'ANTHROPIC_API_KEY')

const MARKETS = ['Nashville', 'Charlotte', 'Columbus', 'Cleveland', 'Cincinnati', 'Charleston', 'Raleigh', 'Miami', 'Boca Raton', 'West Palm Beach']
const OWNER_TYPES = ['all', 'LLC', 'Trust', 'Individual', 'Partnership', 'Corp']
const SIG_KEYS = ['oos', 'tax', 'code', 'permit', 'vacant', 'distress', 'contact']
const NUM_KEYS = ['clearMax', 'yearMin', 'yearMax', 'sfMin', 'sfMax', 'distMax', 'holdMin', 'heldSince', 'saleYearMin', 'salePriceMin', 'salePriceMax', 'salePsfMax']

const TOOL = {
  name: 'set_filters',
  description: 'Apply the requested changes to the property console filters. Only include fields the user asked to change (or reset).',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'One short sentence confirming what was changed, in plain English.' },
      reset: { type: 'boolean', description: 'true = clear ALL filters first, then apply the other fields' },
      channel: { enum: ['both', 'off', 'on'], description: 'off = off-market owner leads, on = brokered listings' },
      score: {
        type: 'object',
        description: 'Which score buckets stay VISIBLE (true = shown)',
        properties: { Actionable: { type: 'boolean' }, Tentative: { type: 'boolean' }, Pass: { type: 'boolean' } },
      },
      market: { enum: ['all', ...MARKETS] },
      ownerType: { enum: OWNER_TYPES },
      ownerLoc: { enum: ['all', 'in', 'out'], description: 'out = out-of-state owner' },
      bucket: { enum: ['all', 'universe', 'review'], description: 'review = 60-75k SF manual-review parcels' },
      clearMax: { type: ['number', 'null'], description: 'MAX clear height ft (buy-box wants LOW clear); null clears' },
      yearMin: { type: ['number', 'null'] },
      yearMax: { type: ['number', 'null'] },
      sfMin: { type: ['number', 'null'] },
      sfMax: { type: ['number', 'null'] },
      distMax: { type: ['number', 'null'], description: 'max miles to market core' },
      holdMin: { type: ['number', 'null'], description: 'min years owner has held' },
      heldSince: { type: ['number', 'null'], description: 'owned since this year or earlier' },
      saleYearMin: { type: ['number', 'null'], description: 'last sold in this year or later' },
      salePriceMin: { type: ['number', 'null'], description: 'min last-sale price $' },
      salePriceMax: { type: ['number', 'null'], description: 'max last-sale price $' },
      salePsfMax: { type: ['number', 'null'], description: 'max last-sale $/SF' },
      sig: {
        type: 'object',
        description: 'Signal checkboxes (true = require the signal)',
        properties: Object.fromEntries(SIG_KEYS.map((k) => [k, { type: 'boolean' }])),
      },
      q: { type: 'string', description: 'Free-text search box (address / owner / broker / APN). Empty string clears.' },
      view: { enum: ['map', 'table', 'brokers'] },
    },
    required: ['reply'],
  },
}

const SYSTEM = `You translate an analyst's plain-English request into filter changes for a CRE sourcing console via the set_filters tool. Rules:
- Signals: oos=out-of-state owner, tax=tax-delinquent, code=code violations, permit=permit anomaly, vacant=inferred vacant, distress=any distress, contact=has owner/broker contact.
- "warehouses/industrial" is the whole dataset — not a filter.
- Clear height is a MAXIMUM (the buy-box targets older low-clear stock): "clear height under 24" → clearMax 24. If asked for a MINIMUM clear height, say in the reply that only a max is supported.
- Score buckets: "only actionable" → {Actionable:true, Tentative:false, Pass:false}. "show everything" → all true.
- Unrecognized markets: leave market unchanged and say so in the reply.
- "clear/reset filters" → reset:true (plus any new settings).
- Numeric shorthand: "100k" = 100000. Only include fields the user mentioned.
- Off-market = owner leads (county-sourced), on-market = brokered listings.`

// Clamp/whitelist everything the model returns — the client applies this blind.
export function sanitizePatch(raw) {
  const p = {}
  if (typeof raw.reply === 'string') p.reply = raw.reply.slice(0, 300)
  if (raw.reset === true) p.reset = true
  if (['both', 'off', 'on'].includes(raw.channel)) p.channel = raw.channel
  if (raw.score && typeof raw.score === 'object') {
    const s = {}
    for (const k of ['Actionable', 'Tentative', 'Pass']) if (typeof raw.score[k] === 'boolean') s[k] = raw.score[k]
    if (Object.keys(s).length) p.score = s
  }
  if (raw.market === 'all' || MARKETS.includes(raw.market)) p.market = raw.market
  if (OWNER_TYPES.includes(raw.ownerType)) p.ownerType = raw.ownerType
  if (['all', 'in', 'out'].includes(raw.ownerLoc)) p.ownerLoc = raw.ownerLoc
  if (['all', 'universe', 'review'].includes(raw.bucket)) p.bucket = raw.bucket
  for (const k of NUM_KEYS) {
    if (raw[k] === null) p[k] = ''                       // null = clear the field
    else if (typeof raw[k] === 'number' && isFinite(raw[k])) p[k] = String(Math.round(raw[k]))
  }
  if (raw.sig && typeof raw.sig === 'object') {
    const s = {}
    for (const k of SIG_KEYS) if (typeof raw.sig[k] === 'boolean') s[k] = raw.sig[k]
    if (Object.keys(s).length) p.sig = s
  }
  if (typeof raw.q === 'string') p.q = raw.q.slice(0, 120)
  if (['map', 'table', 'brokers'].includes(raw.view)) p.view = raw.view
  return p
}

export async function filterChat(message, state) {
  const key = apiKey()
  if (!key) {
    return { patch: null, reply: 'Filter chat needs ANTHROPIC_API_KEY configured on the server (Railway → Variables).' }
  }
  const client = new Anthropic({ apiKey: key })
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'set_filters' },
    messages: [{
      role: 'user',
      content: `Current filter state:\n${JSON.stringify(state || {}, null, 1)}\n\nRequest: ${message}`,
    }],
  })
  const call = res.content.find((b) => b.type === 'tool_use')
  if (!call) return { patch: null, reply: 'Could not parse that — try rephrasing.' }
  const patch = sanitizePatch(call.input || {})
  return { patch, reply: patch.reply || 'Done.' }
}
