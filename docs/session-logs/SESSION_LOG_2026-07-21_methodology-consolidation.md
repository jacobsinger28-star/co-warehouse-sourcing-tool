# Session Log — 2026-07-21 — Methodology consolidation from the sibling repo

Started from standing handoff **item 5**: *"move anything related to this project
from off-market-operating-system to here."* Ran on branch `feat/multitenant-byok`
alongside a concurrent session that owned the multi-tenant/BYOK work (see below).
Commit `f69a571`.

## The ask, scoped

"Move anything related" collides with a hard invariant: the sibling scraper repo
(`../off-market-operating-system`) has **no git remote by design** — its
`runs/*/stage1_find*.csv` kept-lists carry `owner_of_record` + `owner_mailing_address`
(**owner PII**), and the SimiCap data policy keeps that off GitHub. This console repo
**does** have a public GitHub remote and auto-deploys. So a literal "move everything"
would publish PII.

Asked the user to scope it. Answer: *"if it is the [licensed] company's property and
we can get sued for, don't do it; whatever else that is relevant and important, do it."*
→ move the clean methodology, leave anything with PII / licensed-data / lawsuit exposure.

## What moved → `docs/methodology/` (commit `f69a571`)

The **Off-Market Operating System** playbook, copied byte-identical from the sibling root:
- `00-start-here.md` … `09-from-list-to-deals.md` — Find→Score→Resolve→Reach engine,
  signal library, scoring model, owner resolution, outreach templates (kit attributed
  to **NextAutomation**, nextautomation.us).
- `README.txt` — the kit's own index.
- `deal-box-simicapital.md` — SimiCapital's mandate (asset class / geo / owner profile);
  the scraper reads this as its filter spec.
- `README.md` — new provenance note (what came from where, and what was excluded).

**Verified clean before commit:** PII sweep found only schema column-headers and
`{merge_slot}` placeholders; the only "licensed" strings are the kit *advising* when
to route to a licensed parcel-data provider (`05-county-data-and-the-law.md`), not
reproducing any. The kit's own README states all examples use synthetic demo data.

## What deliberately did NOT move (stays in the sibling, off GitHub)

- `runs/*/stage1_find*.csv` — Stage-1 kept-lists with **owner PII**. The console reads
  these live from the scraper's token-gated `/results`; its fallback still points at the
  sibling path (`tools/stage1_offmarket.py` `RUNS_GLOB`).
- `runs/*/raw/*` — ~35M raw county pulls.
- `service/` — the Off-Market OS scraper itself (separate Railway app; deploys via
  `railway up`, never git) and `service/.results-token.local` (deploy secret).

## Copied, not hard-moved

`service/dealbox.py` and `service/README.md` cite `deal-box-simicapital.md` +
`03-the-four-stage-engine.md` as the scraper's spec, and the sibling is the
this-laptop-only PII vault. Deleting the originals would dangle those references and
strip that repo of its own methodology, so the sibling keeps its copies. `deal-box-simicapital.md`
now lives in two places — treat the scraper's copy as source-of-truth for the buy-box.

## Close-out state (the "document" ritual)

- **Committed + pushed** by the concurrent session before this ran: `5f129f6`
  (Properties email composer + drag-to-reorder columns) and `daf5ead` (multi-tenant/BYOK
  Phase 0 — `db.mjs`, `tenants.mjs`, `seed_tenant.mjs`, `supabase/migrations/0001_tenants.sql`,
  server wiring). Tenant unit tests green (8/8). `feat/multitenant-byok` is up to date with origin.
- **This session** added `f69a571` (methodology docs) + this log, pushed to
  `origin/feat/multitenant-byok`. **Not on `main`** — it rides the feature branch until it merges.

## Open / follow-ups (flagged, NOT auto-done)

- **Merge `feat/multitenant-byok` → `main`?** That auto-deploys to production. It's
  mid-development (Phase 0 of a multi-phase BYOK effort, designed as a no-op until
  `SUPABASE_SERVICE_ROLE_KEY` is set) and is being managed as a pushed feature branch.
  Held for explicit go-ahead rather than deploying it as a side effect of "document."
- **`phoneburner-integration`** — stale/superseded: 3 commits behind ~10 newer `main`
  commits, and `main` already has `phoneburner.mjs` (server imports it). Has unmerged
  commits, so `git branch -d` would refuse. Not merged, not deleted — flagged for a
  decision (likely safe to `-D` if its work is confirmed superseded).
- **`feat/pipedrive-writes`** — a worktree at `/private/tmp/pd-writes` sitting exactly at
  `main` (no commits ahead). Left untouched.
- **Standing handoff items 1–4** (set `RESULTS_TOKEN`, deploy the scraper, rebuild the
  console, verify Wake=164) remain pending explicit go-ahead — untouched this session.
