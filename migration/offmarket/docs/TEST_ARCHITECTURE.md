# TEST_ARCHITECTURE.md — how this project defends against itself

> Read order for a cold pickup: `CLAUDE.md` → `docs/BUILD_LOG.md` → `DATA_NOTES.md`
> → **this file** (before you touch shared code or add a market). Last updated 2026-06-24.
>
> **Status (2026-06-24): Layers 0–3 are BUILT and green** (161 tests). Layer 0 CI ratchet
> (ungated hermetic job, `.github/workflows/ci.yml`), the `test-fast`/`test-db` split with a
> `db` pytest marker, Layer 2 market-contract test (`tests/test_market_contract.py`), and
> **all of Layer 3** — ledger #1–#6 frozen (tax-tier reachability, `last_seen_at` staleness,
> DNC fail-closed, 0-universe) — landed. Still open: the local Stop hook (awaiting the user's
> OK — it edits `.claude/settings.json`) and **Layer 4** (ephemeral-DB golden snapshot). See §7.

This is a **design spec**, not a description of what exists today. Parts of it are built,
parts are gaps (flagged inline). It exists because the project is now worked by many
independent agent sessions, and **agents keep overriding each other** — a change made for
one market silently breaks another, or quietly re-introduces a bug a prior session already
fixed. The job of the test suite is to make that *impossible to do silently*.

The governing idea: **convert the `BUILD_LOG` bug write-ups (tribal knowledge) into
executable invariants that fail loudly, and make running them non-optional.** A `BUILD_LOG`
paragraph saying "we fixed X" is advisory — the next agent may never read it. A red
`make test-fast` is unambiguous.

---

## 1. Diagnosis — why agents override each other (mechanically)

Not a shortage of tests. Three structural holes:

1. **The ratchet is dead.** CI (`.github/workflows/refresh.yml`) only runs `make test`
   *if the `DATABASE_URL` secret is set* — and it isn't (Supabase unprovisioned). So **CI
   runs zero tests today.** The only enforcement is `make share` depending on `test`, which
   is voluntary and local. Nothing stops a regression from being committed.

2. **The collision surface is shared, market-aware code; the tests are per-feature
   examples.** Six markets (`markets/*.yaml`) all flow through the same ~1,070 lines of
   `transform/normalize.py` + `transform/build_universe.py` + `scoring/score.py` +
   `scoring/rules.py`. A tweak "for Hamilton" changes Charleston too. The current tests
   assert *individual rules*, not *cross-market contracts* or *invariants*, so the break is
   invisible until a human runs that market by hand.

3. **DB tests skip→green.** `test_call_targets`, `test_score_grades`, and the DB half of
   `test_call_provider` call `pytest.skip()` when no Postgres is reachable. In CI, a fresh
   clone, or another agent's machine, they **report green without executing**. "Skip looks
   like pass" gives the next agent false confidence that the grade-direction query is
   covered when it never ran.

What's already right (keep it, generalize it): scoring math is **pure** in
`scoring/rules.py`; `lib/normalize_text.py` is pure; `tests/test_call_targets.py` imports
the **real shipping SQL** (`TARGETS_SQL`, `ROWS_SQL`) instead of a copy and runs it in an
always-rolled-back transaction. That is the correct idiom — the architecture below extends it.

---

## 2. The layered model

Six layers. Each maps to a specific way agents break each other. Runtime budgets are
targets, not measurements.

```
Layer 0  RATCHET        enforcement — CI + a Stop hook                     [CI DONE 2026-06-24 · Stop hook pending user OK]
Layer 1  PURE UNIT      rules.py / parsers — hermetic, ~instant            [HAVE]
Layer 2  MARKET CONTRACT every markets/*.yaml satisfies the schema         [BUILT 2026-06-24 — test_market_contract.py]
Layer 3  INVARIANTS     the BUILD_LOG bugs frozen as market-agnostic props [BUILT 2026-06-24 — ledger #1-#6 all covered]
Layer 4  DB GOLDEN      real ephemeral Postgres + ranked-output snapshot   [GAP — skips today]
Layer 5  MARKET SMOKE   full re-point path vs recorded ArcGIS fixtures     [GAP — optional, slow]
```

### Layer 0 — The ratchet (build first; everything else is decoration without it)

A regression suite only works if it cannot be skipped. Two enforcement points:

- **Fix CI.** Run the **hermetic tier (`make test-fast`) on every push, ungated by any
  secret** — it needs no DB. Add a Postgres **service container** so the DB tier
  (`make test-db`) *actually executes in CI* instead of skipping. The weekly `refresh`
  cron stays as-is; testing must not be coupled to Supabase being provisioned.
- **A Claude Code `Stop` hook** (or a git pre-commit hook) that runs `make test-fast` and
  **blocks on red.** This is the per-session guardrail that stops one agent from leaving
  the tree broken for the next. The project already uses hooks (the document→commit rule),
  so this is consistent. Keep it to the *fast* tier so it never needs a database.

### Layer 1 — Pure unit (HAVE — do not regress)

`scoring/rules.py` (`compute_score`, `evaluate_gates`), `lib/normalize_text.py`, the
parsers (`ingest/import_csv._years_delinquent`, `ingest/pull_cama_columbus`),
`imagery/lidar_height`. Fast, hermetic, no I/O. ~40 tests today. This is the layer the
model already nails.

### Layer 2 — Market contract tests (GAP — single best ROI for multi-market drift)

**One parameterized test** that loads **every** `markets/*.yaml` (via `lib.market`) and
asserts the schema contract — with **zero DB**:

- required top-level keys present (`market`, `db_schema`, `crs`, `home_state`, `sources`,
  `gates`, `land_use`, `fields`);
- `fields.parcels` provides every column the shared `normalize`/`build_universe` code reads
  (apn, owner, mailing addr/state/zip, situs, land-use code) — so an agent that adds a
  market with a missing mapping fails *here*, not three stages downstream;
- `gates` numeric and in sane ranges (`min_building_sf > 0`,
  `manual_review_sf_floor < min_building_sf`, `0 < max_distance_miles < 500`, lat/lon
  plausible);
- `land_use.industrial_codes` non-empty and well-formed;
- `db_schema` **unique across markets** (two markets sharing a schema = silent data
  cross-contamination).

This catches *both* "agent added a market" **and** "agent changed the shared loader and
broke the contract" — for all six markets at once. When a 7th market is added it is covered
automatically. Pair it with a documented schema in `lib/market.py`.

### Layer 3 — Invariant / property tests (PARTIAL — the real anti-drift defense)

Encode the rules the audit bugs *violated*, as **market-agnostic properties** over synthetic
rows — not example cases. Properties beat examples against agent drift because they encode
the *rule*. The canonical set (see the Regression Ledger, §4, for current coverage):

- grade is **monotone** in score (grade-direction bug);
- a parcel that fails a gate **never** appears in any outreach/queue query;
- a phone with `dnc_checked = false` is **never** dialed unless `--allow-unscrubbed`
  (DNC must be **fail-closed**);
- re-scoring **never** silently buries a human-assigned A/B/C grade;
- the `last_seen_at` staleness gate is **actually enforced** (a stale parcel is excluded);
- **every** tax-delinquency tier (`two_plus_years`, `one_year`, `current`) is reachable
  end-to-end — parser output → SQL tier → score component.

### Layer 4 — DB golden snapshot (PARTIAL — and it skips→green today)

A `conftest.py` fixture builds the schema from `db/migrations/00{1,2,3,4}_*.sql` into an
**ephemeral** database, loads a tiny fixture parcel set, runs the **real** scoring +
`TARGETS_SQL`, and asserts a **golden ranked output**. The snapshot catches "a
weights-handling change shifted every score" — which no per-rule unit test sees. In CI this
runs against the service-container Postgres so it **does not skip**. See §5 for the
skip-is-not-green rule.

### Layer 5 — Per-market smoke / e2e (GAP — optional, nightly)

`make <market>` against **recorded** ArcGIS responses (VCR-style JSON fixtures captured
once from the live endpoints) so the full re-point path is exercised without live network or
flakiness. Too slow and too brittle for per-commit; run nightly or pre-release.

---

## 3. Cross-cutting conventions (these make the layers usable)

- **Split the Make target.**
  - `make test-fast` — hermetic (Layers 1–3). **No DB, no network. Always runnable.**
    This is what the ratchet (CI + Stop hook) runs, so it can never silently no-op.
  - `make test-db` — Layers 4–5. Needs Postgres; run locally with the dev server up, and in
    CI against a service container.
  - `make test` — both (the human "run everything" target).
- **Add a `conftest.py`.** Today every DB test re-implements connect→skip→rollback. Move it
  to one fixture: `db_cursor` (connect-or-skip, always rolls back), a `MARKET` param fixture,
  a `fresh_schema` fixture that applies the migrations to a throwaway schema, and a
  fixture-data loader. New DB tests should be ~10 lines.
- **Skip ≠ pass (§5).** Mark every DB test `@pytest.mark.db`. Locally, missing-DB skips are
  fine but must be **visibly counted**, never mistaken for coverage. In CI the marker runs
  for real.
- **Test the SQL that ships.** Import `TARGETS_SQL` / `ROWS_SQL` / the scoring SQL from the
  module — never paste a copy into the test. (`test_call_targets.py` is the reference.)
- **Scoring stays pure.** All scoring math lives in `scoring/rules.py` with no I/O, so it is
  testable without a DB. `scoring/score.py` only feeds it. Do not move math into `score.py`.
- **No hardcoded weights.** Tests load `weights.yaml` via `lib.config` like production does;
  a test must not hardcode a number that lives in the YAML.

---

## 4. The Regression Ledger (the core convention)

**Rule: every bug fixed and written up in `BUILD_LOG` gets a named, permanent test, and the
`BUILD_LOG` entry links to it.** A future agent then cannot re-introduce a logged bug without
going red. This is how `BUILD_LOG` (the human contract) and the test suite (the machine
contract) stay in sync.

Current state of the known audit bugs — **this table is the to-do list for Layer 3/4**:

| # | Bug (from BUILD_LOG / commits) | Frozen by | Status |
|---|--------------------------------|-----------|--------|
| 1 | Grade-direction: entity grade = `max(grade_human)` returned the *worst* letter | `tests/test_call_targets.py` (pure assertion + DB) | ✅ COVERED |
| 2 | Re-scoring silently buried the human A/B/C grade | `tests/test_score_grades.py` (`latest_grades`) | ✅ COVERED — now `@pytest.mark.db` (deselected in `test-fast`, runs for real in `test-db`); CI DB tier pending Layer 4 |
| 3 | "2+ years delinquent" tax tier structurally unreachable | `tests/test_import_tax.py` (parser) + `tests/test_scoring.py::test_tax_delinquency_tiers_all_reachable` (every tier reachable + monotone) | ✅ COVERED 2026-06-24 (hermetic: parser + scoring tiers). NB: the original locus was the SQL universe CTE aggregation — that end-to-end path is a DB-tier/Layer-4 follow-up |
| 4 | `last_seen_at` staleness gate claimed but never enforced | `build_universe.fresh_cutoff`/`is_stale` (extracted PURE) + `tests/test_universe_invariants.py` | ✅ COVERED 2026-06-24 |
| 5 | DNC fail-**open**: unscrubbed numbers could be dialed (`place_calls.py`) | `place_calls.classify_contact` (extracted PURE) + `tests/test_place_calls.py` proves fail-**closed** | ✅ COVERED 2026-06-24 |
| 6 | 0-universe market ships green + vanishes from dashboard (HEALTH_AUDIT §B2) | `tests/test_universe_invariants.py` (pure) + `build_universe.check_universe` now **raises** | ✅ COVERED 2026-06-24 |

When you fix a new bug: add the row, add the test, link both ways. Never close a `BUILD_LOG`
bug entry without a test reference.

---

## 5. Skip-is-not-green (the trap to kill)

Today three test files `pytest.skip()` when no DB is reachable, with no marker. A green run
on a machine without the dev Postgres has **silently executed nothing** in the DB tier —
including the grade-direction and grade-carry-forward guards (bugs #1, #2), the two most
expensive bugs found so far.

Resolution:
- mark DB tests `@pytest.mark.db`;
- `make test-fast` excludes the marker (so green there means "all hermetic checks ran");
- `make test-db` requires the marker and a real DB; in CI it runs against a Postgres service
  container so it **cannot** skip;
- locally, print the skip count loudly so "12 passed, 4 skipped" is never read as full
  coverage.

---

## 6. Checklist — adding a new market (enforced by Layer 2)

When an agent re-points the pipeline at a new county, before committing:

1. `markets/<market>.yaml` exists and **passes the Layer 2 contract test** (`make test-fast`).
2. Its `db_schema` is unique (no collision with an existing market).
3. The shared `normalize` / `build_universe` / `score` code was **not** forked with a
   `if market == "<x>"` branch — market specifics belong in the YAML or in a market-specific
   `ingest/pull_*_<market>.py`, never in the shared downstream stages. (Grep the shared dirs
   for per-market string forks before committing; today there are none in
   `transform/`, `scoring/`, `lib/`.)
4. `make test-fast` is green. If the market has DB rows, `make test-db` golden snapshot
   updated intentionally (a snapshot diff must be reviewed, never blind-accepted).

---

## 7. Build order (by leverage) & status

1. **Layer 0 ratchet** — CI ungated `test-fast`: **DONE 2026-06-24** (`.github/workflows/ci.yml`
   runs the hermetic tier on every push/PR, no secrets). `test-fast`/`test-db` split +
   `db` marker: **DONE** (`pyproject.toml`, Makefile). Stop hook: **PENDING the user's OK**
   (it writes `.claude/settings.json`; command pre-tested — re-entry guard + exit-2-on-red).
2. **Layer 2 market contract test** — **BUILT 2026-06-24** (`tests/test_market_contract.py`,
   parameterized over every `markets/*.yaml`; asserts schema, sane gates, 2-letter home_state,
   crs=4326, non-empty industrial codes, and **unique db_schema**). All 6 markets pass.
3. **Layer 3 invariants** — **DONE 2026-06-24**. Ledger #1–#6 all covered: #3 tax-tier
   reachability (`test_scoring.py`), #4 `last_seen_at` staleness (`fresh_cutoff`/`is_stale`
   extracted pure + `test_universe_invariants.py`), #5 DNC fail-closed (`classify_contact`
   extracted pure + `test_place_calls.py`), #6 0-universe. See §4 ledger.
4. **conftest.py + Layer 4 golden** — ephemeral DB, snapshot, wire CI DB tier.  — **NOT BUILT (next)**
5. **Layer 5 market smoke** — recorded ArcGIS fixtures, nightly.  — **NOT BUILT (optional)**

---

## 8. Non-goals / open questions

- **Not** chasing line-coverage %. Coverage of the *collision surface* and the *ledger*
  matters; a coverage number does not.
- **Not** testing live ArcGIS endpoints in the per-commit suite (flaky, slow, rate-limited).
  Liveness belongs in `tools/discover_sources.py` / the weekly refresh, not in `make test`.
- **Open:** ephemeral DB in CI — Postgres **service container** (simplest, recommended) vs.
  a throwaway schema on a shared instance. Pick one when Layer 4 is built.
- **Open:** Stop-hook vs pre-commit for the local ratchet — Stop-hook covers agent sessions
  specifically (the actual problem); pre-commit also covers human commits. Could do both.
- **Open:** property-based (`hypothesis`) vs. table-driven for Layer 3. Start table-driven
  (zero new deps); reach for `hypothesis` only if a property's input space is genuinely wide.
