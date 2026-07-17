# Session log — 2026-07-17 · Popup/filter parity, stale-deploy diagnosis, repo repair

## What shipped (commits `94c229a`, earlier this session, + close-out commit)

### 1. Map popup parity with the off-market tool (`94c229a`)
- New [frontend/src/components/PropPopup.jsx](../../frontend/src/components/PropPopup.jsx): full old-map popup in the console style — APN, score vs the market's **reachable ceiling** ("Score 31 / 86 · 36% fit"), owner-type/oos/manual-review/SF-mismatch/violation/no-permit chips, labeled facts (Owner, Contact w/ person+role+all phones/emails+confidence, Mailing, Land use, Building total·largest·count, Clear height w/ lidar-roof-est note, Year built, Assessed $·$/SF, Last sale, Sale price w/ non-arm's-length + bulk-sale per-SF suppression, Location), per-component score-breakdown bars + dormant-components note, imagery/VLM site assessment, distress-evidence list, Google search/Maps links.
- `tools/build_real_data.py` now carries the previously-dropped fields: `sfTotal`, `sfLargest`, `clearSrc`, `personRole`, `parcelsInSale`, `sfCheck`, `gate`, `obs`, plus top-level `cityCeil`/`cityLive` (per-market reachable ceilings: Nashville 86, Charlotte 86, Columbus 92, Cleveland 67, Charleston 30). Sigs cap raised 4×90 → 8×220 chars. `data.real.json` + `data.enc.json` regenerated locally.
- Drawer: APN + land use in header, real ceiling instead of `/100`, buildings/largest/clear-src in specs grid.

### 2. Filter parity (`94c229a`)
- Search actually works now (was a dead input): address/owner/broker/firm/APN/market/person/phones/emails, all three inputs wired to one state.
- Added: Min/Max SF, Max mi to core, Min hold yr, Max year built, Held-since ≤ year, Owner location (in/out), Parcels bucket (all / scored universe / 60–75k manual review), Permit-anomaly + Any-distress-signal checkboxes, data-coverage note, active chips for everything.
- Verified vs old site: scored universe = **1835**, manual review = **461** — exact match with simi-sourcing map/dashboard counts.
- Table: added CLR FT / DIST MI / HELD YR columns; marker hover tooltips on the map.
- Not ported (flagged, not built): old dashboard's reviewer-feedback workflow (Good fit/Unsure/Not a target + CSV), per-city stat cards, rank column.

## Deploy diagnosis (why "the popup is still small" / "Railway has no real data")

| Surface | State found | Cause |
|---|---|---|
| `sourcing-console.vercel.app` | OLD bundle `index-CdFppJz7.js` (Jul 1) + old encrypted data | Vercel only updates via manual CLI deploy; git pushes don't touch it |
| Railway (`cowarehouse-sourcing-tool.up.railway.app`) | NEW bundle `index-D3xiOB1y.js` but **sample data only**; `/api/data` → 503 `APP_PASSWORD unset` | Service is GitHub-connected: the push triggered a rebuild; `data.real.json` is gitignored so the Dockerfile baked `{}`, and the rebuild came up without `APP_PASSWORD` |

Key structural fact: **every git push wipes Railway's data** until the GitHub auto-deploy is disconnected or data is moved to a volume (`server.mjs` already supports `DATA_DIR`).

## Repo repair (close-out)
A past `deploy.sh` run had `git init`-ed an **inner repo at `frontend/.git`**, committed, then pulled the monorepo with `--allow-unrelated-histories` — dumping a full copy of the repo inside `frontend/` (`frontend/frontend/`, `frontend/migration/`, …) and leaving conflict markers in `frontend/{.gitignore,README.md,.claude/launch.json}`. Fixed:
- Inner `frontend/.git` moved out (backup in session scratchpad, disposable).
- Conflict-damaged files restored from HEAD; duplicate dirs deleted (all content exists at repo root / origin main).
- `deploy.sh` step 1 rewritten: operates on the **parent monorepo** via `git -C ..`, refuses to `git init`, plain push only.

## Branches
`deals-rag-chat` and `email-to-pipedrive-watcher` were fully merged into `main` → deleted (local + origin). No unmerged branches remain.

## Open items (blocked on user)
1. **Railway restore** — `railway login` (interactive), then `APP_PASSWORD='<gate pw>' bash frontend/deploy.sh` (re-sets the variable + uploads data privately via `railway up`).
2. **Stop the wipe loop** — in Railway dashboard: disconnect the GitHub auto-deploy, or add a volume + set `DATA_DIR` (preferred).
3. **Vercel redeploy** — `cd frontend && vercel build --prod && vercel deploy --prebuilt --prod --scope simi-capital`. CLI authenticated (`raz-4777`); fresh `data.enc.json` ready; `.vercelignore` keeps plaintext out (verified live 404). NOT run — publishing needs explicit go-ahead per standing rule.
4. **Rotate the gate password** — still committed in repo history; standing open item from 2026-07-01.
