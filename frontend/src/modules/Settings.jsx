// Settings → Integrations: the self-serve BYOK surface over tenant_secrets.
// Write-only by design — the server returns only masked configured/source status,
// so a stored key is never round-tripped to the browser. Rendered per auth model
// (paste fields for static + oauth-app creds), grouped by category.
import { useEffect, useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { getConnections, saveConnection } from '../settingsApi.js'

const FIELD_LABEL = {
  api_key: 'API key', api_token: 'API token',
  client_id: 'Client ID', client_secret: 'Client secret', redirect_uri: 'Redirect URI',
}

function StatusChip({ connector }) {
  const { configured, source, provider } = connector
  let bg = 'var(--surface2)'; let fg = 'var(--text3)'; let dot = 'var(--text3)'; let text = 'Not connected'
  if (configured) {
    bg = 'rgba(52,199,123,.12)'; fg = 'var(--accent)'; dot = 'var(--accent)'
    text = source === 'env' ? 'Connected · server key' : 'Connected'
  } else if (provider === 'llm.anthropic') {
    bg = 'rgba(90,150,255,.12)'; fg = '#7ea6ff'; dot = '#7ea6ff'; text = "Using SimiCapital's key · metered"
  }
  return (
    <span style={css(`display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:${bg};color:${fg};`)}>
      <span style={css(`width:6px;height:6px;border-radius:50%;background:${dot};`)} />{text}
    </span>
  )
}

function FieldRow({ provider, field, writable, onSaved }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {ok, text}
  const save = async () => {
    if (!value.trim()) return
    setBusy(true); setMsg(null)
    try { await saveConnection(provider, field, value.trim()); setValue(''); setMsg({ ok: true, text: 'Saved · encrypted' }); onSaved?.() }
    catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }
  return (
    <div style={css('display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;')}>
      <label style={css('font-size:11px;color:var(--text3);min-width:92px;')}>{FIELD_LABEL[field] || field}</label>
      <input
        type="password" autoComplete="off" value={value} disabled={!writable || busy}
        onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder={writable ? 'paste to set — write-only' : 'read-only in the shared workspace'}
        style={css('flex:1;min-width:200px;height:32px;padding:0 10px;font-size:12.5px;font-family:var(--mono);background:var(--surface);border:1px solid var(--border);border-radius:7px;color:var(--text);' + (!writable ? 'opacity:.6;' : ''))}
      />
      <button className="hov" onClick={save} disabled={!writable || busy || !value.trim()}
        style={css('height:32px;padding:0 14px;background:var(--accent);border:none;border-radius:7px;color:#06120F;font-weight:600;font-size:12px;' + (!writable || !value.trim() ? 'opacity:.5;cursor:not-allowed;' : ''))}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      {msg && <span style={css(`font-size:11px;color:${msg.ok ? 'var(--accent)' : '#ff6b6b'};`)}>{msg.text}</span>}
    </div>
  )
}

export default function Settings() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const load = () => getConnections().then(setData).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <div style={css('padding:28px;color:#ff6b6b;')}>Couldn't load integrations: {err}</div>
  if (!data) return <div style={css('padding:28px;color:var(--text3);')}>Loading integrations…</div>

  const cats = [...new Set(data.connectors.map((c) => c.category))]
  return (
    <div style={css('max-width:820px;margin:0 auto;padding:24px 20px 60px;')}>
      <h2 style={css('font-size:19px;font-weight:700;color:var(--text);margin:0 0 4px;')}>Integrations</h2>
      <p style={css('font-size:12.5px;color:var(--text3);margin:0 0 4px;')}>
        Connect this workspace to your own tools. Keys are <b>write-only</b> — stored encrypted, never shown again, never logged.
      </p>

      {!data.writable && (
        <div style={css('display:flex;gap:10px;align-items:flex-start;margin:14px 0 4px;padding:12px 14px;background:rgba(240,180,60,.1);border:1px solid rgba(240,180,60,.3);border-radius:9px;')}>
          <Icon name="alert" size={16} sw={2} />
          <div style={css('font-size:12.5px;color:var(--text2);line-height:1.5;')}>
            This is the <b>shared workspace</b> — integrations here use server-managed keys and are read-only.
            Bring-your-own-keys unlocks once your company is provisioned as its own tenant.
          </div>
        </div>
      )}

      {cats.map((cat) => (
        <section key={cat} style={css('margin-top:22px;')}>
          <div style={css('font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;')}>{cat}</div>
          {data.connectors.filter((c) => c.category === cat).map((c) => (
            <div key={c.provider} style={css('padding:14px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:11px;margin-bottom:10px;')}>
              <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;')}>
                <div style={css('font-size:14px;font-weight:600;color:var(--text);')}>{c.label}</div>
                <StatusChip connector={c} />
              </div>
              {c.note && <div style={css('font-size:11.5px;color:var(--text3);margin-top:4px;line-height:1.5;')}>{c.note}</div>}
              {c.fields.map((f) => (
                <FieldRow key={f} provider={c.provider} field={f} writable={data.writable} onSaved={load} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
