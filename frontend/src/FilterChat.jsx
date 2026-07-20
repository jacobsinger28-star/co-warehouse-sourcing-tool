// Ask-style filter control: type "vacant Nashville over 100k sf, only actionable"
// and the server (POST /api/filter-chat → Claude) returns a validated patch that
// App.jsx applies to the real filter state. Same auth as every other API call.
import { useState } from 'react'
import { css } from './css.js'
import { authHeaders, authBody } from './session.js'

export default function FilterChat({ state, onPatch }) {
  const [msg, setMsg] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (e) => {
    e?.preventDefault()
    const m = msg.trim()
    if (!m || busy) return
    setBusy(true)
    setReply('')
    try {
      const r = await fetch('/api/filter-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...authBody(), message: m, state }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
      if (d.patch) onPatch(d.patch)
      setReply(d.reply || 'Done.')
      setMsg('')
    } catch (ex) {
      setReply(ex?.message || 'Failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={css('margin-bottom:18px;')}>
      <form onSubmit={send} style={css('display:flex;align-items:center;gap:6px;height:34px;padding:0 6px 0 10px;background:var(--surface2);border:1px solid var(--accent-line);border-radius:8px;')}>
        <span aria-hidden="true" style={css('flex:0 0 auto;font-size:9px;font-weight:700;letter-spacing:.05em;color:var(--accent);')}>AI</span>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          aria-label="Describe filters in plain English"
          placeholder="Ask: vacant Nashville · >100k SF…"
          disabled={busy}
          style={css('flex:1;min-width:0;background:transparent;border:none;outline:none;color:var(--text);font-size:12px;')}
        />
        <button type="submit" disabled={busy || !msg.trim()} aria-label="Apply" className="tap" style={css(`flex:0 0 auto;height:24px;padding:0 10px;border:none;border-radius:6px;font-size:11px;font-weight:600;${busy || !msg.trim() ? 'background:var(--surface3);color:var(--text3);' : 'background:var(--accent);color:#06120F;'}`)}>
          {busy ? '…' : 'Go'}
        </button>
      </form>
      {reply && <div role="status" style={css('margin-top:7px;font-size:11px;line-height:1.5;color:var(--text2);')}>{reply}</div>}
    </div>
  )
}
