# Project health audit — 2026-06-18

A scan of the whole repo for **problems and improvement opportunities**, taken now that
the project has grown to 6 markets / ~9.5k lines of Python / 80 tests. This is a
**documentation-only** pass — nothing here has been changed. Findings are evidence-backed
(file:line) and prioritised so they can be picked off one at a time.

> How to read this: each finding has a severity, the concrete evidence, and a one-line
> *suggested direction* (not a prescription). The "Top priorities" list is the short version;
> the themed sections are the full list. A "What's already healthy" section at the end keeps
> this honest — the project is in good shape; this is a backlog, not an alarm.

---

## Top priorities (if you only fix five things)

1. **Cross-market ranking is misleading by construction** (§A1). The single dashboard ranks
   all 6 cities in **one combined leaderboard** by raw score, but data-poor markets
   structurally can't earn the same points. A good Charleston warehouse will lose to a
   mediocre Nashville one because Charleston has no distress/year/tax feeds — not because it's
   a worse deal.
2. **The exact silent-failure the test suite is meant to prevent is untested** (§B1, §B2). A
   market that gates down to **0 universe rows** passes `make test` green and just disappears
   from the dashboard — the "0 rows" check is a `print`, not an assertion.
3. **Front-door docs are frozen at "Day 2"** (§F1). `CLAUDE.md` / `README.md` / `RUNBOOK.md`
   describe a 2-commit, 40-test, single-market Nashville project. Reality is 6 markets, 80
   tests, ~19 commits, a live Vercel dashboard. A new agent trusting the front door starts ~2
   weeks behind.
4. **Six forked ingest scripts with no shared base** (§C1). A date-parse or paging bug must be
   fixed in 6–10 near-identical files. This is the biggest scaling tax as markets are added.
5. **A known-miscalibrated scoring weight is still live** (§A3) and the dialer has **no spend
   cap / rate limit** before a real vendor is wired (§D1). Both are small fixes with outsized
   downside if missed.

---

## A. Correctness & scoring

### A1. Combined cross-market ranking penalises data-poor markets — **HIGH**
`tools/make_dashboard.py:202` sorts **every city into one list** by raw score
(`all_rows.sort(key=… -score …)`) and `:352` assigns a single global `rank`. But the scoring
engine treats a **missing signal as 0, not neutral**: `scoring/rules.py` returns `0` for
absent tax data (`:110-111 no_trustee_file`), absent distance (`:122-123`), absent year/hold/
vacancy. So a market missing whole feeds can't compete:
- Charleston: no distress feed, no `year_built`, no tax loader (`markets/charleston.yaml`).
- Hamilton / Columbus: `year_built` is NULL for many rows.
- Charlotte: assessed values unreliable; no tax-delinquency feed.

Net effect: ~20–60 of the 100 points are **unreachable** in some markets, so those cities sink
in the blended leaderboard regardless of property quality.
**Direction:** either (a) make the City filter the default view rather than a blended global
rank, or (b) normalise each parcel's total against the *achievable* max for its market, and
surface "scored out of N possible points" in the UI.
**FIXED 2026-06-24 (variant of b, refined):** shared `tools/ranking.py` computes a per-market
reachable **ceiling** (sum of the weights of components that earn points in that market) and the
unified leaderboard now ranks by a **blended** `score/√ceiling` metric — wired into BOTH
`make_dashboard.py` and `make_map.py`. Pure normalisation (rank by `score/ceiling`) was tried first
but over-corrected on real data — it flooded the top-12 with Charleston's soft-signal parcels (ceiling
30, all-`owner/hold/proximity`, no distress) ahead of Nashville's distressed ones; the blend keeps
data-rich distressed parcels on top while resurfacing the best feed-poor leads fairly (Charleston top
parcel #149→#7). Each parcel is coloured/scored against its own market's ceiling; "% fit" + "of N
reachable in <city>" shown in the UI. Frozen by `tests/test_ranking.py`.

### A2. "Missing = 0" vs "missing = neutral" is applied inconsistently — **MED**
Most scorers zero-out missing data (§A1), but `is_out_of_state` *nullifies* instead:
`transform/normalize.py:64` returns `None` when state/home is unknown and `scoring/score.py:125`
coerces `bool(None)=False`, so the owner-profile rule simply doesn't fire (neutral). That's the
*better* behaviour — but the asymmetry with §A1 is undocumented and easy to trip over.
**Direction:** pick one convention, document it in `rules.py`, and note deliberate exceptions.
**FIXED 2026-06-24:** the convention (missing signal → 0; the `is_out_of_state` None → neutral
exception) is now documented in the `scoring/rules.py` module docstring.

### A3. `no_permits_10yr_pre1985` weight assumes a 10-yr feed that's really ~3 yr — **MED**
`weights.yaml:105` scores `no_permits_10yr_pre1985: 3`, and the comment at `:102` literally says
"no permits in 10+ years." But the permits feed only reaches ~3 years back
(`ingest/pull_permits.py:20`, and CLAUDE.md flags this as the top open risk). The signal can
fire simply because the feed doesn't reach far enough, so the 3 points overstate weak evidence.
**Direction:** discount the weight, or gate the signal on confirmed feed depth.

### A4. ~60 "dormant" scoring points have weight but no live data — **MED**
Components that carry weight but cannot fire today:
`vacancy_evidence` (22) + `physical_fit` (12) + `truck_access_inverse` (4) = 38 pts behind the
**un-built VLM** (`imagery/` stubs); `permit_lapsed_or_expired` is hardcoded `False`
(`scoring/score.py:127`); `year_built_band` (5) and `tax_delinquency` (15) are dead in markets
lacking those feeds. ≈58–63 pts of the 100-pt scale are inert depending on market. This makes
scores hard to interpret and compounds §A1.
**Direction:** show "live vs dormant" point budget per market in the dashboard; treat the VLM
and tax loaders as the highest-leverage data work.
**DASHBOARD PART ADDRESSED 2026-06-24** (by the §A1 work): the dashboard + map now show, per
parcel, "X of N reachable in <city>" and list the dormant components ("Locked until imagery + tax
land: …"), judged against each market's live ceiling. The remaining A4 substance — those points
stay dormant until the API-key VLM + tax loaders are wired — is data-acquisition work, not display.

### A5. Scoring *thresholds* are hardcoded even though *weights* aren't — **MED**
CLAUDE.md says "no weight is hardcoded." True for point **values**, but every band **boundary**
is a literal in `scoring/rules.py`: proximity miles `<3/<5/<7/<=10` (`:124-131`), year bands
`1955/1985/1986/2000`, hold `>=20/>=10`, `docks>=4`, violations `>=2`. A founder editing
`weights.yaml` can't move a boundary.
**Direction:** lift breakpoints into `weights.yaml`, or soften the claim to "point values are
not hardcoded."

---

## B. Test coverage gaps

### B1. Per-market gating is untested — **HIGH**
`transform/build_universe.py` (`apply_gates`, `apply_spatial`, the staleness cutoff) has **zero
tests**. `tests/test_market.py` only reads config. Nothing exercises gating against any
non-Nashville market. The 15 scoring tests are all synthetic facts on Nashville config.
**Direction:** add a parameterised test that runs the gate logic against each market's YAML with
representative fixtures.

### B2. No test catches a market silently producing 0 universe rows — **HIGH**
`build_universe.py:164` *prints* a warning when universe ∉ [150,1200] but never asserts or exits
(verified). A market that yields 0 rows passes the suite and vanishes from the dashboard — the
precise failure mode `docs/TEST_ARCHITECTURE.md` was written to stop.
**Direction:** turn the range check into a non-zero exit (or a DB-backed invariant test), and
add a Stop-hook / CI gate per the test-architecture design.

### B3. Dashboard ↔ map parity is a manual rule with no enforcement — **MED**
The standing rule "every filter goes in BOTH `make_dashboard.py` and `make_map.py`" is pure
discipline — no test compares them. `make_dashboard.py` (618 lines) and `make_map.py` (558) carry
duplicated filter logic (`minsf/maxsf/maxch/minhold/minyr/maxyr/maxacq`) and a duplicated
`tier()` / bulk-sale detector. Drift is invisible until a user sees the table and map disagree.
**Direction:** extract the shared filter/tier logic into one module both import; add a test that
diffs the filter/column sets.

### B4. Per-market ingest scripts are essentially untested — **MED**
Only `_owner_name` (Charlotte) and Columbus CAMA coercion are covered. The six
`pull_parcels_*` / four `pull_distress_*` SQL promote paths have no tests.
**Direction:** test the pure helpers (`_coerce_ms`, `_ms_to_date`, owner parsing) once they're
de-duplicated (§C1), and add a smoke test per promote path against a fixture DB.

### B5. `docs/TEST_ARCHITECTURE.md` status is itself stale — **LOW**
It marks the Layer-2 market-contract test "NOT BUILT," but `tests/test_market.py` already
implements a parameterised contract test. CI (`.github/workflows/refresh.yml`) only runs tests
when `DATABASE_URL` is set, so there's no ungated hermetic tier yet.
**Direction:** update the status table; add an ungated `make test-fast` CI job. (Also tracked in
the existing `test-architecture-todo` memory.)

---

## C. Code duplication & maintainability

### C1. Six forked ingest scripts, no shared base — **HIGH**
`ingest/pull_parcels{,_columbus,_charlotte,_hamilton,_cuyahoga,_charleston}.py` each re-declare
the same `STAGING_PARCEL_COLS` / `STAGING_PARCEL_TMPL` constants and their own copy of
`_coerce_ms()`; the four `pull_distress_*.py` each re-declare `_ms_to_date()`. ~240 lines of
copy-pasted boilerplate; a single date/timezone/paging bug needs 6–10 coordinated edits with no
shared test to keep them honest.
**Direction:** extract `lib/ingest_base.py` (shared coercers, staging constants, a parameterised
`promote()` taking market field-mappings); each market file becomes a thin config + handler.
**COERCERS EXTRACTED 2026-06-24:** the 6 `_coerce_ms` + 4 `_ms_to_date` copies were proven
BEHAVIOURALLY IDENTICAL across an input battery (the md5 differences were only a docstring and
whether `datetime` was imported inside the function — NOT a real drift; this corrects an earlier
note here). They now live in `lib/ingest_base.py`; every market module imports them, and
`tests/test_ingest_base.py` locks each module to the shared impl so a copy can't silently diverge.
**STILL OPEN:** `STAGING_PARCEL_COLS`/`STAGING_PARCEL_TMPL` and the `promote()` SQL carry real
per-market differences and are DB-bound — that part needs the dev Postgres (or recorded fixtures).

### C2. `make_dashboard.py` / `make_map.py` duplicate ~filter + render logic — **MED**
See §B3. Beyond the parity risk, this is 1,176 lines where ~half is mirrored. The two have
already drifted (the map has year-built / acquisition-year filters the table lacks).
**Direction:** shared `tools/render_common.py` for SQL CTEs, `tier()`, the deal counter, and the
JS filter spec.

### C3. Six near-identical `promote()` SQL bodies — **LOW**
Each `pull_parcels_*` re-implements the parcels+properties INSERT + geom repair
(`ST_MakeValid`/`ST_CollectionExtract`) with small per-market variations. A geom-repair fix
touches 6 files.
**Direction:** parameterise once the §C1 base exists.

---

## D. Robustness & safety

### D1. AI dialer has no rate limit / spend cap — **MED** (latent until a real vendor is wired)
The safety posture is otherwise good: dry-run is the true default (`outreach/place_calls.py:162`),
the default provider is a no-network `stub` (`outreach/call_provider.py:166`), DNC/`do_not_contact`/
already-reached are all enforced. But there is **no inter-call delay, no per-run hard cap beyond
`--top` (default 25) / optional `--max`, and no dollar ceiling**. `--grade A --max 5000 --commit`
against a live vendor would dial in a tight loop. And `--allow-unscrubbed` only *warns* before
dialing un-DNC'd numbers (`:222-224`) — the one override with real TCPA exposure.
**Direction:** require a mandatory per-run cap + min inter-call delay, and make `--allow-unscrubbed`
demand a second explicit confirmation, **before** registering any non-stub provider.
**FIXED 2026-06-24:** `outreach/place_calls.preflight_guard` (pure, tested) refuses a COMMITTED
non-stub run that (a) exceeds a 100-call cap without an explicit `--max`, or (b) uses
`--allow-unscrubbed` without the second `--yes-dial-unscrubbed` confirmation; plus a `--min-delay`
(default 6 s) inter-call rate limit on real vendors. Dry-run / stub runs are never gated.
`tests/test_place_calls.py`.

### D2. `pull_parcels` fetch→promote spans multiple independent transactions — **MED**
`fetch_parcels` / `fetch_cama` / `promote` run in separate `with cursor()` blocks
(`ingest/pull_parcels.py:87,111,126`), each committing on its own. A crash between
`TRUNCATE staging_building_chars` and its reinsert, or mid-`promote`, leaves
`parcels`/`properties`/`staging` mutually inconsistent. JobRun records `failed`, but the DB is
already half-mutated.
**Direction:** wrap fetch→promote in one transaction, or stage into temp tables and swap atomically.

### D3. Partial ArcGIS pulls look like success — **LOW/MED**
A pull that stops early (paging `exceededTransferLimit` heuristic, `lib/arcgis.py:84-88`) returns
fewer rows but no error; because promote is `ON CONFLICT DO UPDATE` with no "rows that vanished"
handling, stale parcels are never removed and a short pull silently shrinks coverage. Only a
*zero*-row pull aborts (`pull_parcels.py:204-205`).
**Direction:** compare pulled count to `arcgis.count()` and warn/abort on a material shortfall.

> Idempotency is sound: staging tables `TRUNCATE`+reinsert, promotes are `ON CONFLICT DO UPDATE`,
> permit anomalies `DELETE` their own type before reinsert. Re-running `make refresh` does **not**
> double-load. (Verified.)

---

## E. Secrets & PII

**No hardcoded secrets in source (verified).** Every key is read from `.env`/env vars; the rotated
dashboard password is deliberately kept out of git. `.gitignore` is thorough (`.env`, `exports/`,
`imports/*delinquent*.csv`, `Leads.xlsx`, `image_cache/`, `private/`, `*.private.*`). No real
PII or `.env` ever entered git history.

### E1. Minor PII/hygiene notes — **LOW**
- `Leads_Template.xlsx` is tracked — inspected and confirmed **headers/data-dictionary only, no
  rows**. Matches its gitignore comment. No action needed; logged for completeness.
- `CLAUDE.md:41` commits the local trust-auth DB string (`postgresql://razkorteran@localhost…`,
  no password) — local-only, low risk, but it's a real connection convention in a tracked doc.

---

## F. Documentation & repo hygiene

### F1. Front-door docs are frozen at "Day 2" — **HIGH**
`CLAUDE.md` and `README.md`/`RUNBOOK.md` describe a single-market, 212-parcel, "40 tests, 2
commits, end of Day 2" project. Reality: 6 markets, 80 tests, ~19 commits, a live Vercel
dashboard, outreach + Pipedrive built. Specific stale lines:
- CLAUDE.md "40 tests" / "212-parcel universe" / "end of working Day 2" / "2 commits on master".
- README/RUNBOOK repeat the 40-test / Day-1 framing.
- `docs/TOOLS_REGISTRY.md` header "Last verified 2026-06-16" predates Cuyahoga + Charleston.
- CLAUDE.md still lists outreach/skip-trace/Airtable as "blocked" though contact enrichment is
  live (886 contacts) and Pipedrive sync is built — only the VLM and a real skip-trace account
  remain truly blocked.
**Direction:** make `docs/BUILD_LOG.md` (most recent §) the single source of truth for "current
status," and have CLAUDE.md point to it instead of restating a frozen snapshot.

### F2. No single source of truth for "what's running now" — **MED**
Competing status narratives live in CLAUDE.md (stale), README (stale), BUILD_LOG (current),
`docs/DAILY_SUMMARY.md` (stops at Charlotte), and **8** root-level `SESSION_HANDOFF_*.md` files.
A new agent has to reconcile them.
**Direction:** keep one canonical status doc; move session handoffs into a `handoff/archive/`
folder so the root stops accumulating them.

### F3. A second full project copy is committed under `handoff/` — **MED**
`handoff/nashville-sourcing-handoff/` is tracked (18 files) and contains its **own**
`weights.yaml`, `Makefile`, `db/001_schema.sql`, `ENGINEER_BRIEF.md`. There's also an untracked
top-level `nashville-sourcing-handoff/` directory and a `*.zip`. Real hazard: someone edits the
*wrong* `weights.yaml` or schema.
**Direction:** delete the committed legacy copy (it's the original handoff bundle, preserved in
git history regardless), or move it to a clearly-marked `archive/` that's obviously not live.

### F4. Repo-root clutter — **LOW**
8 `SESSION_HANDOFF_*.md`, `Leads.xlsx`/`Leads_Template.xlsx`, two handoff dirs, a zip, and a
tracked-elsewhere `.DS_Store` make the root noisy for a newcomer.
**Direction:** a `docs/handoffs/` + `archive/` sweep; confirm `.DS_Store` is ignored everywhere.

---

## What's already healthy (so this stays honest)

- **80 tests pass in 0.3s** — the scoring engine is pure and well-covered for Nashville; gate
  boundaries and the component-sum invariant are tested.
- **Config-driven multi-market design is clean** — `lib/market.py` validates each market YAML and
  fails loudly on a malformed file; market specifics live in YAML, not Python.
- **No hardcoded secrets; thorough `.gitignore`; no PII in git history.** (Verified.)
- **Dialer safety defaults are genuinely good** — dry-run + stub provider mean today it places
  zero real calls even with `--commit`; DNC/do-not-contact/already-reached are all enforced.
- **Ingest is idempotent** — re-running never double-loads.
- **ArcGIS client retries with backoff** and correctly treats HTTP-200-with-error bodies as
  retryable; `lib/db.py` rolls back on exception and aborts a stage past a 20% failure rate.

---

## Quick-reference table

| # | Finding | Sev | Evidence |
|---|---------|-----|----------|
| A1 | Combined ranking penalises data-poor markets | HIGH | make_dashboard.py:202,352 · rules.py:110,122 |
| A2 | Missing=0 vs missing=neutral inconsistent | MED | normalize.py:64 · score.py:125 |
| A3 | `no_permits_10yr` weight assumes 10yr feed (~3yr real) | MED | weights.yaml:105 · pull_permits.py:20 |
| A4 | ~58–63 dormant scoring points | MED | imagery/ stubs · score.py:127 |
| A5 | Scoring thresholds hardcoded | MED | rules.py:124-131 |
| B1 | Per-market gating untested | HIGH | build_universe.py (no test) |
| B2 | No test catches 0-universe market | HIGH | build_universe.py:164 |
| B3 | Dashboard↔map parity unenforced | MED | make_dashboard.py / make_map.py |
| B4 | Per-market ingest untested | MED | ingest/pull_*_*.py |
| B5 | TEST_ARCHITECTURE.md status stale | LOW | test_market.py exists |
| C1 | Six forked ingest scripts | HIGH | ingest/pull_parcels_*.py |
| C2 | Dashboard/map logic duplicated | MED | make_dashboard.py / make_map.py |
| C3 | Six near-identical promote() bodies | LOW | pull_parcels_*.py |
| D1 | Dialer: no rate limit / spend cap | MED | place_calls.py:215-224 |
| D2 | Multi-txn fetch→promote not atomic | MED | pull_parcels.py:87,111,126 |
| D3 | Partial ArcGIS pull looks like success | LOW/MED | arcgis.py:84-88 |
| E1 | Tracked template / committed DB string | LOW | Leads_Template.xlsx · CLAUDE.md:41 |
| F1 | Front-door docs frozen at "Day 2" | HIGH | CLAUDE.md · README.md · RUNBOOK.md |
| F2 | No single source of truth for status | MED | 8× SESSION_HANDOFF_*.md |
| F3 | Second full project copy committed | MED | handoff/nashville-sourcing-handoff/ |
| F4 | Repo-root clutter | LOW | repo root |

---
*Produced by a read-only scan on 2026-06-18. No code or config was changed. Line numbers are as
of this date; re-verify before acting on a specific cite.*
