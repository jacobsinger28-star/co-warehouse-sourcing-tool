import { useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { CALL_QUEUE, ACTIVE_CALL, TRANSCRIPT, RECENT_CALLS } from '../data.js'
import { scDot } from '../helpers.js'

const dispColor = (d) => (d === 'Warm' ? '--green' : d === 'Do-not-call' ? '--red' : '--text2')
const callerTabBtn = (active) =>
  `flex:1;height:32px;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;${active ? 'background:var(--surface3);color:var(--text);box-shadow:inset 0 0 0 1px var(--border2);' : 'background:transparent;color:var(--text2);'}`

export default function AICaller() {
  const [callsRun, setCallsRun] = useState(14)
  const [tab, setTab] = useState('active')
  const bump = () => setCallsRun((c) => c + 1)

  const transcriptStyle = (who) => (who === 'AI' ? 'align-self:flex-start;max-width:90%;' : 'align-self:flex-end;max-width:90%;text-align:right;')

  return (
    <div data-screen-label="AI Caller" style={css('flex:1;display:flex;flex-direction:column;min-height:0;')}>
      {/* compliance banner */}
      <div style={css('flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--amber-tint);border-bottom:1px solid var(--border);flex-wrap:wrap;')}>
        <Icon name="alert" size={15} sw={1.8} stroke="var(--amber)" style={css('flex:0 0 auto;')} />
        <span style={css('font-size:12px;color:var(--amber);font-weight:500;')}>Stub-safe — no live calls placed without an active provider connection.</span>
        <div style={css('flex:1;')} />
        <div style={css('display:flex;gap:16px;font-size:11.5px;flex-wrap:wrap;')}>
          <span style={css('display:flex;align-items:center;gap:6px;color:var(--green);')}><Icon name="check" size={13} sw={2.2} />DNC-checked</span>
          <span style={css('display:flex;align-items:center;gap:6px;color:var(--text2);')}><span style={css('width:7px;height:7px;border-radius:50%;background:var(--green);')} />TCPA window: open (9a–8p local)</span>
          <span style={css('display:flex;align-items:center;gap:6px;color:var(--text2);font-family:var(--mono);')}>{callsRun}/100 calls this run</span>
        </div>
      </div>

      {/* mobile tab strip */}
      <div className="caller-tabs" style={css('flex:0 0 auto;gap:3px;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--bg);')}>
        <button className="tap" onClick={() => setTab('active')} style={css(callerTabBtn(tab === 'active'))}>Active</button>
        <button className="tap" onClick={() => setTab('queue')} style={css(callerTabBtn(tab === 'queue'))}>Queue</button>
        <button className="tap" onClick={() => setTab('recent')} style={css(callerTabBtn(tab === 'recent'))}>Recent</button>
      </div>

      <div className="caller-grid" data-tab={tab} style={css('flex:1;display:grid;grid-template-columns:300px 1fr 300px;min-height:0;')}>
        {/* queue */}
        <div className="caller-queue" style={css('border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0;')}>
          <div style={css('flex:0 0 auto;padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;display:flex;justify-content:space-between;')}>Call queue <span style={css('font-family:var(--mono);color:var(--text3);font-weight:400;')}>{CALL_QUEUE.length}</span></div>
          <div style={css('flex:1;overflow-y:auto;min-height:0;')}>
            {CALL_QUEUE.map((q, i) => (
              <div key={i} style={css('padding:11px 16px;border-bottom:1px solid var(--border);')}>
                <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:3px;')}><span style={css(scDot(q.cat))} /><span style={css('font-weight:500;font-size:12.5px;')}>{q.addr}</span><span style={css('margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--text3);')}>{q.score}</span></div>
                <div style={css('font-size:11px;color:var(--text2);')}>{q.owner}</div>
                <div style={css('display:flex;justify-content:space-between;margin-top:4px;')}><span style={css('font-family:var(--mono);font-size:11px;color:var(--text3);')}>{q.phone}</span><span style={css('font-size:10.5px;color:var(--text3);')}>{q.last}</span></div>
              </div>
            ))}
          </div>
        </div>

        {/* active */}
        <div className="caller-active" style={css('display:flex;flex-direction:column;min-height:0;background:var(--bg);')}>
          <div style={css('flex:1;overflow-y:auto;min-height:0;padding:22px 24px;')}>
            <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:4px;')}><span style={css('width:9px;height:9px;border-radius:50%;background:var(--accent);animation:pulse 1.1s infinite;')} /><span style={css('font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;')}>Dialing</span></div>
            <div style={css('font-family:var(--mono);font-size:24px;font-weight:500;margin-bottom:2px;')}>{ACTIVE_CALL.phone}</div>
            <div style={css('font-size:13px;color:var(--text2);margin-bottom:18px;')}>{ACTIVE_CALL.owner} · {ACTIVE_CALL.addr}</div>
            <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:14px 16px;margin-bottom:16px;')}>
              <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:7px;')}>AI disclosure opener</div>
              <div style={css('font-size:13px;line-height:1.65;color:var(--text);')}>"Hi, this is an automated assistant calling on behalf of SimiCapital. This call may be recorded. We're reaching out about your property at {ACTIVE_CALL.addr} — do you have a moment?"</div>
            </div>
            <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:8px;')}>Live transcript</div>
            <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:14px 16px;min-height:120px;display:flex;flex-direction:column;gap:10px;')}>
              {TRANSCRIPT.map((t, i) => (
                <div key={i} style={css(transcriptStyle(t.who))}><span style={css('font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);')}>{t.who}</span><div style={css('font-size:12.5px;margin-top:2px;')}>{t.text}</div></div>
              ))}
            </div>
          </div>
          <div style={css('flex:0 0 auto;padding:14px 24px;border-top:1px solid var(--border);background:var(--bg);')}>
            <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:9px;')}>Disposition</div>
            <div style={css('display:flex;gap:9px;flex-wrap:wrap;')}>
              <button className="tap hov" onClick={bump} style={css('flex:1;min-width:150px;height:40px;background:var(--green-tint);border:1px solid var(--green);border-radius:8px;color:var(--green);font-weight:600;font-size:12.5px;')}>Warm → Pipedrive task</button>
              <button className="tap hov" onClick={bump} style={css('height:40px;padding:0 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text2);font-size:12.5px;')}>No answer</button>
              <button className="tap hov" onClick={bump} style={css('height:40px;padding:0 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text2);font-size:12.5px;')}>Not interested</button>
              <button className="tap hov" onClick={bump} style={css('height:40px;padding:0 14px;background:var(--red-tint);border:1px solid var(--red);border-radius:8px;color:var(--red);font-size:12.5px;')}>Do-not-call</button>
            </div>
          </div>
        </div>

        {/* recent */}
        <div className="caller-recent" style={css('border-left:1px solid var(--border);display:flex;flex-direction:column;min-height:0;')}>
          <div style={css('flex:0 0 auto;padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;')}>Recent calls</div>
          <div style={css('flex:1;overflow-y:auto;min-height:0;')}>
            {RECENT_CALLS.map((r, i) => (
              <div key={i} style={css('padding:11px 16px;border-bottom:1px solid var(--border);')}>
                <div style={css('display:flex;justify-content:space-between;margin-bottom:3px;')}><span style={css('font-size:12.5px;font-weight:500;')}>{r.owner}</span><span style={css('font-size:10.5px;color:var(--text3);')}>{r.time}</span></div>
                <div style={css('font-size:11px;color:var(--text2);margin-bottom:5px;')}>{r.addr}</div>
                <span style={css(`font-size:10.5px;color:var(${dispColor(r.disp)});background:var(--surface2);border:1px solid var(--border);padding:2px 7px;border-radius:5px;`)}>{r.disp}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
