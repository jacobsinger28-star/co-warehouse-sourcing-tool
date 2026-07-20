// Ask-style filter control — pure client-side keyword language (src/filterLang.js),
// no LLM, no API key, no network. Each query MERGES onto the current filters
// (stacking); "reset" starts over. The ? button opens the full known-terms list.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { css } from './css.js'
import Icon from './Icon.jsx'
import { parseQuery, VOCAB, EXAMPLES } from './filterLang.js'

export default function FilterChat({ onPatch }) {
  const [msg, setMsg] = useState('')
  const [reply, setReply] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)

  const send = (e) => {
    e?.preventDefault()
    const m = msg.trim()
    if (!m) return
    const res = parseQuery(m)
    if (Object.keys(res.patch).length) onPatch(res.patch)
    setReply(res.reply)
    setMsg('')
  }

  return (
    <div style={css('margin-bottom:18px;')}>
      <form onSubmit={send} style={css('display:flex;align-items:center;gap:6px;height:34px;padding:0 6px 0 10px;background:var(--surface2);border:1px solid var(--accent-line);border-radius:8px;')}>
        <span aria-hidden="true" style={css('flex:0 0 auto;font-size:9px;font-weight:700;letter-spacing:.05em;color:var(--accent);')}>ASK</span>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          aria-label="Describe filters in plain English"
          placeholder="vacant nashville · over 100k sf…"
          style={css('flex:1;min-width:0;background:transparent;border:none;outline:none;color:var(--text);font-size:12px;')}
        />
        <button type="button" onClick={() => setHelpOpen(true)} aria-label="Show all known search terms" className="tap" style={css('flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:24px;height:24px;background:var(--surface3);border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:12px;font-weight:600;')}>?</button>
        <button type="submit" disabled={!msg.trim()} aria-label="Apply" className="tap" style={css(`flex:0 0 auto;height:24px;padding:0 10px;border:none;border-radius:6px;font-size:11px;font-weight:600;${!msg.trim() ? 'background:var(--surface3);color:var(--text3);' : 'background:var(--accent);color:#06120F;'}`)}>Go</button>
      </form>
      {reply && <div role="status" style={css('margin-top:7px;font-size:11px;line-height:1.5;color:var(--text2);')}>{reply}</div>}

      {helpOpen && createPortal(
        <>
          <div onClick={() => setHelpOpen(false)} style={css('position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:140;animation:fadein .15s ease;')} />
          <div role="dialog" aria-label="Known search terms" style={css('position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:141;width:min(680px,94vw);max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.5);animation:fadein .15s ease;')}>
            <div style={css('flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--border);')}>
              <span style={css('font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--accent);')}>ASK</span>
              <span style={css('font-size:14.5px;font-weight:600;')}>Everything the filter search understands</span>
              <button className="tap" onClick={() => setHelpOpen(false)} aria-label="Close" style={css('margin-left:auto;display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text2);')}><Icon name="x" size={15} /></button>
            </div>
            <div style={css('flex:1;overflow-y:auto;padding:14px 18px 18px;')}>
              <div style={css('font-size:11.5px;color:var(--text2);line-height:1.55;margin-bottom:14px;')}>
                Combine as many terms as you want in one query. Every query <b>adds to</b> the current
                filters — search once, then narrow further with the next query. Say <b>reset</b> to start over.
              </div>
              {VOCAB.map((sec) => (
                <div key={sec.title} style={css('margin-bottom:16px;')}>
                  <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:7px;')}>{sec.title}</div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;')}>
                    {sec.rows.map(([what, terms]) => (
                      <div key={what} style={css('display:flex;gap:10px;font-size:11.5px;line-height:1.5;')}>
                        <span style={css('flex:0 0 172px;color:var(--text);font-weight:500;')}>{what}</span>
                        <span style={css('flex:1;color:var(--text3);font-family:var(--mono);font-size:10.5px;')}>{terms}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div style={css('padding-top:12px;border-top:1px solid var(--border);')}>
                <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:7px;')}>Try one</div>
                <div style={css('display:flex;flex-wrap:wrap;gap:6px;')}>
                  {EXAMPLES.map((ex) => (
                    <button key={ex} className="tap hov" onClick={() => { setMsg(ex); setHelpOpen(false) }} style={css('height:26px;padding:0 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:13px;color:var(--text);font-size:11px;')}>{ex}</button>
                  ))}
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
