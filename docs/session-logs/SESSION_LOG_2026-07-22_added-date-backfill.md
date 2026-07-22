# Session Log — 2026-07-22 — ADDED-date backfill for rows without first_seen

Work landed in commit `ea06e36` on `main`.

## The ask

> "for the empty added columns for the existing rows. add july 1st 2026"

A follow-up to the new-listing tracking work (`6e45b7f`, session
`Keep sourcing new items visibility`). This was a fresh session with no
inherited context; the target was reconstructed from that prior session +
the code, then confirmed against the data.

## The problem

The **ADDED** column and the "Added \<date\>" labels (card meta, drawer
header, map popup) all render `p.firstSeen`. Only live-scraped on-market rows
carry a `firstSeen` — it lives in the scrape sidecar's SQLite DB and is
exposed via `/live/rows`. The static export (`data.real.json`, 2,719 props)
and the committed synthetic sample (`PROPS`) have **no** `firstSeen` field at
all, so for every existing/off-market row the ADDED cell read `—` and the
cards showed no Added date. Those were the "empty added columns for the
existing rows."

## What was built

`frontend/src/App.jsx` — in the dataset-merge `useEffect`, existing rows that
lack `firstSeen` are stamped with a backfill constant before the merge:

```js
const ADDED_BACKFILL = '2026-07-01T12:00:00'
const withAdded = (p) => (p.firstSeen ? p : { ...p, firstSeen: ADDED_BACKFILL })
const base = (hasReal ? d.props : PROPS).map(withAdded)
```

Applied at this single chokepoint, every downstream consumer picks it up: the
`PropTable` ADDED cell **and its sort accessor**, the `Properties` card meta,
the drawer header, and the `PropPopup` spec line all now show a real Added
date instead of `—`/blank.

### Two details that mattered

- **Timezone off-by-one.** `fmtDate` appends `Z` (parses as UTC) then formats
  in **local** time. Midnight-UTC `2026-07-01T00:00:00` renders as *Jun 30*
  in every US zone. Using **noon UTC** (`T12:00:00`) keeps the render on
  **Jul 1** across ET → HI. Verified with `TZ=… node` for New York, Chicago,
  Los Angeles, and Honolulu.
- **No behavioral side effects.** Live-scraped rows keep their own
  `firstSeen`. The NEW-badge logic (`tagNew`) only tags the live rows and
  compares `firstSeen >= runStart` (runStart ≈ now), so the backfilled
  `2026-07-01` never badges an existing row as new.

Note: the value is stored as `2026-07-01`; because `fmtDate` hides the year
for current-year dates (today is 2026), it displays as **"Jul 1"** — matching
how live rows show "Jul 22", etc.

## Verification

- `npm test` — 59/59 pass (tenants / phoneburner / leaseRate / billing).
- `vite build` — clean (122 modules).
- Timezone render checked across four US zones (see above).
- Browser verification not possible: the preview runner is broken in this
  environment (`getcwd` EPERM on spawn — known issue).

## Alternatives not taken

The fix is a **display-layer** default, chosen because it survives rebuilds
and also covers the synthetic sample. If the date should instead be baked into
the source data, the options are `tools/build_real_data.py` (stamp `firstSeen`
into the export) and/or the scrape sidecar's `first_seen` backfill in
`frontend/backend/database.py`. Offered to the user as a follow-up.

## Close-out

- Committed (`ea06e36`) + this log; pushed to `origin/main`.
- Branches: my work is directly on `main` (no feature branch). All other
  branches belong to concurrent/other sessions — left untouched and flagged in
  the close-out report (see below), not merged or force-deleted.
- No dev servers were started this session; nothing to kill.
