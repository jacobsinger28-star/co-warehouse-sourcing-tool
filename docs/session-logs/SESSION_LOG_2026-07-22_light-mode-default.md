# Session Log — 2026-07-22 — Light mode as the default theme

Client (Singer) found the dark UI clunky / hard to read. Light mode already existed
and rendered well; the ask was simply to make it the default. Ran on
`claude/clever-dijkstra-0937e2` (worktree), rebased onto `main` and fast-forwarded
to `origin/main`.

## What was done

### Default theme → light, with persistence (`frontend/src/App.jsx`)
- `const [theme, setTheme] = useState('dark')` → lazy initializer defaulting to
  **`'light'`**, reading `localStorage['sc.theme']` first so a stored choice wins.
- Added a `useEffect` that writes `theme` to `localStorage['sc.theme']` on change,
  so a manual toggle now **sticks across reloads** (previously there was no
  persistence — theme reset every load).
- Matches the app's existing device-local, `try/catch`-guarded storage posture
  (`sc.filterUsage.v1`, PropTable column prefs, `session.js`). Key namespace `sc.*`.

Net diff: 1 file, +6/−1.

### What was intentionally NOT changed
- **Gate / DemoGate lock + loading screens** hardcode `data-theme="dark"`
  (`Gate.jsx:170,191,263`, `DemoGate.jsx:23`). Left as-is — these are pre-auth
  splash surfaces, not the app chrome the client was reacting to.
- **`index.css:6`** hardcodes `body { background:#0E1116 }` (dark literal). The app
  root is `height:100vh` and fully covers `<body>`, so it never shows in light mode.
  Noted as a latent cosmetic-only item (would matter only for overscroll backstop);
  not touched to keep the change surgical.
- The two flagged dark-only inline literals (`#06120F` on App.jsx accent buttons,
  `#fff` on `AICaller.jsx:133` dialer button) are **text-on-accent** — they sit on
  the teal `--accent` in either theme, so no light-mode contrast issue. No change.

## Verification (in-app browser)
Preview runner (`preview_start` by launch.json name) still dies with `uv_cwd EPERM`
in this env, and the worktree `frontend/` had no `node_modules`. Workaround:
symlinked the main frontend's `node_modules` into the worktree and launched vite
directly as a Bash background process (`node_modules/.bin/vite --port 3011`), then
drove the in-app browser. Reached `<App>` past the auth Gate via the login-free
demo route `?demo=1` (renders App through DemoGate on sample data).

- Loads in **light** mode: `data-theme="light"`, `sc.theme` persisted `"light"`.
- Toggle flips to **dark** (`data-theme="dark"`, dark bg, persisted `"dark"`) and
  back to light — round-trip confirmed.
- All modules readable in light mode (screenshotted each): Properties **map + table**,
  Reuse Finder, AI Caller, Deals DB, Supply Model. Score/status badges, KPI cards,
  and tables all have good contrast.
- **No console errors.**

## Close-out
- Committed + pushed `claude/clever-dijkstra-0937e2`; rebased onto `main` (linear).
- **`origin/main` fast-forwarded** `f9c9cf2..f59fcdb` (light-mode commit is on remote
  main). NOTE: the local `main` worktree ref could **not** be advanced — the harness
  safety classifier blocked `git merge` in the primary worktree (which also carries
  unrelated uncommitted work). Local `main` is 1 behind `origin/main`; a plain
  `git fetch && git merge --ff-only` on main will sync it.
- **No `make deploy` / no PII push** — not requested, and it's the gated Vercel path.

### Branch inventory (as of this session)
- `claude/clever-dijkstra-0937e2` — **this session; merged to origin/main.** Current
  worktree checkout, so not deleted here (git protects the checked-out branch).
- `claude/busy-pike-69bf49`, `claude/funny-heyrovsky-86d93c` — at `2040143`, **fully
  merged** (ancestors of main, 0 unique commits), but **checked out in other active
  worktrees**. Left in place (git refuses to delete worktree-locked branches; also
  likely concurrent sessions). Not deleted.
- `phoneburner-integration` — **NOT merged, 3 unique commits** (`52750ef` re-wire
  PropTable, `af960cb` session log 07-20, `1c62559` PhoneBurner integration).
  **Flagged, not deleted.**

### Unrelated pre-existing state (not this session's work, untouched)
- The primary `main` worktree has uncommitted changes to `frontend/billing.mjs`,
  `server.mjs`, `helpers.js`, `modules/Properties.jsx`, `modules/Settings.jsx`,
  `modules/propertiesShared.js`, `settingsApi.js`, `test/billing.test.mjs`, plus
  untracked `frontend/leaseRate.mjs` and `frontend/test/leaseRate.test.mjs`. These
  belong to another in-progress effort — not committed or merged here.
