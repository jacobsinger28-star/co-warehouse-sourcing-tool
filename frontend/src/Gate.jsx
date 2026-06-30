import { useState } from 'react'
import { css } from './css.js'
import { loadRealData } from './crypto.js'
import { RealDataContext } from './RealDataContext.js'

// Access gate for this internal, PII-bearing tool. The same password (a) passes a
// SHA-256 check for fast UX feedback and (b) derives the AES-256-GCM key that
// decrypts the real-data export (data.enc.json) client-side — so the owner/broker
// PII can ride along on a PUBLIC static deploy as ciphertext and is only readable
// with the password. The password is never stored (no sessionStorage): a reload
// re-prompts. To change it: shasum -a 256 the new value, swap PW_HASH, and re-run
// `DASHBOARD_PASSWORD=… node tools/encrypt_data.mjs`.
const PW_HASH = 'be55c493fa78734fbcd06ec54d500cf21f6ef25edfca096f00776b45265513f5'

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Gate({ children }) {
  const [ok, setOk] = useState(false)
  const [realData, setRealData] = useState(null)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

  if (ok) return <RealDataContext.Provider value={realData}>{children}</RealDataContext.Provider>

  const submit = async (e) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true)
    setErr(false)
    const match = (await sha256Hex(pw)) === PW_HASH
    if (!match) {
      setErr(true)
      setPw('')
      setBusy(false)
      return
    }
    // Correct password → decrypt the real dataset (null → synthetic fallback).
    const data = await loadRealData(pw, import.meta.env.BASE_URL).catch(() => null)
    setRealData(data)
    setOk(true)
  }

  return (
    <div data-theme="dark" style={css('min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);padding:24px;')}>
      <form onSubmit={submit} style={css('width:min(360px,92vw);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:14px;padding:28px 26px;box-shadow:0 24px 70px rgba(0,0,0,.5);')}>
        <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:18px;')}>
          <div style={css('width:22px;height:22px;border-radius:5px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-dim);')} />
          <span style={css('font-weight:600;font-size:15px;letter-spacing:-.01em;')}>SimiCapital</span>
          <span style={css('color:var(--text3);')}>·</span>
          <span style={css('color:var(--text2);font-weight:500;font-size:13px;')}>Sourcing</span>
        </div>
        <div style={css('font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.5;')}>Enter the access password to continue.</div>

        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => { setPw(e.target.value); setErr(false) }}
          aria-label="Access password"
          aria-invalid={err}
          placeholder="Password"
          style={css(`height:42px;padding:0 13px;background:var(--surface2);border:1px solid ${err ? 'var(--red)' : 'var(--border2)'};border-radius:9px;color:var(--text);font-size:14px;outline:none;`)}
        />
        {err && <div role="alert" style={css('margin-top:9px;font-size:12px;color:var(--red);')}>Incorrect password — try again.</div>}

        <button type="submit" disabled={busy || !pw} style={css(`margin-top:16px;height:42px;border:none;border-radius:9px;background:var(--accent);color:#06120F;font-weight:600;font-size:13.5px;cursor:${busy || !pw ? 'default' : 'pointer'};opacity:${busy || !pw ? '.6' : '1'};`)}>
          {busy ? 'Decrypting…' : 'Unlock'}
        </button>

        <div style={css('margin-top:18px;display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--text3);')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:var(--text3);')} />
          Internal tool · holds owner/broker data · do not share
        </div>
      </form>
    </div>
  )
}
