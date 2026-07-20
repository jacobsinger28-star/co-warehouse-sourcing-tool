import { useEffect, useRef, useState } from 'react'
import { css } from './css.js'
import { loadRealData } from './crypto.js'
import { RealDataContext } from './RealDataContext.js'
import {
  clearSaved, loadRefreshToken, loadSavedPassword, savePassword, saveRefreshToken,
  setSessionPassword, setSessionToken,
} from './session.js'
import { refreshSession, signInWithPassword, signUp, startAutoRefresh } from './supabaseAuth.js'

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
// A successful unlock persists a "keep me signed in" credential in localStorage
// (Supabase: the refresh token; legacy: the shared password — see session.js),
// and page load silently restores it, so a refresh does NOT re-prompt. The
// account menu's Sign out clears it.
const PW_HASH = 'be55c493fa78734fbcd06ec54d500cf21f6ef25edfca096f00776b45265513f5'

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Resolve the auth mode: a Supabase {url, anonKey, allowedDomains?} config, or
// null → legacy. VITE env vars (local dev) take precedence for url/key, but we
// still ask the server for allowedDomains so the signup hint works everywhere.
async function detectSupabase(baseUrl) {
  let server = null
  try {
    const r = await fetch(`${baseUrl}api/config`, { cache: 'no-store' })
    if (r.ok) server = (await r.json())?.supabase ?? null
  } catch { /* static host, no backend */ }
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (url && anonKey) return { url, anonKey, allowedDomains: server?.allowedDomains }
  return server
}

export default function Gate({ children }) {
  const [cfg, setCfg] = useState(undefined) // undefined = detecting, null = legacy, {url,anonKey} = supabase
  const [ok, setOk] = useState(false)
  const [realData, setRealData] = useState(null)
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' (supabase only)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [fullName, setFullName] = useState('')
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const stopRefresh = useRef(null)

  const baseUrl = import.meta.env.BASE_URL

  useEffect(() => {
    let on = true
    ;(async () => {
      const c = await detectSupabase(baseUrl)
      if (!on) return
      // Silent restore from a previous visit — keeps the form hidden (cfg stays
      // undefined → "Checking sign-in method…") until we know it failed.
      try {
        if (c) {
          const rt = loadRefreshToken()
          if (rt) {
            const session = await refreshSession(c, rt)
            if (!on) return
            setCfg(c)
            await enterWithSession(session, c)
            return
          }
        } else {
          const saved = loadSavedPassword()
          if (saved && (await sha256Hex(saved)) === PW_HASH) {
            const data = await loadRealData({ password: saved }, baseUrl).catch(() => null)
            if (!on) return
            setSessionPassword(saved)
            setCfg(c)
            setRealData(data)
            setOk(true)
            return
          }
        }
      } catch {
        clearSaved() // stale/revoked credential — fall through to the form
      }
      if (on) setCfg(c)
    })()
    return () => {
      on = false
      stopRefresh.current?.()
    }
  }, [baseUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  if (ok) return <RealDataContext.Provider value={realData}>{children}</RealDataContext.Provider>

  const supa = cfg != null

  // The registering email's domain isn't on the server's allowlist → the account
  // would sign in but be refused data access. Warn early (soft — exact-email
  // exceptions may exist that the client can't see).
  const domainWarning =
    supa && mode === 'signup' && email.includes('@') && cfg.allowedDomains?.length &&
    !cfg.allowedDomains.includes(email.toLowerCase().slice(email.lastIndexOf('@')))
      ? `Heads up: only ${cfg.allowedDomains.join(', ')} accounts get data access.`
      : ''

  const enterWithSession = async (session, c = cfg) => {
    setSessionToken(session.access_token)
    if (session.refresh_token) saveRefreshToken(session.refresh_token)
    // Supabase rotates refresh tokens — persist each new one or the stored copy
    // goes stale within the hour.
    stopRefresh.current?.()
    stopRefresh.current = startAutoRefresh(c, session, setSessionToken, saveRefreshToken)
    const data = await loadRealData({ token: session.access_token }, baseUrl)
    setRealData(data)
    setOk(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!pw || busy || cfg === undefined) return
    setBusy(true)
    setErr('')
    setNotice('')
    try {
      if (supa && mode === 'signup') {
        // Register. Confirmation email → click link → sign in. If the project
        // ever auto-confirms, we get a session back and can enter directly.
        const res = await signUp(cfg, email.trim(), pw, fullName.trim() || undefined, window.location.origin)
        if (res.access_token) {
          await enterWithSession(res)
        } else {
          setMode('signin')
          setPw('')
          setNotice('Account created — click the confirmation link we emailed you, then sign in.')
        }
      } else if (supa) {
        // Real login: Supabase email/password → JWT; the server re-verifies the
        // token + allowlist on every /api/* call.
        const session = await signInWithPassword(cfg, email.trim(), pw)
        await enterWithSession(session)
      } else {
        // Legacy shared password.
        const match = (await sha256Hex(pw)) === PW_HASH
        if (!match) throw new Error('Incorrect password — try again.')
        const data = await loadRealData({ password: pw }, baseUrl).catch(() => null)
        setSessionPassword(pw) // authed API calls (deals chat) reuse it
        savePassword(pw) // keep signed in across reloads (Sign out clears)
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
          {cfg === undefined ? 'Checking sign-in method…'
            : !supa ? 'Enter the access password to continue.'
            : mode === 'signup' ? 'Create your account to continue.'
            : 'Sign in with your account to continue.'}
        </div>

        {notice && (
          <div role="status" style={css('margin-bottom:12px;padding:10px 12px;border:1px solid var(--border2);border-radius:9px;font-size:12.5px;line-height:1.5;color:var(--accent);background:var(--accent-dim);')}>
            {notice}
          </div>
        )}

        {supa && mode === 'signup' && (
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-label="Full name"
            autoComplete="name"
            placeholder="Full name (optional)"
            style={css('height:42px;margin-bottom:10px;padding:0 13px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--text);font-size:14px;outline:none;')}
          />
        )}

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
        {domainWarning && (
          <div style={css('margin:-4px 0 10px;font-size:11.5px;line-height:1.45;color:var(--amber,#d9a441);')}>{domainWarning}</div>
        )}

        <input
          type="password"
          autoFocus={!supa}
          value={pw}
          onChange={(e) => { setPw(e.target.value); setErr('') }}
          aria-label={supa ? 'Password' : 'Access password'}
          aria-invalid={!!err}
          autoComplete={supa && mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder="Password"
          style={css(`height:42px;padding:0 13px;background:var(--surface2);border:1px solid ${err ? 'var(--red)' : 'var(--border2)'};border-radius:9px;color:var(--text);font-size:14px;outline:none;`)}
        />
        {err && <div role="alert" style={css('margin-top:9px;font-size:12px;color:var(--red);')}>{err}</div>}

        <button type="submit" disabled={busy || !pw || cfg === undefined || (supa && !email)} style={css(`margin-top:16px;height:42px;border:none;border-radius:9px;background:var(--accent);color:#06120F;font-weight:600;font-size:13.5px;cursor:${busy || !pw ? 'default' : 'pointer'};opacity:${busy || !pw ? '.6' : '1'};`)}>
          {busy ? (supa ? (mode === 'signup' ? 'Creating account…' : 'Signing in…') : 'Decrypting…')
            : supa ? (mode === 'signup' ? 'Create account' : 'Sign in') : 'Unlock'}
        </button>

        {supa && (
          <button
            type="button"
            onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setErr(''); setNotice('') }}
            style={css('margin-top:13px;border:none;background:transparent;color:var(--accent);font-size:12.5px;cursor:pointer;')}
          >
            {mode === 'signup' ? '← Back to sign in' : 'New here? Create an account'}
          </button>
        )}

        <div style={css('margin-top:18px;display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--text3);')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:var(--text3);')} />
          Internal tool · holds owner/broker data · do not share
        </div>
      </form>
    </div>
  )
}
