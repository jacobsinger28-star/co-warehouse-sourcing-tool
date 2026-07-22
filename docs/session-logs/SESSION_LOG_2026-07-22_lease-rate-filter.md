# Session Log — 2026-07-22 — Lease-rate ($/SF/yr) filter on Properties

Implements Singer feedback item #4 ("Add a lease-rate filter on available
properties?") from `SESSION_LOG_2026-07-22_singer-feedback-triage.md`. We already
pull LoopNet for-lease listings and attach them to properties as `p.lease`, but
the rent lived only as free text in `p.lease.note` — not a filterable number.

## What shipped

**Parse the asking rate → clean number** (this half was also built independently
by the sibling billing session and was already on `main`; identical logic — see
"Reconciliation" below):
- `frontend/leaseRate.mjs`: `parseLeaseRate(note)` extracts `$/SF/YR` from the
  note text — whole dollars (`$19`), cents (`$15.95`), ranges (`$13.25 - $15.00`
  → low/asking floor `13.25`), "from" (`$5+` → `5`); `Price Upon Request` /
  missing → `null`. Anchored to the trailing `SF/YR` so it never grabs an
  unrelated dollar figure. `leaseRepRate(lease)` = **MIN** asking across a
  property's listings (cheapest available space; stable against wide
  multi-tenant bands); `undefined` when nothing states a rate.
- `frontend/test/leaseRate.test.mjs`: 9 unit tests over every real format.
- `frontend/server.mjs`: parse at the overlay merge — the single point `p.lease`
  is attached — emitting `p.lease.rate` (representative min) + per-listing
  `l.rate`. Regen-safe: no generator step needed.

**Filter + surfacing (the net-new part this session added on top):**
- `propertiesShared.js`: `leaseRateMin` / `leaseRateMax` in `EMPTY_FILTERS`.
- `Properties.jsx`: Min/Max lease `$/SF/yr` inputs in the filter rail, active
  chips, and FilterChat key parity. Bounds are **NOT** null-inclusive — a
  property with no parsed rate drops out when a bound is set, passes when both
  are empty (a "lease space at $X" question, per spec).
- Rate surfaced in the For Lease badges (card list + `PropTable.jsx` address
  badge + LEASE column) and prominently in the drawer's lease section, via a new
  `fmtRate` helper in `helpers.js`.

## Verification

- 9 lease-rate unit tests + full suite (50) pass; production build clean.
- Parser validated against all 74 real overlay entries: 46 parse a rate, 0
  implausible, 28 correctly rate-less (Price Upon Request / no rate).
- End-to-end in the browser (ran `server.mjs` + a throwaway local dataset, since
  the `.claude/launch.json` preview runner is broken): **Min lease = 12 narrowed
  "15 → 4 of 15 match"** (rates 19, 15.95, 12, 18); no-rate/no-lease props
  correctly excluded; badges showed `For Lease · $18` / `· $5` and plain
  `For Lease` for the no-rate prop; drawer showed a prominent `$18 /SF/yr
  asking`. Throwaway scaffolding reverted.

## Reconciliation (how this landed)

This session's edits were originally committed on a stale local `main`. At
close-out we found a sibling spawned session (the Stripe-billing session) had
already built and pushed the **backend** leaseRate module: `origin/main`'s
`frontend/leaseRate.mjs`, its test, and the `server.mjs` integration were
**byte-identical** to this session's. Only the **frontend filter UI** (rail
inputs, chips, badge/drawer rate surfacing) was net-new.

To avoid a force-push (which would have destroyed the sibling's pushed commits),
this session's feature commit was cherry-picked onto the current `origin/main`
in an isolated worktree. Git recognized the identical backend files as
already-applied, so the effective change was exactly the 4 net-new frontend
files (Properties.jsx, PropTable.jsx, propertiesShared.js, helpers.js). Tests +
build re-run green, then pushed to `origin/main`.

Did NOT `make deploy` / push owner PII to Vercel (needs explicit go-ahead).
