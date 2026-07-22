// Settings → Integrations: the self-serve BYOK surface over tenant_secrets.
// Write-only by design — the server returns only masked configured/source status,
// so a stored key is never round-tripped to the browser. Rendered per auth model
// (paste fields for static + oauth-app creds), grouped by category.
import { useEffect, useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { getConnections, saveConnection, getBilling, startCheckout, openBillingPortal } from '../settingsApi.js'

const FIELD_LABEL = {
  api_key: 'API key', api_token: 'API token', access_token: 'Access token',
  client_id: 'Client ID', client_secret: 'Client secret', redirect_uri: 'Redirect URI',
  refresh_token: 'Refresh token',
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

// Plan & billing skeleton: reads /api/tenant/billing (plan, status, metered
// usage) and offers checkout. Until Stripe is live the server 501s checkout and
// this degrades to a preview of the plan catalog.
const RETURN_NOTICE = {
  success: { ok: true, text: 'Subscription active — thanks! Your plan is updated.' },
  canceled: { ok: false, text: 'Checkout canceled — no charge was made.' },
  managed: { ok: true, text: 'Billing updated.' },
}

// One billing card — plan, status, metered-usage bar, and actions. Rendered live
// for a provisioned (paying) tenant, and as a disabled illustration in the
// internal workspace so SimiCapital can see exactly how it looks for clients.
function BillingCard({ view, disabled = false, busy = '', msg = '', onUpgrade, onManage }) {
  const { aiCalls = 0, aiCallsIncluded = 0 } = view.usage || {}
  const pct = aiCallsIncluded ? Math.min(100, Math.round((aiCalls / aiCallsIncluded) * 100)) : 0
  const statusColor = view.status === 'active' ? 'var(--accent)' : view.status === 'past_due' ? '#ffb454' : 'var(--text3)'
  const btn = 'height:32px;padding:0 14px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-weight:600;background:var(--surface);color:var(--text);'
  return (
    <div style={css('padding:14px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:11px;')}>
      <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;')}>
        <div style={css('font-size:14px;font-weight:600;color:var(--text);')}>{view.plans?.[view.plan]?.label || view.plan} plan</div>
        <span style={css(`display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:var(--surface);color:${statusColor};`)}>
          <span style={css(`width:6px;height:6px;border-radius:50%;background:${statusColor};`)} />{view.status}
        </span>
      </div>
      {view.renewsAt && (
        <div style={css('font-size:11.5px;color:var(--text3);margin-top:4px;')}>Renews {new Date(view.renewsAt).toLocaleDateString()}</div>
      )}
      <div style={css('margin-top:12px;')}>
        <div style={css('display:flex;justify-content:space-between;font-size:11.5px;color:var(--text3);margin-bottom:5px;')}>
          <span>Metered AI calls this month</span>
          <span style={css('font-family:var(--mono);')}>{aiCalls} / {aiCallsIncluded}</span>
        </div>
        <div style={css('height:6px;background:var(--surface);border-radius:4px;overflow:hidden;')}>
          <div style={css(`height:100%;width:${pct}%;background:${pct >= 90 ? '#ffb454' : 'var(--accent)'};border-radius:4px;`)} />
        </div>
        <div style={css('font-size:11px;color:var(--text3);margin-top:5px;')}>Bring your own LLM key to go unmetered.</div>
      </div>
      <div style={css('display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;')}>
        {view.canManage && (
          <button className={disabled ? '' : 'hov'} disabled={disabled || busy !== ''} onClick={disabled ? undefined : onManage}
            style={css(btn + (disabled ? 'opacity:.6;cursor:default;' : ''))}>
            {busy === '__portal__' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
        {Object.values(view.plans || {}).filter((p) => p.priceMonthly > 0).map((p) => {
          const current = p.id === view.plan
          return (
            <button key={p.id} className={disabled ? '' : 'hov'} disabled={disabled || current || busy !== ''}
              onClick={disabled ? undefined : () => onUpgrade(p.id)}
              style={css(btn + (current || disabled ? 'opacity:.6;cursor:default;' : ''))}>
              {busy === p.id ? 'Opening checkout…' : current ? `${p.label} · current` : `${p.label} · $${p.priceMonthly}/mo`}
            </button>
          )
        })}
        {msg && <span style={css('font-size:11px;color:var(--text3);align-self:center;')}>{msg}</span>}
      </div>
    </div>
  )
}

function BillingSection() {
  const [b, setB] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  useEffect(() => { getBilling().then(setB).catch(() => setB({ error: true })) }, [])
  // Returning from Stripe checkout/portal (?billing=success|canceled|managed):
  // show a one-time notice and strip the param so a refresh doesn't repeat it.
  useEffect(() => {
    const url = new URL(window.location.href)
    const r = url.searchParams.get('billing')
    if (r && RETURN_NOTICE[r]) {
      setNotice(RETURN_NOTICE[r])
      url.searchParams.delete('billing')
      window.history.replaceState({}, '', url)
    }
  }, [])

  if (!b || b.error) return null // billing surface is optional — never block integrations
  const head = (
    <div style={css('font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;')}>Plan &amp; billing</div>
  )
  if (b.internal) {
    // SimiCapital's own (legacy/house) workspace isn't billed — but show a
    // disabled sample of the client billing surface so we can see how it looks.
    const preview = {
      plan: 'starter', status: 'active',
      renewsAt: new Date(Date.now() + 21 * 86400000).toISOString(),
      usage: { aiCalls: 340, aiCallsIncluded: b.plans?.starter?.meteredAiCalls || 500 },
      canManage: true, plans: b.plans,
    }
    return (
      <section style={css('margin-top:22px;')}>
        {head}
        <div style={css('padding:14px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:11px;font-size:12.5px;color:var(--text3);')}>
          Internal workspace — billing does not apply to SimiCapital.
        </div>
        <div style={css('display:flex;align-items:center;gap:8px;margin:18px 0 8px;')}>
          <span style={css('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);')}>Preview · how a client workspace sees billing</span>
          <span style={css('padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:rgba(240,180,60,.14);color:#e0a83a;')}>Sample</span>
        </div>
        <div style={css('opacity:.9;pointer-events:none;')} aria-hidden="true">
          <BillingCard view={preview} disabled />
        </div>
      </section>
    )
  }

  const upgrade = async (planId) => {
    setBusy(planId); setMsg('')
    try {
      const { url } = await startCheckout(planId)
      if (url) window.location.assign(url)
    } catch (e) { setMsg(e.message) }
    finally { setBusy('') }
  }
  const manage = async () => {
    setBusy('__portal__'); setMsg('')
    try {
      const { url } = await openBillingPortal()
      if (url) window.location.assign(url)
    } catch (e) { setMsg(e.message) }
    finally { setBusy('') }
  }
  return (
    <section style={css('margin-top:22px;')}>
      {head}
      {notice && (
        <div style={css(`display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:10px 14px;border-radius:9px;font-size:12.5px;background:${notice.ok ? 'rgba(52,199,123,.1)' : 'rgba(240,180,60,.1)'};border:1px solid ${notice.ok ? 'rgba(52,199,123,.3)' : 'rgba(240,180,60,.3)'};color:var(--text2);`)}>
          {notice.text}
        </div>
      )}
      <BillingCard view={b} busy={busy} msg={msg} onUpgrade={upgrade} onManage={manage} />
    </section>
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
    // The module container (App.jsx) is overflow:hidden and each module owns its
    // own scroll. Settings is plain flow content, so it needs this scroll wrapper
    // or its lower sections (billing, connectors) get clipped instead of scrolling.
    <div style={css('flex:1;height:100%;overflow-y:auto;')}>
      <div style={css('max-width:820px;margin:0 auto;padding:24px 20px 60px;')}>
      <h2 style={css('font-size:19px;font-weight:700;color:var(--text);margin:0 0 4px;')}>Integrations</h2>
      <p style={css('font-size:12.5px;color:var(--text3);margin:0 0 4px;')}>
        Connect this workspace to your own tools. Keys are <b>write-only</b> — stored encrypted, never shown again, never logged.
      </p>

      <BillingSection />

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
    </div>
  )
}
