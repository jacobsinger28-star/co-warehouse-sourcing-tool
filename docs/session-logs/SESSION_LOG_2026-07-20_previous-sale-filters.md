# Session Log — 2026-07-20 · Previous-sale filters + the two-session deploy race

*Goal: add previous-sale-data filters to the property database (Properties module), deploy to Railway.*

## What shipped (commit 852f904)

- **`frontend/src/App.jsx`** — four new inputs in the Properties filter rail, directly after the
  hold row, with matching active-filter chips and Clear-all support:
  - **Min / Max sale price ($)** — bounds on the last recorded sale price (`lastPrice`)
  - **Sold since ≥ (year)** — last sale in/after a given year (complements the long-hold
    "Held since ≤" screen)
  - **Max sale $/SF** — basis screen; **skips multi-parcel bulk sales** (`parcelsInSale > 1`),
    same rule PropPopup uses where per-SF is meaningless
- All four are **null-inclusive** like the rest of the rail: rows with no recorded sale pass
  through, so the filters only bite on markets that carry sale data (the live/decrypted dataset;
  the committed sample rows have none).
- Verified locally: vite build clean; ran the app with the Gate temporarily bypassed (reverted) —
  inputs render, state updates, chip appears ("Sale ≤ $5,000,000"), null-inclusive count correct.
  Note: the chips row is `display:none` in map view by pre-existing CSS; chips show in table view.

## The deploy race (post-mortem)

Two Claude sessions were working this repo simultaneously — this one (sale filters) and another
(drawer fix + AI filter chat + legacy import, commit b795e64).

1. This session's `git add -A` swept the other session's in-flight FilterChat files into 852f904
   (no harm — the other session's b795e64 took ownership and documented them properly).
2. Both sessions ran `railway up` within the same minute (13:31–13:32). The overlapping deploys
   superseded each other (REMOVED) and the last one **FAILED healthcheck**, leaving production
   **down** (~15 min, /health timing out).
3. Root cause of the healthcheck failure was **not** the race itself: `server.mjs` imports the new
   `filterChat.mjs`, but the Dockerfile **missed the COPY** → container crashlooped. The other
   session diagnosed it via Railway dashboard, fixed the Dockerfile (d556b33), redeployed → ACTIVE.
4. Verified live afterward: `/health` `{"ok":true}`; deployed bundle contains the sale-filter
   strings ("Sold since", "Max sale $/SF").

**Lesson: one deployer at a time.** When two sessions share this repo, designate a single session
to run `railway up`; the other pushes to GitHub only. Also prefer explicit `git add <files>` over
`add -A` when a sibling session may have WIP in the tree.

## Also

- `off-market-operating-system/.claude/launch.json` added (dev-server preview shortcut pointing at
  this repo's frontend) — committed there by the scraper-service session (ca72a7d).
- This session's `railway up` retry was blocked by the permission classifier; a Bash allow-rule for
  `railway up*` would let Claude deploy directly next time.

## Addendum (second close-out, same day)

- Repo topology clarified: `off-market-operating-system/` is a **directory inside the local-only
  SimiCapital root repo**, not a standalone repo — this session's launch.json commits (ca72a7d
  context, 1ed3365) live there. Root repo has no remote; commits stay local by design.
- A sibling session has since repurposed that launch.json to serve a static `dist/` via
  `python3 -m http.server` (their scratchpad path) — left uncommitted for that session to close.
- Sibling-session WIP left untouched in this repo at close: `App.jsx`, `Gate.jsx`, `session.js`,
  `supabaseAuth.js`, `.claude/launch.json`.
