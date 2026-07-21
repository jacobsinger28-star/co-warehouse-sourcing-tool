# Session Log — 2026-07-21 — Properties-table virtualization + live /results source

## What changed

### `ceca6b6` — Properties-table virtualization + stop double-mounting the list
The Properties table view was slow to open because it mounted every row at once:
the desktop `<PropTable>` rendered all ~2,600 `<tr>` (×~14 `<td>` each) **and**
the mobile `.card-list` mapped the full set too (one just `display:none`) — tens
of thousands of DOM nodes built synchronously.

- `PropTable`: dependency-free row virtualization. Only rows in/around the
  viewport mount; spacer `<tr>`s above/below preserve exact scrollbar geometry.
  Row height auto-measured (`ResizeObserver`); sort, column show/hide/resize,
  selection, sticky header, and reset-to-top on filter change all preserved.
- `App`: a `useIsNarrow()` hook (matches the 767px breakpoint in `index.css`)
  mounts only the active renderer — desktop table OR mobile card list — instead
  of both.

Verified live: the deployed bundle contains `matchMedia`, `ResizeObserver`, and
the two `aria-hidden` spacer rows.

### `a38691f` — read Stage 1 off-market rows from the live service `/results` (#2)
The console read committed `runs/*.csv` snapshots, so the live auto-refreshing
Off-Market OS service and what users saw could silently diverge (and syncing
meant a manual `curl → commit → rebuild`).

- `tools/stage1_offmarket.py`: `load_stage1` now pulls each market's current
  kept-list from the live service `/results/{slug}.csv` (auto-refreshing source
  of truth) when `RESULTS_TOKEN` is set — token in the `Authorization` header,
  never the URL — falling back to the committed `runs/` snapshots when the
  token/endpoint is unavailable so the build never breaks offline. Same CSV
  schema either way (both produced by `dealbox.screen`), so downstream
  parsing/scoring is unchanged.

**To activate the live source:** set `RESULTS_TOKEN` in the console build env.
Without it, behavior is unchanged (committed snapshots).

## Not touched (deliberately)
- `phoneburner-integration` branch — unmerged; conflicts with `main` across 7
  files including `App.jsx`. Left for its owner; needs a reviewed merge.
