// Deals DB RAG chat: answers plain-English questions about the firm's Pipedrive
// deals ("have we ever LOI'd this owner?", "what did we offer on X?").
//
// How it works (sized for a small deal book — ~50 deals today):
//   1. Sync   — pull every deal + its notes + linked person/org from Pipedrive
//               into an in-memory corpus (cached, refreshed every SYNC_TTL_MS).
//   2. Retrieve — lexical scoring of the question against each deal document;
//               the top matches go to the model in full, plus a one-line index
//               of ALL deals so aggregate questions ("how many open industrial
//               deals?") still work.
//   3. Answer — Claude answers from that context only, and lists which deals it
//               relied on (returned as citations with Pipedrive links).
//
// Env: PIPEDRIVE_API_TOKEN, ANTHROPIC_API_KEY. For local dev both fall back to
// the sibling repos' .env files, mirroring tools/pull_pipedrive_brokers.py.
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PD_BASE = 'https://api.pipedrive.com/v1'
const SYNC_TTL_MS = 10 * 60 * 1000        // re-pull from Pipedrive at most every 10 min
const TOP_K = 8                           // full deal docs handed to the model
const MODEL = 'claude-opus-4-8'

// ---------------------------------------------------------------- env loading
function envFromFile(path, key) {
  try {
    if (!existsSync(path)) return ''
    const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith(key))
    return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : ''
  } catch { return '' }
}

function pipedriveToken() {
  return process.env.PIPEDRIVE_API_TOKEN
    || envFromFile(join(__dirname, '../../general-scraping/backend/.env'), 'PIPEDRIVE_API_TOKEN')
}

function anthropicKey() {
  return process.env.ANTHROPIC_API_KEY
    || envFromFile(join(__dirname, '../../offmarket-scraping/.env'), 'ANTHROPIC_API_KEY')
}

// ---------------------------------------------------------------- pipedrive sync
async function pd(path, token) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${PD_BASE}${path}${sep}api_token=${token}`)
  if (!r.ok) throw new Error(`pipedrive ${path} -> ${r.status}`)
  return r.json()
}

async function pdPaged(path, token) {
  const items = []
  let start = 0
  for (;;) {
    const d = await pd(`${path}${path.includes('?') ? '&' : '?'}limit=500&start=${start}`, token)
    items.push(...(d.data || []))
    const pag = d.additional_data?.pagination
    if (!pag?.more_items_in_collection) return items
    start = pag.next_start
  }
}

const stripHtml = (s) => (s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#\d+;/g, ' ').trim()
const day = (s) => (s || '').slice(0, 10)

// Build one plain-text document per deal — this is what gets retrieved and what
// the model reads.
function buildDoc(deal, notesByDeal, stageName, pipelineName) {
  const lines = [
    `Deal #${deal.id}: ${deal.title}`,
    `Pipeline: ${pipelineName(deal.pipeline_id)} · Stage: ${stageName(deal.stage_id)} · Status: ${deal.status}${deal.lost_reason ? ` (lost: ${deal.lost_reason})` : ''}`,
    `Value: ${deal.value ? `${deal.value} ${deal.currency}` : 'n/a'}`,
    `Contact: ${deal.person_id?.name || 'n/a'} · Org: ${deal.org_id?.name || 'n/a'} · Owner: ${deal.user_id?.name || 'n/a'}`,
    `Created: ${day(deal.add_time)} · Updated: ${day(deal.update_time)}${deal.won_time ? ` · Won: ${day(deal.won_time)}` : ''}${deal.lost_time ? ` · Lost: ${day(deal.lost_time)}` : ''}`,
  ]
  const notes = notesByDeal.get(deal.id) || []
  for (const n of notes.slice(0, 12)) {
    const body = stripHtml(n.content).slice(0, 1500)
    if (body) lines.push(`Note (${day(n.add_time)}): ${body}`)
  }
  return lines.join('\n')
}

let corpus = null      // { deals: [{id, title, status, stage, pipeline, value, currency, updated, doc, url}], syncedAt }
let syncing = null

async function syncCorpus() {
  const token = pipedriveToken()
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN not configured')
  const [deals, notes, stages, pipelines] = await Promise.all([
    pdPaged('/deals?status=all_not_deleted', token),
    pdPaged('/notes', token),
    pd('/stages', token).then((d) => d.data || []),
    pd('/pipelines', token).then((d) => d.data || []),
  ])
  const stageName = (id) => (stages.find((s) => s.id === id)?.name || `stage ${id}`).trim()
  const pipelineName = (id) => (pipelines.find((p) => p.id === id)?.name || `pipeline ${id}`).trim()
  const notesByDeal = new Map()
  for (const n of notes) {
    if (!n.deal_id) continue
    if (!notesByDeal.has(n.deal_id)) notesByDeal.set(n.deal_id, [])
    notesByDeal.get(n.deal_id).push(n)
  }
  corpus = {
    syncedAt: Date.now(),
    deals: deals.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      stage: stageName(d.stage_id),
      pipeline: pipelineName(d.pipeline_id),
      value: d.value,
      currency: d.currency,
      added: day(d.add_time),
      updated: day(d.update_time),
      person: d.person_id?.name || null,
      org: d.org_id?.name || null,
      notesCount: (notesByDeal.get(d.id) || []).length,
      url: `https://app.pipedrive.com/deal/${d.id}`,
      doc: buildDoc(d, notesByDeal, stageName, pipelineName),
    })),
  }
  console.log(`[deals-chat] synced ${corpus.deals.length} deals, ${notes.length} notes from Pipedrive`)
  return corpus
}

async function getCorpus() {
  if (corpus && Date.now() - corpus.syncedAt < SYNC_TTL_MS) return corpus
  if (!syncing) syncing = syncCorpus().finally(() => { syncing = null })
  // if we have a stale corpus, serve it while the refresh runs; else wait
  if (corpus) { syncing.catch(() => {}); return corpus }
  return syncing
}

// ---------------------------------------------------------------- retrieval
const tokenize = (s) => (s.toLowerCase().match(/[a-z0-9]{2,}/g) || [])
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'we', 'our', 'is', 'are', 'was', 'were', 'did', 'do', 'have', 'has', 'ever', 'any', 'what', 'who', 'when', 'how', 'deal', 'deals'])

function rank(question, deals) {
  const terms = tokenize(question).filter((t) => !STOP.has(t))
  return deals
    .map((d) => {
      const doc = d.doc.toLowerCase()
      const title = d.title.toLowerCase()
      let score = 0
      for (const t of terms) {
        if (title.includes(t)) score += 5
        const m = doc.split(t).length - 1
        score += Math.min(m, 4)                       // cap per-term so long notes don't dominate
      }
      return { deal: d, score }
    })
    .sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------- search (no LLM)
const summarize = (d) => ({
  id: d.id, title: d.title, status: d.status, stage: d.stage, pipeline: d.pipeline,
  value: d.value, currency: d.currency, added: d.added, updated: d.updated,
  person: d.person, org: d.org, notesCount: d.notesCount, url: d.url,
})

const byRecency = (a, b) => (b.updated || '').localeCompare(a.updated || '')

// Known questions — deterministic Pipedrive queries, no model involved.
export const PRESETS = {
  tracking: { label: 'Tracking pipeline', match: (d) => d.pipeline.toLowerCase() === 'tracking' },
  open: { label: 'Open deals', match: (d) => d.status === 'open' },
  won: { label: 'Won deals', match: (d) => d.status === 'won' },
  lost: { label: 'Lost deals', match: (d) => d.status === 'lost' },
  recent: { label: 'Recently updated', match: () => true, limit: 10 },
  noted: { label: 'Most discussed', match: (d) => d.notesCount > 0, sort: (a, b) => b.notesCount - a.notesCount, limit: 10 },
}

// Lines of the deal doc that contain a query term — shown as result snippets.
function snippetsFor(deal, terms) {
  const out = []
  for (const line of deal.doc.split('\n').slice(1)) {           // skip the title line
    const low = line.toLowerCase()
    if (terms.some((t) => low.includes(t))) {
      out.push(line.length > 220 ? `${line.slice(0, 220)}…` : line)
      if (out.length >= 3) break
    }
  }
  return out
}

// Search the deal book: `preset` runs a known query; `q` is keyword search over
// titles + notes. No `q`/`preset` returns the whole book (for the live table).
export async function searchDeals({ q = '', preset = '' } = {}) {
  const c = await getCorpus()
  const base = { dealCount: c.deals.length, syncedAt: c.syncedAt }

  if (preset && PRESETS[preset]) {
    const p = PRESETS[preset]
    const matched = c.deals.filter(p.match).sort(p.sort || byRecency).slice(0, p.limit || 100)
    return { ...base, mode: 'preset', label: p.label, results: matched.map((d) => ({ ...summarize(d), snippets: [] })) }
  }

  const question = String(q || '').trim()
  if (!question) {
    return { ...base, mode: 'all', results: [...c.deals].sort(byRecency).map(summarize) }
  }

  const terms = tokenize(question).filter((t) => !STOP.has(t))
  const results = rank(question, c.deals)
    .filter((r) => r.score > 0)
    .slice(0, 20)
    .map((r) => ({ ...summarize(r.deal), score: r.score, snippets: snippetsFor(r.deal, terms) }))
  return { ...base, mode: 'search', results }
}

// ---------------------------------------------------------------- answer
const SYSTEM = `You are the Deals DB assistant for SimiCapital, a commercial real-estate investment firm. You answer questions about the firm's deal history using ONLY the Pipedrive deal records provided in each message.

Rules:
- Ground every claim in the provided records. If the records don't contain the answer, say so plainly — never invent deals, numbers, or dates.
- The "Deal index" lists every deal one per line (for counts/aggregates); the "Relevant deal records" section has full detail for the deals most related to the question.
- Be concise and direct — this is an internal tool for the deal team.
- End your reply with a line exactly of the form: CITED: [id, id, ...] listing the deal ids you actually relied on (empty list if none).`

function buildContext(question, c) {
  const ranked = rank(question, c.deals)
  const top = ranked.filter((r) => r.score > 0).slice(0, TOP_K).map((r) => r.deal)
  const index = c.deals
    .map((d) => `#${d.id} ${d.title} — ${d.pipeline}/${d.stage}, ${d.status}, ${d.value ? `${d.value} ${d.currency}` : 'no value'}, updated ${d.updated}`)
    .join('\n')
  const docs = top.map((d) => `--- ${d.url}\n${d.doc}`).join('\n\n') || '(no deals matched the question keywords)'
  return { top, context: `Deal index (all ${c.deals.length} deals):\n${index}\n\nRelevant deal records:\n${docs}` }
}

// history: [{role: 'user'|'assistant', content: string}, ...] (prior turns, text only)
export async function answerDealsQuestion(question, history = []) {
  const key = anthropicKey()
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured')
  const c = await getCorpus()
  const { top, context } = buildContext(question, c)

  const client = new Anthropic({ apiKey: key })
  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
    { role: 'user', content: `${context}\n\nQuestion: ${question}` },
  ]
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages,
  })
  let text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('')

  // Pull the CITED footer off the answer and resolve ids to deal links.
  let citedIds = []
  const m = text.match(/CITED:\s*\[([^\]]*)\]\s*$/)
  if (m) {
    citedIds = m[1].split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite)
    text = text.slice(0, m.index).trim()
  }
  const byId = new Map(c.deals.map((d) => [d.id, d]))
  const citations = citedIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((d) => ({ id: d.id, title: d.title, url: d.url }))
  // fall back to the retrieved set if the model skipped the footer
  if (!citations.length && top.length && !/don'?t (have|see)|no record/i.test(text)) {
    citations.push(...top.slice(0, 3).map((d) => ({ id: d.id, title: d.title, url: d.url })))
  }

  return { answer: text, citations, dealCount: c.deals.length, syncedAt: c.syncedAt }
}
