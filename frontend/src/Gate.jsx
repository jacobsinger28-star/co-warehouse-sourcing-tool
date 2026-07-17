import { useEffect, useRef, useState } from 'react'
import { css } from './css.js'
import { loadRealData } from './crypto.js'
import { RealDataContext } from './RealDataContext.js'
import { setSessionPassword, setSessionToken } from './session.js'
import { signInWithPassword, startAutoRefresh } from './supabaseAuth.js'

// Access gate for this internal, PII-bearing tool. Two modes, picked at load:
//
//  1. SUPABASE (preferred, "real login") — when the server exposes a Supabase
//     project via GET /api/config (Railway env: SUPABASE_URL + SUPABASE_ANON_KEY),
//     or VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set (local dev). Each
//     person signs in with their own email + password; the server verifies the
//     JWT AND an email allowlist (ALLOWED_EMAILS) on every data route.
//
//  2. LEGACY shared password — no Supabase configured. The same password (a)
//     passes a SHA-256 check for fast UX feedback and (b) derives the AES-256-GCM
//     key that decrypts the static real-data export (data.enc.json) client-side,
//     or is checked server-side by POST /api/data on Railway. To change it:
//     shasum -a 256 the new value, swap PW_HASH, and re-run
//     `DASHBOARD_PASSWORD=… node tools/encrypt_data.mjs`.
//
// Credentials are never stored (no sessionStorage): a reload re-prompts.
const PW_HASH = 'be55c493fa78734fbcd06ec54d500cf21f6ef25edfca096f00776b45265513f5'

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Resolve the auth mode: a Supabase {url, anonKey} config, or null → legacy.
async function detectSupabase(baseUrl) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (url && anonKey) return { url, anonKey }
  try {
    const r = await fetch(`${baseUrl}api/config`, { cache: 'no-store' })
    if (r.ok) return (await r.json())?.supabase ?? null
  } catch { /* static host, no backend → legacy */ }
  return null
}

export default function Gate({ children }) {
  const [cfg, setCfg] = useState(undefined) // undefined = detecting, null = legacy, {url,anonKey} = supabase
  const [ok, setOk] = useState(false)
  const [realData, setRealData] = useState(null)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const stopRefresh = useRef(null)

  const baseUrl = import.meta.env.BASE_URL

  useEffect(() => {
    let on = true
    detectSupabase(baseUrl).then((c) => { if (on) setCfg(c) })
    return () => {
      on = false
      stopRefresh.current?.()
    }
  }, [baseUrl])

  if (ok) return <RealDataContext.Provider value={realData}>{children}</RealDataContext.Provider>

  const supa = cfg != null

  const submit = async (e) => {
    e.preventDefault()
    if (!pw || busy || cfg === undefined) return
    setBusy(true)
    setErr('')
    try {
      if (supa) {
        // Real login: Supabase email/password → JWT; the server re-verifies the
        // token + allowlist on every /api/* call.
        const session = await signInWithPassword(cfg, email.trim(), pw)
        setSessionToken(session.access_token)
        stopRefresh.current = startAutoRefresh(cfg, session, setSessionToken)
        const data = await loadRealData({ token: session.access_token }, baseUrl)
        setRealData(data)
        setOk(true)
      } else {
        // Legacy shared password.
        const match = (await sha256Hex(pw)) === PW_HASH
        if (!match) throw new Error('Incorrect password — try again.')
        const data = await loadRealData({ password: pw }, baseUrl).catch(() => null)
        setSessionPassword(pw) // memory-only; authed API calls (deals chat) reuse it
        setRealData(data)
        setOk(true)
      }
    } catch (ex) {
      setErr(ex?.message || 'Sign-in failed.')
      setPw('')
    } finally {
      setBusy(false)
    }
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
        <div style={css('font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.5;')}>
          {cfg === undefined ? 'Checking sign-in method…' : supa ? 'Sign in with your account to continue.' : 'Enter the access password to continue.'}
        </div>

        {supa && (
          <input
            type="email"
            autoFocus
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErr('') }}
            aria-label="Email"
            autoComplete="email"
            placeholder="Email"
            style={css('height:42px;margin-bottom:10px;padding:0 13px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--text);font-size:14px;outline:none;')}
          />
        )}

        <input
          type="password"
          autoFocus={!supa}
          value={pw}
          onChange={(e) => { setPw(e.target.value); setErr('') }}
          aria-label={supa ? 'Password' : 'Access password'}
          aria-invalid={!!err}
          autoComplete="current-password"
          placeholder="Password"
          style={css(`height:42px;padding:0 13px;background:var(--surface2);border:1px solid ${err ? 'var(--red)' : 'var(--border2)'};border-radius:9px;color:var(--text);font-size:14px;outline:none;`)}
        />
        {err && <div role="alert" style={css('margin-top:9px;font-size:12px;color:var(--red);')}>{err}</div>}

        <button type="submit" disabled={busy || !pw || cfg === undefined || (supa && !email)} style={css(`margin-top:16px;height:42px;border:none;border-radius:9px;background:var(--accent);color:#06120F;font-weight:600;font-size:13.5px;cursor:${busy || !pw ? 'default' : 'pointer'};opacity:${busy || !pw ? '.6' : '1'};`)}>
          {busy ? (supa ? 'Signing in…' : 'Decrypting…') : supa ? 'Sign in' : 'Unlock'}
        </button>

        <div style={css('margin-top:18px;display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--text3);')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:var(--text3);')} />
          Internal tool · holds owner/broker data · do not share
        </div>
      </form>
    </div>
  )
}
