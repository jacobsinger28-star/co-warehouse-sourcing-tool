// Ask-style filter control — pure client-side keyword language (src/filterLang.js),
// no LLM, no API key, no network. The rail bar is just a TRIGGER: clicking it
// opens the modal, which holds a big type-to-search input (Enter applies) plus
// every known term as a clickable chip (click = instant apply; the modal stays
// open so clicks and queries stack). "reset" starts over.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { css } from './css.js'
import Icon from './Icon.jsx'
import { parseQuery, patchForTerm, patchSatisfied, inversePatch, isDefaultTerm, VOCAB, EXAMPLES } from './filterLang.js'
import { recordApply, recordUnmatched, topTerms, unmatchedList, clearUsage } from './filterUsage.js'

export default function FilterChat({ state, onPatch }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [reply, setReply] = useState('')       // last result, shown under the rail trigger
  const [popReply, setPopReply] = useState('') // same result, pinned inside the modal
  // usage memory (device-local) — powers the "Frequent" and "Not recognized" rows
  const [frequent, setFrequent] = useState([])
  const [unmatched, setUnmatched] = useState([])
  const refreshUsage = () => { setFrequent(topTerms(8)); setUnmatched(unmatchedList()) }
  const openModal = () => { setPopReply(''); refreshUsage(); setOpen(true) }

  const apply = (text) => {
    const res = parseQuery(text)
    const matched = Object.keys(res.patch).length > 0
    if (matched) { onPatch(res.patch); recordApply(text) }
    // remember queries the parser couldn't (fully) handle — nothing matched, or
    // some words were ignored — so the vocabulary gap stays visible
    if (!matched || (res.leftover && res.leftover.length)) recordUnmatched(text, res.leftover)
    refreshUsage()
    setPopReply(res.reply)
    setReply(res.reply)
  }
  // Chip click: not selected → apply the term; already selected → un-apply it
  // (back to that key's default). Selection is DERIVED from live state, so
  // changes made in the legacy filter rail light chips up too.
  const clickTerm = (term) => {
    const p = patchForTerm(term)
    if (patchSatisfied(p, state) && !isDefaultTerm(term)) {
      const inv = inversePatch(p)
      if (Object.keys(inv).length) onPatch(inv)
      setPopReply(`Removed — ${term}`)
      setReply(`Removed — ${term}`)
    } else {
      apply(term)
    }
  }

  const submit = (e) => {
    e?.preventDefault()
    const m = msg.trim()
    if (!m) return
    apply(m)
    setMsg('')
  }

  return (
    <div style={css('margin-bottom:18px;')}>
      <button
        type="button"
        onClick={openModal}
        aria-label="Open filter search"
        className="hov"
        style={css('display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 10px;background:var(--surface2);border:1px solid var(--accent-line);border-radius:8px;cursor:text;')}
      >
        <span aria-hidden="true" style={css('flex:0 0 auto;font-size:9px;font-weight:700;letter-spacing:.05em;color:var(--accent);')}>ASK</span>
        <span style={css('flex:1;min-width:0;text-align:left;color:var(--text3);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>vacant nashville · over 100k sf…</span>
      </button>
      {reply && <div role="status" style={css('margin-top:7px;font-size:11px;line-height:1.5;color:var(--text2);')}>{reply}</div>}

      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={css('position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:140;animation:fadein .15s ease;')} />
          <div role="dialog" aria-label="Filter search" style={css('position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:141;width:min(680px,94vw);max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.5);animation:fadein .15s ease;')}>
            <form onSubmit={submit} style={css('flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);')}>
              <span aria-hidden="true" style={css('flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--accent);')}>ASK</span>
              <input
                autoFocus
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false)
                  if (e.key === 'Enter') { e.preventDefault(); submit() }
                }}
                aria-label="Describe filters in plain English — Enter applies"
                placeholder="Type filters… e.g. vacant nashville over 100k sf — Enter applies"
                style={css('flex:1;min-width:0;height:40px;padding:0 12px;background:var(--surface2);border:1px solid var(--accent-line);border-radius:9px;color:var(--text);font-size:14px;outline:none;')}
              />
              <button type="button" className="tap" onClick={() => setOpen(false)} aria-label="Close" style={css('flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text2);')}><Icon name="x" size={15} /></button>
            </form>
            {popReply && (
              <div role="status" style={css('flex:0 0 auto;padding:8px 18px;border-bottom:1px solid var(--border);background:var(--accent-dim);font-size:11.5px;color:var(--text);line-height:1.5;')}>
                {popReply}
              </div>
            )}
            <div style={css('flex:1;overflow-y:auto;padding:14px 18px 18px;')}>
              <div style={css('font-size:11.5px;color:var(--text2);line-height:1.55;margin-bottom:14px;')}>
                Type any mix of terms and hit <b>Enter</b> — or <b>click any term below</b> to apply it
                instantly. Every query <b>adds to</b> the current filters; say <b>reset</b> to start over.
              </div>

              {/* FREQUENT — the filters this browser applies most, surfaced up top */}
              {frequent.length > 0 && (
                <div style={css('margin-bottom:16px;')}>
                  <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);font-weight:600;margin-bottom:7px;')}>Frequent</div>
                  <div style={css('display:flex;flex-wrap:wrap;gap:5px;')}>
                    {frequent.map(({ term, count }) => {
                      const on = patchSatisfied(patchForTerm(term), state)
                      return (
                        <button key={term} type="button" className={on ? 'term-chip on' : 'term-chip'} aria-pressed={on} onClick={() => clickTerm(term)} title={`Used ${count}×`} style={css('display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;background:var(--surface2);border:1px solid var(--border2);border-radius:12px;color:var(--text);font-size:11px;')}>{term}<span style={css('font-family:var(--mono);font-size:9px;color:var(--text3);')}>{count}</span></button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* NOT RECOGNIZED — searches the parser couldn't handle; a to-add list */}
              {unmatched.length > 0 && (
                <div style={css('margin-bottom:16px;padding:11px 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;')}>
                  <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:8px;')}>
                    <span style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;')}>Searched but not filtered</span>
                    <button type="button" className="hov" onClick={() => { clearUsage(); refreshUsage() }} style={css('margin-left:auto;background:none;border:none;color:var(--text3);font-size:10.5px;')}>Clear</button>
                  </div>
                  <div style={css('font-size:10.5px;color:var(--text3);line-height:1.5;margin-bottom:8px;')}>These didn’t match a known filter — worth adding to the vocabulary.</div>
                  <div style={css('display:flex;flex-wrap:wrap;gap:5px;')}>
                    {unmatched.slice(0, 10).map((u) => (
                      <button key={u.q} type="button" className="term-chip" onClick={() => { setMsg(u.q) }} title="Put back in the box to retry" style={css('height:22px;padding:0 8px;background:transparent;border:1px dashed var(--border2);border-radius:11px;color:var(--text2);font-size:10.5px;')}>{u.q}{u.leftover?.length ? <span style={css('color:var(--warn,#c98a3a);')}> · {u.leftover.slice(0, 3).join(' ')}</span> : null}</button>
                    ))}
                  </div>
                </div>
              )}

              {VOCAB.map((sec) => (
                <div key={sec.title} style={css('margin-bottom:16px;')}>
                  <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:7px;')}>{sec.title}</div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}>
                    {sec.rows.map(([what, terms]) => (
                      <div key={what} style={css('display:flex;gap:10px;font-size:11.5px;line-height:1.5;')}>
                        <span style={css('flex:0 0 172px;color:var(--text);font-weight:500;padding-top:2px;')}>{what}</span>
                        {Array.isArray(terms) ? (
                          <span style={css('flex:1;display:flex;flex-wrap:wrap;gap:5px;')}>
                            {terms.map((term) => {
                              const on = patchSatisfied(patchForTerm(term), state)
                              return (
                                <button key={term} type="button" className={on ? 'term-chip on' : 'term-chip'} aria-pressed={on} onClick={() => clickTerm(term)} title={on && !isDefaultTerm(term) ? `Remove: ${term}` : `Apply: ${term}`} style={css('height:22px;padding:0 8px;background:var(--surface2);border:1px solid var(--border2);border-radius:11px;color:var(--text3);font-family:var(--mono);font-size:10.5px;')}>{term}</button>
                              )
                            })}
                          </span>
                        ) : (
                          <span style={css('flex:1;color:var(--text3);font-size:11px;padding-top:2px;')}>{terms}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div style={css('padding-top:12px;border-top:1px solid var(--border);')}>
                <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:7px;')}>Try one</div>
                <div style={css('display:flex;flex-wrap:wrap;gap:6px;')}>
                  {EXAMPLES.map((ex) => {
                    const on = patchSatisfied(patchForTerm(ex), state)
                    return (
                      <button key={ex} type="button" className={on ? 'term-chip on' : 'term-chip'} aria-pressed={on} onClick={() => clickTerm(ex)} style={css('height:26px;padding:0 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:13px;color:var(--text);font-size:11px;')}>{ex}</button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
