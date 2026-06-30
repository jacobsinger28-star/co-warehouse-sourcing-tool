# Makefile — this is the orchestrator. No Airflow, no Dagster.

# -include: don't explode on a fresh clone before .env exists.
-include .env
export

# Use the project venv if present; override with `make PYTHON=python3 ...`.
PYTHON ?= .venv/bin/python
IMPORTS_DIR ?= ./imports
SITE_DIR ?= exports/vercel_site
# SIMI_DIR = the live ENCRYPTED Vercel deploy dir (simi-sourcing.vercel.app). No inline
# comment on the assignment itself: it would leave trailing spaces in the value.
SIMI_DIR ?= exports/simi-sourcing

refresh: ingest normalize universe lidar score-provisional images vlm score sync dashboard   ## full pipeline

# Charlotte / Mecklenburg County, NC — re-pointed pipeline (MARKET=charlotte, isolated DB
# schema). Charlotte's CAMA is a single layer so it has its own ingest scripts; the
# downstream stages are the SAME shared, market-aware code. ORDER MATTERS: build_universe
# runs BEFORE pull_distress so the no_permits_10yr permit anomaly is derived over the gated
# set. One-time schema init (create schema + apply db/migrations) is in docs/BUILD_LOG.md §11.
# (lidar/images/vlm omitted — LiDAR source is Nashville-specific; imagery needs API keys.)
charlotte:   ## full Charlotte pipeline -> ranked CSV + unified dashboard
	MARKET=charlotte $(PYTHON) ingest/pull_parcels_charlotte.py
	MARKET=charlotte $(PYTHON) transform/normalize.py
	MARKET=charlotte $(PYTHON) transform/build_universe.py
	MARKET=charlotte $(PYTHON) ingest/pull_distress_charlotte.py
	MARKET=charlotte $(PYTHON) scoring/score.py --stage final
	$(PYTHON) tools/make_dashboard.py               # aggregates ALL built markets (incl. Charlotte)

# Columbus / Franklin County, OH — re-pointed pipeline (MARKET=columbus, isolated DB schema).
# Columbus has its own ingest scripts (auditor parcel layer for SF/owner/value + a SPATIAL
# code-enforcement join — the city Accela parcel keys don't match the auditor PARCELID); the
# downstream stages are the SAME shared, market-aware code. ORDER MATTERS: build_universe runs
# BEFORE distress (parity with charlotte). One-time schema init is in docs/BUILD_LOG.md §11/§13.
# (lidar/images/vlm omitted — LiDAR is Nashville-specific; imagery needs API keys. year_built is
#  unavailable in Franklin County's open feeds — needs the Auditor bulk CAMA pull; see §14.)
columbus:   ## full Columbus pipeline -> ranked CSV + unified dashboard
	MARKET=columbus $(PYTHON) ingest/pull_parcels_columbus.py
	MARKET=columbus $(PYTHON) transform/normalize.py
	MARKET=columbus $(PYTHON) transform/build_universe.py
	MARKET=columbus $(PYTHON) ingest/pull_cama_columbus.py
	MARKET=columbus $(PYTHON) ingest/pull_distress_columbus.py
	MARKET=columbus $(PYTHON) scoring/score.py --stage final
	$(PYTHON) tools/make_dashboard.py               # aggregates ALL built markets (incl. Columbus)

# Cleveland / Cuyahoga County, OH — re-pointed pipeline (MARKET=cuyahoga, isolated DB schema).
# The easiest market built: ONE county FeatureServer carries owner/mailing/class + REAL summed
# assessor building SF (total_com_use_area) + market value + year_built + sale + native tax
# delinquency. City of Cleveland (Accela) violations + permits join on the parcel PIN (~11yr
# history). No footprint proxy needed (unlike Columbus). Schema init: docs/BUILD_LOG.md §11f recipe.
cuyahoga:   ## full Cuyahoga pipeline -> ranked CSV + unified dashboard
	MARKET=cuyahoga $(PYTHON) ingest/pull_parcels_cuyahoga.py
	MARKET=cuyahoga $(PYTHON) transform/normalize.py
	MARKET=cuyahoga $(PYTHON) transform/build_universe.py
	MARKET=cuyahoga $(PYTHON) ingest/pull_distress_cuyahoga.py
	MARKET=cuyahoga $(PYTHON) scoring/score.py --stage final
	$(PYTHON) tools/make_dashboard.py               # aggregates ALL built markets (incl. Cuyahoga)

# Cincinnati / Hamilton County, OH — re-pointed pipeline (MARKET=hamilton, isolated DB schema).
# Columbus-shaped: CAGIS parcel layer has owner/class/value/sale + native distress (DELQ_TAXES,
# FORECL_FLAG) but NO assessor SF for industrial -> building_sf is a FOOTPRINT PROXY (planimetric
# SQFT). No year_built in open feeds (-> NULL, no permit anomaly). Code enforcement is SPATIAL
# (point-in-parcel), Cincinnati-city-only. Schema init: docs/BUILD_LOG.md §11f recipe.
hamilton:   ## full Hamilton pipeline -> ranked CSV + unified dashboard
	MARKET=hamilton $(PYTHON) ingest/pull_parcels_hamilton.py
	MARKET=hamilton $(PYTHON) transform/normalize.py
	MARKET=hamilton $(PYTHON) transform/build_universe.py
	MARKET=hamilton $(PYTHON) ingest/pull_distress_hamilton.py
	MARKET=hamilton $(PYTHON) scoring/score.py --stage final
	$(PYTHON) tools/make_dashboard.py               # aggregates ALL built markets (incl. Hamilton)

# Charleston County, SC — re-pointed pipeline (MARKET=charleston, isolated DB schema).
# Clean assessor CAMA (owner/mailing/class/sale price+date/acreage/geom) + footprint-proxy SF
# (PID key join, no spatial op). NO distress stage: Charleston has no open code-enforcement feed,
# no year_built, no tax-delinquency field — so it scores on owner profile + hold + proximity.
# pull_assessor_charleston scrapes the county record-card portal for the FULL deed history and
# corrects hold_years off the most-recent arm's-length sale (the GIS feed carries nominal transfers).
# Schema init: docs/BUILD_LOG.md §11f recipe (incl. 005_assessor_sales.sql).
charleston:   ## full Charleston pipeline -> ranked CSV + unified dashboard (no distress feed)
	MARKET=charleston $(PYTHON) ingest/pull_parcels_charleston.py
	MARKET=charleston $(PYTHON) ingest/pull_assessor_charleston.py
	MARKET=charleston $(PYTHON) transform/normalize.py
	MARKET=charleston $(PYTHON) transform/build_universe.py
	MARKET=charleston $(PYTHON) scoring/score.py --stage final
	$(PYTHON) tools/make_dashboard.py               # aggregates ALL built markets (incl. Charleston)

dashboard:
	$(PYTHON) tools/make_dashboard.py               # unified multi-city viewer (all markets) -> exports/dashboard.html

dashboard-review:
	$(PYTHON) tools/make_dashboard.py --review       # shareable feedback copy (all markets) -> exports/dashboard_review.html

map:
	$(PYTHON) tools/make_map.py --dump-json exports/map_data.json   # interactive Leaflet map of every market -> exports/map.html

# share: the SAFE half of "publish on green". Depends on `test-fast` (the hermetic ratchet),
# so a red suite aborts first AND share stays runnable on any machine without the dev Postgres.
# Rebuilds the unified review dashboard (every built market in one file) and refreshes the
# local deploy file + DB-free snapshot. NOTHING leaves the machine — run this on green.
share: test-fast   ## hermetic tests -> rebuild the shared dashboard into the local deploy file (no upload)
	$(PYTHON) tools/make_dashboard.py --review \
		--dump-json exports/dashboard_data.json \
		--out exports/dashboard_review.html
	cp exports/dashboard_review.html $(SITE_DIR)/index.html
	@echo "deploy file refreshed (LOCAL only): $(SITE_DIR)/index.html — run 'make deploy' to upload"

# deploy: the SENSITIVE step. Uploads the dashboard — which contains owner PII and is marked
# internal/do-not-publish — to Vercel, an external host. Keep it a DELIBERATE, human-run action;
# do NOT wire it into an automatic hook. See exports/vercel_site/DEPLOY.md.
deploy:   ## upload the staged dashboard to Vercel (sends owner PII off-machine — run intentionally)
	@if [ -d "$(SITE_DIR)/.vercel" ]; then \
		cd $(SITE_DIR) && vercel --prod ; \
	else \
		echo ">> Vercel not linked yet. One-time: (cd $(SITE_DIR) && vercel), then set BASIC_AUTH_USER / BASIC_AUTH_PASS env vars."; \
	fi

publish: share deploy   ## share + deploy (the deploy step sends owner PII off-machine — intentional)

# lock: produce a PASSWORD-PROTECTED, ENCRYPTED copy of the dashboard (AES-256-GCM, key from
# DASHBOARD_PASSWORD via PBKDF2). The PII is encrypted at rest, so the locked file is safe to
# EMAIL or host on ANY static host (even a plain public URL) — no server, no Vercel plan, no
# middleware. Share the password through a separate channel. Needs Node (built-in crypto).
lock: share   ## encrypt the dashboard with a password -> exports/dashboard_locked.html (set DASHBOARD_PASSWORD)
	@test -n "$$DASHBOARD_PASSWORD" || { echo ">> set the password first:  export DASHBOARD_PASSWORD='your passphrase'"; exit 1; }
	node tools/lock_html.js exports/dashboard_review.html exports/dashboard_locked.html
	@echo "locked copy: exports/dashboard_locked.html — email it or host it anywhere; send the password separately"

# verify-locks: THE GUARD. Assert that EVERY encrypted page in the live deploy dir actually
# opens with DASHBOARD_PASSWORD. A page locked with the wrong password is valid ciphertext and
# looks fine to every other check (AES-GCM marker present, no plaintext PII) — the ONLY way to
# catch it is to try the password. On 2026-06-19 the table (index.html) shipped locked with a
# different password than map/queue and colleagues were silently locked out. Never again: this
# gates the deploy. See docs/BUILD_LOG.md and tools/verify_lock.js.
verify-locks:   ## assert every page in the deploy dir opens with DASHBOARD_PASSWORD (abort if not)
	@test -n "$$DASHBOARD_PASSWORD" || { echo ">> set the password first:  export DASHBOARD_PASSWORD='...'"; exit 1; }
	@for f in $(SIMI_DIR)/*.html; do \
		node tools/verify_lock.js "$$f" "$$DASHBOARD_PASSWORD" || { echo ">> ABORT: $$f does NOT open with DASHBOARD_PASSWORD"; exit 1; }; \
	done
	@echo ">> OK: every page in $(SIMI_DIR) opens with the given password"

# deploy-locked: the ONLY supported way to ship the encrypted dashboard. Re-locks the table from
# the freshly-built review HTML, stages it (ciphertext only), VERIFIES every page opens with the
# password, deploys, then re-verifies the LIVE pages. Refuses to ship a wrong-password page.
# Needs Node 18+ on PATH for vercel (export PATH="$$HOME/.nvm/versions/node/v18.20.4/bin:$$PATH").
deploy-locked: lock verify-locks   ## lock -> verify every page opens -> deploy -> re-verify live
	cp exports/dashboard_locked.html $(SIMI_DIR)/index.html
	@node tools/verify_lock.js $(SIMI_DIR)/index.html "$$DASHBOARD_PASSWORD" || { echo ">> ABORT: staged index does not open with password"; exit 1; }
	cd $(SIMI_DIR) && vercel --prod --yes
	@echo ">> verifying LIVE pages open with the password..."
	@for p in "" map.html queue.html; do \
		curl -s -o /tmp/_simi_live.html "https://simi-sourcing.vercel.app/$$p" && \
		node tools/verify_lock.js /tmp/_simi_live.html "$$DASHBOARD_PASSWORD" || { echo ">> LIVE /$$p does NOT open with password"; exit 1; }; \
	done
	@echo ">> OK: live dashboard, map and queue all open with DASHBOARD_PASSWORD"

ingest:
	$(PYTHON) ingest/pull_parcels.py
	$(PYTHON) ingest/pull_violations.py
	$(PYTHON) ingest/pull_permits.py
	$(PYTHON) ingest/import_csv.py --dir $(IMPORTS_DIR)

normalize:
	$(PYTHON) transform/normalize.py

universe:
	$(PYTHON) transform/build_universe.py

lidar:
	$(PYTHON) imagery/lidar_height.py               # free LiDAR roof-height -> clear_height_est (cached; only new universe entrants)

score-provisional:
	$(PYTHON) scoring/score.py --stage provisional

images:
	$(PYTHON) imagery/fetch_images.py --top 200     # cached; only fetches new entrants

vlm:
	$(PYTHON) imagery/vlm_score.py                  # cached; only scores new images

score:
	$(PYTHON) scoring/score.py --stage final

sync:
	$(PYTHON) sync/airtable_sync.py --push-top 150
	$(PYTHON) sync/airtable_sync.py --pull-grades

skiptrace-export:
	$(PYTHON) outreach/skiptrace_export.py --grade A --out exports/skiptrace_$(shell date +%Y%m%d).csv

skiptrace-import:
	$(PYTHON) outreach/skiptrace_import.py --file $(FILE)

call-sheets:
	$(PYTHON) outreach/call_sheets.py --grade A --out exports/call_sheets/

# --- AI calling + CRM (vendor-agnostic dialer; Pipedrive system-of-record) ---------------
# Flow: place-calls -> (vendor dials) -> call-results -> pipedrive-sync + call-queue.
# COMPLIANCE: place_calls only dials DNC-checked numbers (contacts.dnc_checked) and every
# script opens with an AI disclosure. CALL_PROVIDER selects the vendor (default 'stub' = no
# real calls placed). See docs/BUILD_LOG.md §15.
place-calls:   ## AI-dial the A-tier queue. Dry-run by default; `make place-calls COMMIT=1` places calls
	$(PYTHON) outreach/place_calls.py --grade A $(if $(COMMIT),--commit,)

call-results:  ## ingest AI-call outcomes into outreach_log (FILE=path/to/vendor_results.json)
	$(PYTHON) outreach/call_results.py --file $(FILE)

pipedrive-sync:  ## push completed call outcomes to Pipedrive (stub-safe; `make pipedrive-sync DRYRUN=1`)
	$(PYTHON) sync/pipedrive_sync.py $(if $(DRYRUN),--dry-run,)

call-queue:    ## build the click-to-call human handoff page -> exports/call_queue.html
	$(PYTHON) tools/make_call_queue.py

# Test tiers (TEST_ARCHITECTURE.md Layer 0). `test-fast` is the RATCHET: hermetic — no DB,
# no network — so it is always runnable and is what CI (.github/workflows/ci.yml) and the
# local Stop hook run; it can never silently no-op on a machine without the dev Postgres.
# `test-db` is the DB tier (needs Postgres on $DATABASE_URL). `test` runs both (human target).
test:        ## run EVERYTHING (hermetic + DB) — needs Postgres up for the DB tier
	$(PYTHON) -m pytest tests/ -v

test-fast:   ## hermetic tier only (no DB / no network) — the ratchet; always runnable
	$(PYTHON) -m pytest tests/ -m "not db" -q

test-db:     ## DB tier only (needs Postgres on $DATABASE_URL / the dev server up)
	$(PYTHON) -m pytest tests/ -m "db" -q

.PHONY: refresh charlotte columbus ingest normalize universe lidar score-provisional images vlm score sync dashboard \
        dashboard-review share deploy publish lock verify-locks deploy-locked skiptrace-export skiptrace-import call-sheets \
        place-calls call-results pipedrive-sync call-queue test test-fast test-db
