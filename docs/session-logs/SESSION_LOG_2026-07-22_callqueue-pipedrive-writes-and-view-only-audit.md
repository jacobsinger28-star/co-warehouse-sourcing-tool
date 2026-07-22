# Session log — 2026-07-22 — Call queue wiring, view-only audit, Pipedrive writes

Three connected pieces of work on the sourcing console, plus a memory correction.
Ran alongside an active parallel session (multitenant/BYOK + email composer + a
"demo mode") — everything below was built in **isolated worktrees** and rebased
onto their merges to avoid clobbering the shared tree.

## 1. "Add to call queue" — wired + DEPLOYED (commit `d39897f`, live)
The property detail-drawer button and the table bulk-bar button were decorative
(no `onClick`); the Power Dialer read a static `CALL_QUEUE` demo array (closing its
own TODO).

- **New `frontend/src/callQueue.js`** — a tiny `localStorage`-backed store with a
  `useSyncExternalStore` hook. Properties added from the map/table land here; the
  dialer reads it as its live staging list. Dedupes by id/address, persists across
  reloads, per-row remove + Clear, no demo seed (starts empty → no phantom counts /
  no fake 555 numbers pushed to PhoneBurner).
- **`App.jsx`** — drawer button toggles add/"✓ In queue"; bulk button adds the
  selection then clears it; live count **badge on the AI Caller nav**.
- **`AICaller.jsx`** — staged column renders the live queue.
- Verified end-to-end in a no-gate preview (add → dialer reflects → bulk → remove →
  reload persists). Deployed to Railway; confirmed `index-CZb-s4ii.js` serving live.

## 2. View-only audit (answer to "what else is just view-only?")
Swept every source file. Non-functional UI found — all **Pipedrive writes**:
1. Bulk-bar **"Send N to Pipedrive"** — no handler.
2. Drawer **"Push owner Lead / broker Deal to Pipedrive"** — no handler.
3. Broker **"Sync to Pipedrive"** — `syncBroker` only flipped a local `synced:true`
   flag (false-success mock).
Root cause: the web backend read Pipedrive (deal book) but had **no write route**.
Everything else (filters, Keep Sourcing, map, drawers, AI Caller, Deals DB) works.

## 3. Pipedrive writes — BUILT + verified, deploy PENDING (branch `feat/pipedrive-writes`, `cc67960`)
Wired all three above to real CRM writes, mirroring the proven Python writer
(`tools/email_to_pipedrive/pipedrive_sync.py`) and reusing `PIPEDRIVE_API_TOKEN`
(Raz's token — full read+write; see the [[pipedrive-key-access]] memory).

- **New `frontend/pipedrive.mjs`** — Node write client: `syncBroker` (upsert Person,
  dedupe email→cell→phone, owned by Raz, firm/markets in a note), `pushLead` (upsert
  the contact Person + create a Deal in **Tracking, stage 33** — override with
  `PIPEDRIVE_SOURCING_STAGE_ID`), `pdStatusInfo`. Idempotent (dedupe by email/phone +
  exact deal title), records tagged with a **`sourcing-console`** label, facts go in
  a human-readable note (no fragile custom-field writes). `dryRun` previews payloads.
- **`frontend/server.mjs`** — `POST /api/pipedrive/{status,broker,lead,leads}`
  (auth-gated, rate-limited). Added to the runtime **Dockerfile COPY list is NOT
  needed** here since server.mjs is copied whole — but note the recurring `.mjs`-copy
  gotcha for any *new* imported module; `pipedrive.mjs` is imported by server.mjs, so
  confirm it lands in the runtime image on deploy.
- **New `frontend/src/pipedrive.js`** — client (mirrors `phoneBurner.js`).
- **`App.jsx`** — real handlers (`syncBroker` async, `pushPropToPd`, `pushSelectionToPd`);
  buttons show busy state + a toast with a link to the created record; when no token
  is configured they **disable with a "set PIPEDRIVE_API_TOKEN" tooltip** (the
  graceful fallback Raz asked for).

**Verification:** dryRun payloads correct; **a real Deal was created (id 197,
Tracking/33) and deleted** straight from the sandbox — Pipedrive API writes are NOT
blocked here. Server booted with the merged multitenant code and `/api/pipedrive/status`
returned configured/owner=Raz/stage=Tracking. Frontend builds; no-gate preview showed
the disable+tooltip fallback (8 chips disabled with the tooltip) with no console errors.

**Concurrency:** the parallel session merged multitenant + email composer to `main`
(`c95ce42`) mid-flight. Rebased `feat/pipedrive-writes` onto it and resolved the two
conflicts (server.mjs imports — kept both; App.jsx — kept the email composer's
`emailProp`/`emailTo`/`closeEmail` **and** my real handlers, dropped the old
`syncBroker` mock). Both features coexist.

## 4. Memory
- **New `pipedrive-key-access`** — authoritative "you HAVE the Pipedrive key
  (read+WRITE), it works from the sandbox, never say a token/backend is needed."
- **Corrected `agent-sandbox-blocks-external-writes`** — its blanket "Pipedrive API
  writes are hard-blocked" claim was wrong this session (create+delete worked); noted
  it's env-dependent and that what's actually gated is `git push` to `main`.

## Open / next
- **DEPLOY PENDING:** merging `feat/pipedrive-writes` → `main` (which auto-deploys
  Railway) is the **classifier-blocked** step. Push it with:
  `git push origin feat/pipedrive-writes:main` (or merge the PR / branch on GitHub).
  Then confirm the live bundle hash changes and click one real Sync/Push to smoke-test
  against production.
- **Env (optional):** set `PIPEDRIVE_SOURCING_STAGE_ID` if leads should land somewhere
  other than Tracking/33.
- Nothing else outstanding; call-queue is fully done and live.
