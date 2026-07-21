// Power-dialer console — PhoneBurner single-line dialer + LIVE HUMAN handoff.
// No AI voice: the rep talks on every connect (Initiative #7 decision; FCC 24-17).
// Flow: connect → stage DNC-scrubbed contacts → push to PhoneBurner → launch the
// dial session (embedded iframe, with an open-in-new-tab SSO fallback). Call
// outcomes post back via webhooks into the "Recent" column.
import { useState, useEffect, useMemo } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { scDot } from '../helpers.js'
import { pbStatus, pbPush, pbDial, pbRecent } from '../phoneBurner.js'
import { useCallQueue, removeFromQueue, clearQueue } from '../callQueue.js'

// The staging list is the shared call queue (callQueue.js): owners/brokers the
// operator added from the Properties map or table. Still DNC-scrub before dialing.
const splitName = (owner = '') => {
  const parts = String(owner).trim().split(/\s+/)
  const last = parts.length > 1 ? parts.pop() : ''
  return { first_name: parts.join(' '), last_name: last }
}
// Stable id used both as the PhoneBurner external_id and to match push-results back to a row.
const extId = (q, i) => q.addr || String(q.id ?? '') || `q${i}`
const toContact = (q, i) => ({ ...splitName(q.owner), phone: q.phone, address: q.addr, external_id: extId(q, i), notes: `Score ${q.score} · ${q.cat}` })

const callerTabBtn = (active) =>
  `flex:1;height:32px;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;${active ? 'background:var(--surface3);color:var(--text);box-shadow:inset 0 0 0 1px var(--border2);' : 'background:transparent;color:var(--text2);'}`
const dispColor = (d) => (/warm|qualif/i.test(d || '') ? '--green' : /do.?not|dnc/i.test(d || '') ? '--red' : '--text2')

export default function AICaller() {
  const [tab, setTab] = useState('active')
  const [status, setStatus] = useState(null)     // { configured, mode, connected }
  const queue = useCallQueue()
  const staged = useMemo(() => queue.map(toContact), [queue])
  const [pushed, setPushed] = useState([])        // [{external_id, phone, id}]
  const [dialUrl, setDialUrl] = useState('')      // redirect_url for the embedded dialer
  const [recent, setRecent] = useState([])
  const [busy, setBusy] = useState('')            // 'status' | 'push' | 'dial'
  const [err, setErr] = useState('')

  const refreshStatus = async () => {
    setBusy('status'); setErr('')
    try { setStatus(await pbStatus()) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const refreshRecent = async () => { try { setRecent((await pbRecent()).calls || []) } catch { /* ignore */ } }
  useEffect(() => { refreshStatus(); refreshRecent() }, [])

  const doPush = async () => {
    setBusy('push'); setErr('')
    try { setPushed((await pbPush(staged)).pushed || []) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const doDial = async () => {
    setBusy('dial'); setErr('')
    try {
      const ids = pushed.map((p) => p.id).filter(Boolean)
      const { redirect_url } = await pbDial(ids)
      setDialUrl(redirect_url)
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const closeDialer = () => { setDialUrl(''); refreshRecent() }

  const connected = status?.connected
  const statusLabel = !status ? 'checking…'
    : !status.configured ? 'not configured — set PhoneBurner env vars'
    : !status.connected ? `configured (${status.mode}) — not connected`
    : `connected · ${status.mode}`
  const statusColor = connected ? '--green' : status?.configured ? '--amber' : '--red'

  return (
    <div data-screen-label="Power Dialer" style={css('flex:1;display:flex;flex-direction:column;min-height:0;')}>
      {/* compliance banner */}
      <div style={css('flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--amber-tint);border-bottom:1px solid var(--border);flex-wrap:wrap;')}>
        <Icon name="alert" size={15} sw={1.8} stroke="var(--amber)" style={css('flex:0 0 auto;')} />
        <span style={css('font-size:12px;color:var(--amber);font-weight:500;')}>Single-line power dialer — a live person handles every conversation. No AI voice. Push only DNC-scrubbed contacts.</span>
        <div style={css('flex:1;')} />
        <div style={css('display:flex;gap:16px;font-size:11.5px;flex-wrap:wrap;align-items:center;')}>
          <span style={css(`display:flex;align-items:center;gap:6px;color:var(${statusColor});`)}><span style={css(`width:7px;height:7px;border-radius:50%;background:var(${statusColor});`)} />{statusLabel}</span>
          <span style={css('display:flex;align-items:center;gap:6px;color:var(--text2);')}>TCPA window: 9a–8p local</span>
        </div>
      </div>

      {err && <div style={css('flex:0 0 auto;padding:8px 20px;background:var(--red-tint);color:var(--red);font-size:12px;border-bottom:1px solid var(--border);')}>{err}</div>}

      {/* mobile tab strip */}
      <div className="caller-tabs" style={css('flex:0 0 auto;gap:3px;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--bg);')}>
        <button className="tap" onClick={() => setTab('active')} style={css(callerTabBtn(tab === 'active'))}>Dialer</button>
        <button className="tap" onClick={() => setTab('queue')} style={css(callerTabBtn(tab === 'queue'))}>Queue</button>
        <button className="tap" onClick={() => setTab('recent')} style={css(callerTabBtn(tab === 'recent'))}>Recent</button>
      </div>

      <div className="caller-grid" data-tab={tab} style={css('flex:1;display:grid;grid-template-columns:300px 1fr 300px;min-height:0;')}>
        {/* staged queue — the shared call queue (owners added from Properties) */}
        <div className="caller-queue" style={css('border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0;')}>
          <div style={css('flex:0 0 auto;padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:8px;')}>Staged to dial <span style={css('display:flex;align-items:center;gap:10px;')}>{queue.length > 0 && <button className="tap" onClick={clearQueue} style={css('background:none;border:none;color:var(--text3);font-size:11px;font-weight:400;cursor:pointer;')}>Clear</button>}<span style={css('font-family:var(--mono);color:var(--text3);font-weight:400;')}>{queue.length}</span></span></div>
          <div style={css('flex:1;overflow-y:auto;min-height:0;')}>
            {queue.length === 0 && (
              <div style={css('padding:20px 16px;font-size:11.5px;color:var(--text3);line-height:1.65;')}>No owners staged yet. Open a property in the <span style={css('color:var(--text2);')}>Properties</span> map or table and hit <span style={css('color:var(--text2);')}>“Add to call queue”</span> — or select rows and use the bulk bar.</div>
            )}
            {queue.map((q, i) => {
              const done = pushed.some((p) => p.external_id === extId(q, i))
              return (
                <div key={q.id || q.addr || i} style={css('padding:11px 16px;border-bottom:1px solid var(--border);')}>
                  <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:3px;')}><span style={css(scDot(q.cat))} /><span style={css('font-weight:500;font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{q.addr}</span>{done && <Icon name="check" size={12} sw={2.4} stroke="var(--green)" />}<button className="tap" onClick={() => removeFromQueue(q.id || q.addr)} aria-label={`Remove ${q.addr} from queue`} style={css('display:flex;align-items:center;background:none;border:none;color:var(--text3);padding:2px;cursor:pointer;')}><Icon name="x" size={13} /></button></div>
                  <div style={css('font-size:11px;color:var(--text2);')}>{q.owner}</div>
                  <div style={css('display:flex;justify-content:space-between;margin-top:4px;')}><span style={css('font-family:var(--mono);font-size:11px;color:var(--text3);')}>{q.phone || '—'}</span><span style={css('font-size:10.5px;color:var(--text3);')}>{q.last}</span></div>
                </div>
              )
            })}
          </div>
        </div>

        {/* dialer control */}
        <div className="caller-active" style={css('display:flex;flex-direction:column;min-height:0;background:var(--bg);')}>
          <div style={css('flex:1;overflow-y:auto;min-height:0;padding:24px;display:flex;flex-direction:column;gap:18px;')}>
            <div>
              <div style={css('font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);font-weight:600;margin-bottom:8px;')}>Provider</div>
              <div style={css('display:flex;align-items:center;gap:10px;')}>
                <span style={css('font-size:15px;font-weight:600;')}>PhoneBurner</span>
                <span style={css(`font-size:11px;color:var(${statusColor});background:var(--surface2);border:1px solid var(--border);padding:2px 8px;border-radius:5px;`)}>{statusLabel}</span>
                <button className="tap hov" onClick={refreshStatus} disabled={busy === 'status'} style={css('margin-left:auto;height:30px;padding:0 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text2);font-size:12px;')}>{busy === 'status' ? '…' : 'Check'}</button>
              </div>
            </div>

            {/* step 1: push */}
            <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:16px;')}>
              <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:8px;')}><span style={css('width:20px;height:20px;border-radius:50%;background:var(--surface3);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;')}>1</span><span style={css('font-weight:600;font-size:13px;')}>Push staged contacts</span><span style={css('margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--text3);')}>{pushed.length}/{staged.length} pushed</span></div>
              <div style={css('font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:12px;')}>Sends the {staged.length} staged (DNC-scrubbed) contacts into PhoneBurner as a dial list.</div>
              <button className="tap hov" onClick={doPush} disabled={!connected || busy === 'push'} style={css(`height:40px;padding:0 18px;border-radius:8px;font-weight:600;font-size:12.5px;border:1px solid var(--border2);${connected ? 'background:var(--surface2);color:var(--text);' : 'background:var(--surface2);color:var(--text3);cursor:not-allowed;'}`)}>{busy === 'push' ? 'Pushing…' : `Push ${staged.length} contacts`}</button>
            </div>

            {/* step 2: launch */}
            <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:16px;')}>
              <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:8px;')}><span style={css('width:20px;height:20px;border-radius:50%;background:var(--surface3);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;')}>2</span><span style={css('font-weight:600;font-size:13px;')}>Launch power dialer</span></div>
              <div style={css('font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:12px;')}>Opens the PhoneBurner dialer embedded here (SSO — no separate login). It auto-dials and connects you live on every human answer.</div>
              <button className="tap hov" onClick={doDial} disabled={!pushed.length || busy === 'dial'} style={css(`height:44px;padding:0 22px;border-radius:8px;font-weight:600;font-size:13px;border:1px solid var(--accent);${pushed.length ? 'background:var(--accent);color:#fff;' : 'background:var(--surface2);color:var(--text3);cursor:not-allowed;border-color:var(--border2);'}`)}>{busy === 'dial' ? 'Starting…' : 'Launch dialer'}</button>
            </div>
          </div>
        </div>

        {/* recent (from webhooks) */}
        <div className="caller-recent" style={css('border-left:1px solid var(--border);display:flex;flex-direction:column;min-height:0;')}>
          <div style={css('flex:0 0 auto;padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;')}>Recent calls <button className="tap" onClick={refreshRecent} style={css('background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;')}>refresh</button></div>
          <div style={css('flex:1;overflow-y:auto;min-height:0;')}>
            {recent.length === 0 && <div style={css('padding:16px;font-size:11.5px;color:var(--text3);line-height:1.6;')}>Outcomes appear here once the dialer posts back (webhook). Set <span style={css('font-family:var(--mono);')}>PHONEBURNER_WEBHOOK_SECRET</span> + <span style={css('font-family:var(--mono);')}>PUBLIC_BASE_URL</span> to enable.</div>}
            {recent.map((r, i) => (
              <div key={i} style={css('padding:11px 16px;border-bottom:1px solid var(--border);')}>
                <div style={css('display:flex;justify-content:space-between;margin-bottom:3px;')}><span style={css('font-size:12.5px;font-weight:500;')}>{r.name || r.phone || '—'}</span><span style={css('font-size:10.5px;color:var(--text3);')}>{r.event}</span></div>
                {r.external_id && <div style={css('font-size:11px;color:var(--text2);margin-bottom:5px;')}>{r.external_id}</div>}
                {r.disposition && <span style={css(`font-size:10.5px;color:var(${dispColor(r.disposition)});background:var(--surface2);border:1px solid var(--border);padding:2px 7px;border-radius:5px;`)}>{r.disposition}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* embedded dialer (iframe) with new-tab SSO fallback */}
      {dialUrl && (
        <div style={css('position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:flex;flex-direction:column;')}>
          <div style={css('flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--border);')}>
            <span style={css('font-size:13px;font-weight:600;')}>PhoneBurner dialer</span>
            <a href={dialUrl} target="_blank" rel="noreferrer" style={css('font-size:12px;color:var(--accent);text-decoration:none;')}>Open in new tab ↗</a>
            <span style={css('font-size:11px;color:var(--text3);')}>(use the new tab if the embed is blank — some accounts block embedding)</span>
            <div style={css('flex:1;')} />
            <button className="tap hov" onClick={closeDialer} style={css('height:32px;padding:0 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:12.5px;font-weight:600;')}>Close</button>
          </div>
          <iframe title="PhoneBurner dialer" src={dialUrl} allow="microphone; autoplay; clipboard-write" style={css('flex:1;width:100%;border:none;background:#fff;')} />
        </div>
      )}
    </div>
  )
}
