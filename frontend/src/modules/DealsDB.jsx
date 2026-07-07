import { useRef, useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { DEALS, EXAMPLE_QUERIES, PROPS } from '../data.js'
import { getSessionPassword } from '../session.js'

const statusVar = (s) => (s === 'Closed' ? '--green' : s === 'Under LOI' ? '--accent' : s === 'Lost' ? '--red' : '--amber')
const statusStyle = (s) => `font-size:11px;color:var(${statusVar(s)});background:var(--surface2);border:1px solid var(--border);padding:2px 8px;border-radius:5px;white-space:nowrap;`
const sampleTag = 'font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);border:1px solid var(--border2);border-radius:4px;padding:1px 6px;'

function checkDedupe(q) {
  const needle = q.trim().toLowerCase()
  if (!needle) return null
  const hay = [...DEALS.flatMap((d) => [d.owner, d.prop, d.deal]), ...PROPS.flatMap((p) => [p.owner || '', p.addr])]
  const hit = hay.find((h) => h && (h.toLowerCase().includes(needle) || needle.includes(h.toLowerCase())))
  if (hit) {
    const deal = DEALS.find((d) => [d.owner, d.prop, d.deal].some((x) => x.toLowerCase().includes(needle) || needle.includes(x.toLowerCase())))
    return { verdict: 'Previously contacted', ok: false, detail: deal ? `${deal.deal} · ${deal.status} · ${deal.date}. ${deal.why !== '—' ? deal.why : 'No further notes.'}` : `Matches a record in the sourcing universe (${hit}). Review before outreach.` }
  }
  return { verdict: 'No prior contact', ok: true, detail: 'Clear to add to the outreach queue.' }
}

export default function DealsDB() {
  const [query, setQuery] = useState('')
  const [thread, setThread] = useState([])          // [{role, content, citations?}]
  const [busy, setBusy] = useState(false)
  const [chatErr, setChatErr] = useState('')
  const [dedupeQuery, setDedupeQuery] = useState('')
  const dedupe = checkDedupe(dedupeQuery)
  const busyRef = useRef(false)

  const ask = async (q) => {
    const question = (q || '').trim()
    if (!question || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setChatErr('')
    setQuery('')
    const history = thread.map(({ role, content }) => ({ role, content }))
    setThread((t) => [...t, { role: 'user', content: question }])
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/deals-chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: getSessionPassword(), question, history }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `request failed (${r.status})`)
      setThread((t) => [...t, { role: 'assistant', content: d.answer, citations: d.citations || [] }])
    } catch (e) {
      setChatErr(e.message === 'Failed to fetch'
        ? 'No backend reachable — the deals chat needs the Railway server (npm run serve locally).'
        : e.message)
      setThread((t) => t.slice(0, -1)) // roll back the unanswered question
      setQuery(question)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="content-pad" data-screen-label="Deals DB" style={css('flex:1;overflow-y:auto;min-height:0;padding:24px 26px;')}>
      <div style={css('max-width:1100px;margin:0 auto;')}>
        <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:6px;')}>
          <h2 style={css('margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;')}>Deals DB</h2>
          <span style={css('font-size:10.5px;color:var(--text2);background:var(--surface2);border:1px solid var(--border);padding:3px 9px;border-radius:6px;')}>Internal · confidential</span>
        </div>
        <div style={css('font-size:12.5px;color:var(--text3);margin-bottom:16px;')}>Search-first memory of past deals and LOIs · nothing auto-sends</div>

        <div style={css('display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border2);border-radius:11px;padding:4px 4px 4px 16px;margin-bottom:8px;')}>
          <Icon name="search" size={15} style={css('color:var(--text2);flex:0 0 auto;')} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(query)} aria-label="Search past deals and LOIs" placeholder="Have we ever LOI'd this owner?  ·  What did we offer on Park Ave in 2022?" style={css('flex:1;height:40px;background:transparent;border:none;outline:none;color:var(--text);font-size:14px;min-width:0;')} />
          <button className="tap hov" onClick={() => ask(query)} disabled={busy} style={css(`height:38px;padding:0 18px;background:var(--accent);border:none;border-radius:8px;color:#06120F;font-weight:600;font-size:13px;opacity:${busy ? '.6' : '1'};`)}>{busy ? 'Thinking…' : 'Ask'}</button>
        </div>
        <div style={css('display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;')}>
          {EXAMPLE_QUERIES.map((q) => (
            <button key={q} className="hov" onClick={() => ask(q)} style={css('height:28px;padding:0 12px;background:var(--surface2);border:1px solid var(--border);border-radius:14px;color:var(--text2);font-size:11.5px;white-space:nowrap;')}>{q}</button>
          ))}
        </div>

        {chatErr && (
          <div role="alert" style={css('border:1px solid var(--red);background:var(--red-tint);border-radius:9px;padding:10px 13px;margin-bottom:14px;font-size:12px;color:var(--text2);')}>{chatErr}</div>
        )}
        {thread.length > 0 && (
          <div style={css('display:flex;flex-direction:column;gap:10px;margin-bottom:22px;')}>
            {thread.map((m, i) => m.role === 'user' ? (
              <div key={i} style={css('align-self:flex-end;max-width:80%;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:9px 13px;font-size:13px;color:var(--text);')}>{m.content}</div>
            ) : (
              <div key={i} style={css('background:var(--surface);border:1px solid var(--accent-line);border-radius:10px;padding:16px 18px;')}>
                <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:9px;')}><span style={css('width:7px;height:7px;border-radius:50%;background:var(--accent);')} /><span style={css('font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;')}>Answer</span><span style={css(sampleTag)}>Pipedrive · live</span></div>
                <div style={css('font-size:13.5px;line-height:1.65;margin-bottom:12px;white-space:pre-wrap;')}>{m.content}</div>
                {m.citations?.length > 0 && (
                  <div style={css('display:flex;gap:8px;flex-wrap:wrap;')}>
                    {m.citations.map((c) => (
                      <a key={c.id} href={c.url} target="_blank" rel="noreferrer" style={css('display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--accent);background:var(--accent-dim);padding:3px 9px;border-radius:5px;text-decoration:none;')}><Icon name="cite" size={12} sw={1.8} />#{c.id} {c.title}</a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:13px 18px;font-size:12.5px;color:var(--text3);')}>Searching the deal book…</div>
            )}
          </div>
        )}

        <div className="deals-grid" style={css('display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;')}>
          <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;')}>
            <div style={css('display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid var(--border);')}>
              <span style={css('font-size:11.5px;font-weight:600;color:var(--text2);')}>Past deals &amp; LOIs</span>
              <span style={css(sampleTag)}>Sample data</span>
            </div>
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
          </div>

          <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;')}>
            <div style={css('font-size:12.5px;font-weight:600;margin-bottom:3px;')}>Dedupe check</div>
            <div style={css('font-size:11px;color:var(--text3);margin-bottom:13px;')}>Guardrail the sourcing engine calls before any outreach.</div>
            <input value={dedupeQuery} onChange={(e) => setDedupeQuery(e.target.value)} aria-label="Check owner or address for prior contact" placeholder="Owner or address…" style={css('width:100%;height:36px;padding:0 11px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12.5px;outline:none;margin-bottom:13px;')} />
            {dedupe ? (
              <div style={css(`border:1px solid var(${dedupe.ok ? '--green' : '--red'});background:var(${dedupe.ok ? '--green-tint' : '--red-tint'});border-radius:8px;padding:11px 12px;`)}>
                <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:7px;')}><span style={css(`width:8px;height:8px;border-radius:50%;background:var(${dedupe.ok ? '--green' : '--red'});`)} /><span style={css('font-weight:600;font-size:13px;')}>{dedupe.verdict}</span></div>
                <div style={css('font-size:11.5px;color:var(--text2);line-height:1.6;')}>{dedupe.detail}</div>
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
