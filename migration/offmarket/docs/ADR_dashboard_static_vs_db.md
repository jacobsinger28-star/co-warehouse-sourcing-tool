# ADR — dashboard stays a static snapshot (not a live-DB web app), for now

Decision record from a 2026-06-21 founder Q&A. Short version: **do not convert the Vercel dashboard into
a live-database-backed app yet — maybe never.** Captured so the next session doesn't relitigate it.

## The question
*"Do I need in the future to transform this [Vercel] snapshot into a real DB?"* — prompted by the
(mistaken) impression that publishing to Vercel implied a cloud SQL server.

## Clarification — there are two separate layers, don't conflate them
1. **The data store** (where the pipeline writes parcels / scores / site_observations) — this is **already
   a real database**: local **Postgres.app** (db `nashville`). CLAUDE.md already names the hosted version
   (**Supabase**) as the planned next step, and the `db/migrations/*` are written **re-runnable** precisely
   so they can be applied there later. So "a real DB" for the *pipeline* is an existing path, not a rebuild.
2. **The published dashboard** (`simi-sourcing.vercel.app`) — this is the **static snapshot**.
   `tools/make_dashboard.py` reads the local Postgres and **bakes the rows into one self-contained HTML
   file** (a DB-free snapshot, ~2 MB today). `make share` stages it; `make deploy` uploads *only that
   static file* to Vercel. **No SQL server runs in the cloud, ever** — the data is frozen at the last
   `make deploy`. (Note: a `git push` to GitHub is NOT a deploy; deploy is the deliberate `make deploy`.)

## Decision
**Keep the dashboard a static snapshot.** It is the correct tool while all of the following hold (they do):
- **Read-mostly** — founder / small team viewing the ranked call queue.
- **Weekly-ish refresh** is acceptable (rebuild = `make share` → `make deploy`).
- **Fits in a file** — ~2 MB now; fine to ~10× the data. File size is not a constraint.
- **Security** — an *encrypted* static file with owner PII (`make lock`) is a far smaller attack surface
  than an internet-facing database full of PII. Going live-DB means owning that risk.

## Triggers that WOULD force a change (revisit when one hits)
1. **Callers logging outcomes that must persist + sync centrally** — the moment a *team* is *writing back*
   call dispositions (not just reading), a static file breaks. **Most likely trigger.**
2. **Always-live data** — "whatever the last rebuild snapshotted" is no longer acceptable.
3. **Auth / per-user views**, or data that genuinely outgrows a single file / needs server-side search.

## Path when a trigger hits (lightest first — both already scaffolded)
- **Caller write-back + multi-user UI without building an app → Airtable.** There's already a
  `sync/airtable_sync.py` stub. For call-tracking this is probably the answer — not a custom web app.
- **Hosting the pipeline's *store* off the laptop** (e.g. GitHub Actions cron writing to the cloud) →
  **Supabase**: point `DATABASE_URL` at it, re-run migrations. Then the dashboard *could* query live.

These are independent decisions: how the dashboard is *served* (static vs live) is separate from where the
*pipeline's data* lives (local Postgres vs Supabase). Don't move both just because one trigger fires.
