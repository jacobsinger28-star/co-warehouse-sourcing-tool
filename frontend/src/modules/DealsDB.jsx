import { useEffect, useRef, useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { DEALS, PROPS } from '../data.js'
import { postJson } from '../api.js'

// Known questions — each maps to a deterministic Pipedrive query on the server
// (see PRESETS in frontend/dealsChat.mjs). No LLM involved.
const KNOWN_QUESTIONS = [
  { preset: 'tracking', label: "What's in the Tracking pipeline?" },
  { preset: 'open', label: 'Open deals' },
  { preset: 'won', label: 'Won deals' },
  { preset: 'lost', label: 'Lost deals' },
  { preset: 'recent', label: 'Recently updated' },
  { preset: 'noted', label: 'Most discussed' },
]

const statusVar = (s) => {
  const k = (s || '').toLowerCase()
  return k === 'won' || k === 'closed' ? '--green' : k === 'lost' || k === 'deleted' ? '--red' : k === 'open' ? '--accent' : '--amber'
}
const statusStyle = (s) => `font-size:11px;color:var(${statusVar(s)});background:var(--surface2);border:1px solid var(--border);padding:2px 8px;border-radius:5px;white-space:nowrap;text-transform:capitalize;`
const sampleTag = 'font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);border:1px solid var(--border2);border-radius:4px;padding:1px 6px;'
const fmtVal = (v, c) => (v ? `${c === 'USD' || !c ? '$' : `${c} `}${v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString()}` : '—')

function checkDedupe(q, liveDeals) {
  const needle = q.trim().toLowerCase()
  if (!needle) return null
  if (liveDeals) {
    const hit = liveDeals.find((d) => [d.title, d.person, d.org].some((x) => x && (x.toLowerCase().includes(needle) || needle.includes(x.toLowerCase()))))
    if (hit) return { verdict: 'Previously contacted', ok: false, detail: `${hit.title} · ${hit.pipeline}/${hit.stage} · ${hit.status} · updated ${hit.updated}.`, url: hit.url }
    return { verdict: 'No prior contact', ok: true, detail: `No match across ${liveDeals.length} Pipedrive deals. Clear to add to the outreach queue.` }
  }
  // sample-data fallback (static deploy without the backend)
  const hay = [...DEALS.flatMap((d) => [d.owner, d.prop, d.deal]), ...PROPS.flatMap((p) => [p.owner || '', p.addr])]
  const hit = hay.find((h) => h && (h.toLowerCase().includes(needle) || needle.includes(h.toLowerCase())))
  if (hit) {
    const deal = DEALS.find((d) => [d.owner, d.prop, d.deal].some((x) => x.toLowerCase().includes(needle) || needle.includes(x.toLowerCase())))
    return { verdict: 'Previously contacted', ok: false, detail: deal ? `${deal.deal} · ${deal.status} · ${deal.date}. ${deal.why !== '—' ? deal.why : 'No further notes.'}` : `Matches a record in the sourcing universe (${hit}). Review before outreach.` }
  }
  return { verdict: 'No prior contact', ok: true, detail: 'Clear to add to the outreach queue.' }
}

const dealsErr = (status) => `request failed (${status})`
const queryDeals = (body) => postJson('deals', body, dealsErr)

// RAG chat over the deal book (server: /api/deals-chat → Claude with Pipedrive
// context). history = [{role:'user'|'assistant', content}] for follow-ups.
const queryDealsChat = (question, history) => postJson('deals-chat', { question, history }, dealsErr)

export default function DealsDB() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)        // {mode, label?, results, dealCount}
  const [live, setLive] = useState(null)            // full deal book for the table (null = sample fallback)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dedupeQuery, setDedupeQuery] = useState('')
  const [chat, setChat] = useState(null)            // {question, answer, citations, dealCount}
  const [chatBusy, setChatBusy] = useState(false)
  const chatHistory = useRef([])                    // rolling [{role, content}] for follow-ups
  const dedupe = checkDedupe(dedupeQuery, live?.results)
  const busyRef = useRef(false)

  // pull the live deal book once (table + dedupe); sample data stays as fallback
  useEffect(() => {
    let on = true
    queryDeals({}).then((d) => { if (on) setLive(d) }).catch(() => {})
    return () => { on = false }
  }, [])

  const run = async (body) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setErr('')
    try {
      setResult(await queryDeals(body))
    } catch (e) {
      setErr(e.message === 'Failed to fetch'
        ? 'No backend reachable — deal search needs the server (npm run serve locally).'
        : e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const search = () => { if (query.trim()) run({ q: query.trim() }) }

  const ask = async () => {
    const q = query.trim()
    if (!q || chatBusy) return
    setChatBusy(true)
    setErr('')
    try {
      const d = await queryDealsChat(q, chatHistory.current)
      chatHistory.current = [...chatHistory.current, { role: 'user', content: q }, { role: 'assistant', content: d.answer }].slice(-8)
      setChat({ question: q, ...d })
      setQuery('')
    } catch (e) {
      setErr(e.message === 'Failed to fetch'
        ? 'No backend reachable — AI answers need the server (npm run serve locally).'
        : /ANTHROPIC_API_KEY/.test(e.message)
          ? 'AI answers are not enabled yet — set ANTHROPIC_API_KEY in Railway → Variables.'
          : e.message)
    } finally {
      setChatBusy(false)
    }
  }
  const clearChat = () => { setChat(null); chatHistory.current = [] }

  const tableDeals = live?.results
  return (
    <div className="content-pad" data-screen-label="Deals DB" style={css('flex:1;overflow-y:auto;min-height:0;padding:24px 26px;')}>
      <div style={css('max-width:1100px;margin:0 auto;')}>
        <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:6px;')}>
          <h2 style={css('margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;')}>Deals DB</h2>
          <span style={css('font-size:10.5px;color:var(--text2);background:var(--surface2);border:1px solid var(--border);padding:3px 9px;border-radius:6px;')}>Internal · confidential</span>
          {live && <span style={css('font-size:10.5px;color:var(--accent);background:var(--accent-dim);padding:3px 9px;border-radius:6px;')}>Pipedrive · {live.dealCount} deals live</span>}
        </div>
        <div style={css('font-size:12.5px;color:var(--text3);margin-bottom:16px;')}>Keyword search across deal titles and notes · Ask AI answers plain-English questions from the live deal book</div>

        <div style={css('display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border2);border-radius:11px;padding:4px 4px 4px 16px;margin-bottom:8px;')}>
          <Icon name="search" size={15} style={css('color:var(--text2);flex:0 0 auto;')} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} aria-label="Search deal titles and notes" placeholder="Search deals & notes, or ask: 'have we ever LOI'd this owner?'…" style={css('flex:1;height:40px;background:transparent;border:none;outline:none;color:var(--text);font-size:14px;min-width:0;')} />
          <button className="tap hov" onClick={search} disabled={busy || chatBusy} style={css(`height:38px;padding:0 18px;background:var(--accent);border:none;border-radius:8px;color:#06120F;font-weight:600;font-size:13px;opacity:${busy || chatBusy ? '.6' : '1'};`)}>{busy ? 'Searching…' : 'Search'}</button>
          <button className="tap hov" onClick={ask} disabled={busy || chatBusy} style={css(`height:38px;padding:0 16px;background:var(--surface3);border:1px solid var(--accent-line);border-radius:8px;color:var(--accent);font-weight:600;font-size:13px;opacity:${busy || chatBusy ? '.6' : '1'};`)}>{chatBusy ? 'Thinking…' : 'Ask AI'}</button>
        </div>
        <div style={css('display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;')}>
          {KNOWN_QUESTIONS.map((k) => (
            <button key={k.preset} className="hov" onClick={() => run({ preset: k.preset })} style={css('height:28px;padding:0 12px;background:var(--surface2);border:1px solid var(--border);border-radius:14px;color:var(--text2);font-size:11.5px;white-space:nowrap;')}>{k.label}</button>
          ))}
        </div>

        {err && (
          <div role="alert" style={css('border:1px solid var(--red);background:var(--red-tint);border-radius:9px;padding:10px 13px;margin-bottom:14px;font-size:12px;color:var(--text2);')}>{err}</div>
        )}

        {chat && (
          <div style={css('background:var(--surface);border:1px solid var(--accent-line);border-radius:10px;padding:16px 18px;margin-bottom:22px;')}>
            <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:10px;')}>
              <span style={css('width:7px;height:7px;border-radius:50%;background:var(--accent);')} />
              <span style={css('font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;')}>AI answer</span>
              <span style={css(sampleTag)}>from {chat.dealCount} Pipedrive deals · follow-ups keep context</span>
              <button className="hov" onClick={clearChat} aria-label="Clear AI answer" style={css('margin-left:auto;height:24px;padding:0 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text3);font-size:11px;')}>Clear</button>
            </div>
            <div style={css('font-size:12px;color:var(--text3);margin-bottom:8px;')}>“{chat.question}”</div>
            <div style={css('font-size:13px;color:var(--text);line-height:1.65;white-space:pre-wrap;')}>{chat.answer}</div>
            {chat.citations?.length > 0 && (
              <div style={css('display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;')}>
                {chat.citations.map((c) => (
                  <a key={c.id} href={c.url} target="_blank" rel="noreferrer" style={css('font-size:11px;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-line);padding:3px 9px;border-radius:6px;text-decoration:none;')}>{c.title} →</a>
                ))}
              </div>
            )}
          </div>
        )}

        {result && (
          <div style={css('background:var(--surface);border:1px solid var(--accent-line);border-radius:10px;padding:16px 18px;margin-bottom:22px;')}>
            <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:12px;')}>
              <span style={css('width:7px;height:7px;border-radius:50%;background:var(--accent);')} />
              <span style={css('font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;')}>
                {result.mode === 'preset' ? result.label : 'Search results'}
              </span>
              <span style={css(sampleTag)}>{result.results.length} match{result.results.length === 1 ? '' : 'es'} · Pipedrive live</span>
              <button className="hov" onClick={() => setResult(null)} aria-label="Clear results" style={css('margin-left:auto;height:24px;padding:0 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text3);font-size:11px;')}>Clear</button>
            </div>
            {result.results.length === 0 && (
              <div style={css('font-size:13px;color:var(--text3);')}>No deals matched — try a different keyword (search covers titles, contacts, and every note).</div>
            )}
            <div style={css('display:flex;flex-direction:column;gap:10px;')}>
              {result.results.map((d) => (
                <div key={d.id} style={css('border:1px solid var(--border);border-radius:9px;padding:12px 14px;background:var(--surface2);')}>
                  <div style={css('display:flex;align-items:center;gap:9px;flex-wrap:wrap;')}>
                    <a href={d.url} target="_blank" rel="noreferrer" style={css('font-weight:600;font-size:13.5px;color:var(--text);text-decoration:none;')}>{d.title}</a>
                    <span style={css(statusStyle(d.status))}>{d.status}</span>
                    <span style={css('font-size:11px;color:var(--text3);')}>{d.pipeline} / {d.stage}</span>
                    <span style={css('margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--text2);')}>{fmtVal(d.value, d.currency)}</span>
                  </div>
                  <div style={css('display:flex;gap:14px;font-size:11.5px;color:var(--text3);margin-top:5px;flex-wrap:wrap;')}>
                    {d.person && <span>{d.person}{d.org ? ` · ${d.org}` : ''}</span>}
                    <span>{d.notesCount} note{d.notesCount === 1 ? '' : 's'}</span>
                    <span>updated {d.updated}</span>
                  </div>
                  {d.snippets?.length > 0 && (
                    <div style={css('margin-top:8px;display:flex;flex-direction:column;gap:4px;')}>
                      {d.snippets.map((s, i) => (
                        <div key={i} style={css('font-size:12px;color:var(--text2);line-height:1.55;border-left:2px solid var(--accent-line);padding-left:9px;')}>{s}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="deals-grid" style={css('display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;')}>
          <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;')}>
            <div style={css('display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid var(--border);')}>
              <span style={css('font-size:11.5px;font-weight:600;color:var(--text2);')}>{tableDeals ? 'Deal book' : 'Past deals & LOIs'}</span>
              <span style={css(sampleTag)}>{tableDeals ? 'Pipedrive · live' : 'Sample data'}</span>
            </div>
            {tableDeals ? (
              <>
                <div className="data-table-wrap" style={css('overflow-x:auto;')}>
                  <table style={css('width:100%;border-collapse:collapse;font-size:12px;')}>
                    <thead>
                      <tr style={css('background:var(--surface2);')}>
                        {[['DEAL', ''], ['CONTACT', ''], ['VALUE', 'r'], ['STATUS', ''], ['NOTES', 'r'], ['UPDATED', 'col-secondary']].map(([h, m]) => (
                          <th key={h} className={m === 'col-secondary' ? 'col-secondary' : ''} style={css(`text-align:${m === 'r' ? 'right' : 'left'};padding:10px 12px;font-weight:600;color:var(--text2);font-size:10px;letter-spacing:.04em;`)}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableDeals.map((d) => (
                        <tr key={d.id} style={css('border-top:1px solid var(--border);')}>
                          <td style={css('padding:11px 12px;')}><a href={d.url} target="_blank" rel="noreferrer" style={css('font-weight:500;color:var(--text);text-decoration:none;')}>{d.title}</a><div style={css('font-size:10.5px;color:var(--text3);')}>{d.pipeline} / {d.stage}</div></td>
                          <td style={css('padding:11px 12px;color:var(--text2);')}>{d.person || '—'}{d.org ? <div style={css('font-size:10.5px;color:var(--text3);')}>{d.org}</div> : null}</td>
                          <td style={css('padding:11px 12px;text-align:right;font-family:var(--mono);')}>{fmtVal(d.value, d.currency)}</td>
                          <td style={css('padding:11px 12px;')}><span style={css(statusStyle(d.status))}>{d.status}</span></td>
                          <td style={css('padding:11px 12px;text-align:right;font-family:var(--mono);color:var(--text2);')}>{d.notesCount || '—'}</td>
                          <td className="col-secondary" style={css('padding:11px 12px;color:var(--text3);font-family:var(--mono);font-size:11px;white-space:nowrap;')}>{d.updated}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-list" style={css('flex-direction:column;')}>
                  {tableDeals.map((d) => (
                    <div key={d.id} style={css('display:flex;flex-direction:column;gap:7px;padding:14px;border-top:1px solid var(--border);')}>
                      <div style={css('display:flex;align-items:center;gap:9px;')}><a href={d.url} target="_blank" rel="noreferrer" style={css('font-weight:600;font-size:14px;flex:1;color:var(--text);text-decoration:none;')}>{d.title}</a><span style={css(statusStyle(d.status))}>{d.status}</span></div>
                      <div style={css('font-size:11.5px;color:var(--text3);')}>{d.pipeline} / {d.stage}</div>
                      <div style={css('display:flex;gap:16px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{d.person || d.org || '—'}</span><span style={css('font-family:var(--mono);')}>{fmtVal(d.value, d.currency)} · {d.updated}</span></div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="data-table-wrap" style={css('overflow-x:auto;')}>
                  <table style={css('width:100%;border-collapse:collapse;font-size:12px;')}>
                    <thead>
                      <tr style={css('background:var(--surface2);')}>
                        {[['DEAL', ''], ['OWNER', ''], ['OUR LOI', 'r'], ['CAP', 'r'], ['STATUS', ''], ['WHY PASSED', 'col-secondary'], ['DATE', 'col-secondary']].map(([h, m]) => (
                          <th key={h} className={m === 'col-secondary' ? 'col-secondary' : ''} style={css(`text-align:${m === 'r' ? 'right' : 'left'};padding:10px 12px;font-weight:600;color:var(--text2);font-size:10px;letter-spacing:.04em;`)}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DEALS.map((d, i) => (
                        <tr key={i} style={css('border-top:1px solid var(--border);')}>
                          <td style={css('padding:11px 12px;')}><div style={css('font-weight:500;')}>{d.deal}</div><div style={css('font-size:10.5px;color:var(--text3);')}>{d.prop}</div></td>
                          <td style={css('padding:11px 12px;color:var(--text2);')}>{d.owner}</td>
                          <td style={css('padding:11px 12px;text-align:right;font-family:var(--mono);')}>{d.offer}</td>
                          <td style={css('padding:11px 12px;text-align:right;font-family:var(--mono);color:var(--text2);')}>{d.cap}</td>
                          <td style={css('padding:11px 12px;')}><span style={css(statusStyle(d.status))}>{d.status}</span></td>
                          <td className="col-secondary" style={css('padding:11px 12px;color:var(--text2);font-size:11.5px;')}>{d.why}</td>
                          <td className="col-secondary" style={css('padding:11px 12px;color:var(--text3);font-family:var(--mono);font-size:11px;white-space:nowrap;')}>{d.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-list" style={css('flex-direction:column;')}>
                  {DEALS.map((d, i) => (
                    <div key={i} style={css('display:flex;flex-direction:column;gap:7px;padding:14px;border-top:1px solid var(--border);')}>
                      <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css('font-weight:600;font-size:14px;flex:1;')}>{d.deal}</span><span style={css(statusStyle(d.status))}>{d.status}</span></div>
                      <div style={css('font-size:11.5px;color:var(--text3);')}>{d.prop}</div>
                      <div style={css('display:flex;gap:16px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{d.owner}</span><span style={css('font-family:var(--mono);')}>{d.offer} · {d.cap}</span></div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;')}>
            <div style={css('font-size:12.5px;font-weight:600;margin-bottom:3px;')}>Dedupe check</div>
            <div style={css('font-size:11px;color:var(--text3);margin-bottom:13px;')}>{live ? `Checks the live Pipedrive deal book (${live.dealCount} deals) before any outreach.` : 'Guardrail the sourcing engine calls before any outreach.'}</div>
            <input value={dedupeQuery} onChange={(e) => setDedupeQuery(e.target.value)} aria-label="Check owner or address for prior contact" placeholder="Owner or address…" style={css('width:100%;height:36px;padding:0 11px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12.5px;outline:none;margin-bottom:13px;')} />
            {dedupe ? (
              <div style={css(`border:1px solid var(${dedupe.ok ? '--green' : '--red'});background:var(${dedupe.ok ? '--green-tint' : '--red-tint'});border-radius:8px;padding:11px 12px;`)}>
                <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:7px;')}><span style={css(`width:8px;height:8px;border-radius:50%;background:var(${dedupe.ok ? '--green' : '--red'});`)} /><span style={css('font-weight:600;font-size:13px;')}>{dedupe.verdict}</span></div>
                <div style={css('font-size:11.5px;color:var(--text2);line-height:1.6;')}>{dedupe.detail}</div>
                {dedupe.url && <a href={dedupe.url} target="_blank" rel="noreferrer" style={css('display:inline-block;margin-top:7px;font-size:11px;color:var(--accent);')}>Open in Pipedrive →</a>}
              </div>
            ) : (
              <div style={css('font-size:11.5px;color:var(--text3);')}>Enter an owner or address to check.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
