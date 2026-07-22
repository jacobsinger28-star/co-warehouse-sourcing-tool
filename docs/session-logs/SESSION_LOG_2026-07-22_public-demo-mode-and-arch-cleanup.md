# Session Log — 2026-07-22 — Public demo mode, App.jsx decomposition, architecture cleanup

Branch churned out-of-band during the session (`feat/multitenant-byok` →
`feat/byok-secret-layer` → `feat/byok-phase2`); all work landed in commit
`79cef68`, pushed to `origin/feat/byok-secret-layer`.

## The ask

1. "Plan to add a demo account so I can showcase to potential clients all the
   features of the platform without exposing any real data." → decided design, then
   "work on everything."
2. "Why is App.jsx a big file? … any other architecture problems like this? fix them
   and commit everything."

## 1. Public demo mode (`/demo`)

Design decisions confirmed with the user:
- **Isolation:** gated inside the main app (one deployment), *not* a separate deploy.
- **Access:** a public, no-login link.
- **AI/live behavior:** no Anthropic key is wired, so AI answers are canned; live
  actions are simulated.

The boundary — two parallel surfaces in one server, **no code path from demo → real**:

| | Real surface | Demo surface |
|---|---|---|
| Routes | `/api/data`, `/api/deals*`, `/api/live/*`, `/api/phoneburner/*` | **`/api/demo/*`** (new) |
| Auth | `requireAuth` (unchanged, fail-closed) | **public, no auth** |
| Data | `data.real.json` (real PII) | `demo-data.json` (synthetic) |
| Integrations | PhoneBurner / Pipedrive / scrapers / Anthropic | canned + simulated |

Real routes were **not touched** — they stay fail-closed, and the demo has no
credentials, so it can never reach them.

Implementation:
- `tools/build_demo_data.mjs` — deterministic (seeded PRNG) generator → committed
  `demo-data.json`: 520 props (400 off / 120 on, ~15/35/50 Actionable/Tentative/Pass),
  18 brokers, 42 deals. All fake: `Place + Entity LLC` owners, `(XXX) 555-01xx`
  phones, `@example.com` emails. Shape mirrors `data.real.json` so the same React
  renders it unchanged.
- `demo.mjs` — auth-free Express router mounted at `/api/demo`; serves the synthetic
  data + canned deal search/chat + a scripted `Keep Sourcing` sim + a simulated
  PhoneBurner (status/push/dial/recent). Imports nothing from the real providers.
- Client: `src/demo.js` (detect `/demo`, `apiUrl()` routing), `src/DemoGate.jsx`
  (loads `/api/demo/data`, bypasses the login Gate), `crypto.js` `loadDemoData()`,
  `main.jsx` branch. `liveApi`/`phoneBurner`/`DealsDB` route to `/api/demo/*` in
  demo mode. Top bar shows a "Live demo · synthetic" banner + `DEMO DATA · N` pill.
- Tests: `test/demo.test.mjs`.

## 2. App.jsx decomposition (context)

The Properties screen was extracted from the ~1,137-line `App.jsx` monolith into
`src/modules/Properties.jsx` (~790 lines); App is now a ~360-line shell. Shared
constants in `src/modules/propertiesShared.js`. Behavior-preserving. Further splits
(filter.js, `useDataset`/`useSourcing` hooks, drawer/rail components) are still
deferred pending review.

## 3. Architecture cleanup (from an adversarially-verified audit)

Ran a 4-dimension audit (find → adversarially verify, 18 agents). No other monolith
exists (largest file is the just-extracted `Properties.jsx`), but 12 real, smaller
issues surfaced. Fixed the clean, behavior-preserving ones:
- **Shared authed-POST client** `src/api.js` (`postJson`) — `liveApi`/`phoneBurner`/
  `DealsDB` stopped copy-pasting the fetch+auth+error dance (4 sites → 1).
- **Centralized** `CAT_HEX` + card/KPI tokens + `seg`/`th` builders in `helpers.js`
  (were duplicated/drifted across DealMap/PropPopup/SupplyModel/ReuseFinder).
- **Split real Reuse-sweep data** out of the "synthetic" `data.js` → `src/reuseData.js`
  (honest provenance); fixed the `data.js` header.
- **Removed 9 dead exports** (data.js caller-sample state + `EXAMPLE_QUERIES`,
  helpers `pinStyle`/`MAP_LABELS`, session `getSessionToken`/`getSessionPassword`).

**Deferred (audit-flagged, larger / behavior-touching):**
1. `server.mjs` real-dataset load/persist/merge is module-global mutable state →
   extract a data-store module.
2. Duplicated Pipedrive client across `dealsChat.mjs` + `phoneburner.mjs` → shared client.
3. `PropTable` row virtualizer → `useVirtualRows` hook (internal-only; low reuse today).

## Verification

`npm run build` clean · `npm test` 22 pass · browser click-through of every module
(Properties map + drawer, Brokers, Reuse Finder, Supply Model, Deals DB, AI Caller)
with zero console errors. Commit PII guard clean — only synthetic `demo-data.json`
added; no `data.real.json` / `.env`.

## Close-out status

- **Commit:** `79cef68`, 26 files (+1591 / −1048).
- **Push:** done → `origin/feat/byok-secret-layer` (`5916537..79cef68`).
- **Merge into `main`: BLOCKED — flagged, not forced.** `main` advanced 3 commits
  (`cc67960` Pipedrive CRM writes: +75 lines to `App.jsx`'s sync button, +45 to
  `server.mjs`, new `pipedrive.mjs`/`pipedrive.js`; `71ba981` Dockerfile). This
  branch decomposed `App.jsx` (that sync code moved to `Properties.jsx`) and rewrote
  `server.mjs` regions, so the merge has real conflicts in `App.jsx` + `server.mjs`
  needing manual, semantic resolution — including verifying **demo mode never fires a
  real Pipedrive write**. Not safe to auto-resolve onto shared `main`; recommend a PR
  or a dedicated merge-resolution pass.
- **Branches:** `feat/multitenant-byok` is fully merged into `origin/main` (deletable);
  `feat/byok-secret-layer` / `feat/byok-phase2` hold this unmerged work;
  `phoneburner-integration` has unmerged commits (previously "left as-is"). No branches
  deleted this session, given the blocked merge + active out-of-band branch changes.
- **No deploy run** (owner PII → Vercel needs explicit go-ahead).

## Addendum — merge into `main` completed + regression fixed

The merge into `main` was performed out-of-band (`1970e17` "Merge BYOK secret layer +
public demo into main"), and it **silently reverted `cc67960`'s Pipedrive UI feature**:
the `App.jsx` conflict was resolved by taking the decomposed version, but the Pipedrive
sync/push wiring was never re-applied to `Properties.jsx` — so `pipedrive.mjs`/`pipedrive.js`
+ the `/api/pipedrive/*` routes remained, but every button went decorative again.

Fixed on `main` (follow-up commit):
- Re-applied `cc67960`'s Pipedrive wiring into `Properties.jsx` (import, `pdOk`/`pdBusy`/
  `pdMsg` state, `syncBroker`/`pushPropToPd`/`pushSelectionToPd`, the 5 buttons, the toast).
- Refactored `src/pipedrive.js` onto the shared `postJson` client (consistency + demo routing).
- Added simulated `/api/demo/pipedrive/*` routes to `demo.mjs` so demo mode shows the
  feature working **without any real CRM write** (verified: demo status → `configured:true`,
  demo broker sync → simulated toast; the real `/api/pipedrive/*` stays behind `requireAuth`
  and a demo visitor can't reach it).
- Verified: build clean, 22 tests pass, demo broker-sync toast works, no console errors.

Final trunk state: `origin/main` @ `e11bf76` holds the demo mode + App decomposition +
arch cleanup + the Pipedrive fix, all unified. Branch cleanup: deleted the fully-merged
local `feat/byok-phase2`; `phoneburner-integration` kept (genuinely unmerged — the
PhoneBurner dialer work, deliberately "left as-is"). Remote `origin/feat/byok-secret-layer`
+ `origin/feat/multitenant-byok` are fully merged into main and deletable, but left in
place — remote-branch deletion on the shared repo is left for an explicit go-ahead. No
deploy run.
