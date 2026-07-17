#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — push the Co-Warehouse Sourcing Console + deploy it to Railway.
#
#   cd ~/Desktop/code/SimiCapital/sourcing-platform/frontend
#   bash deploy.sh
#
# Owner/broker PII stays OFF GitHub: the git push excludes data.real.json
# (.gitignore), while Railway receives the data privately via `railway up` from a
# staging copy. The running server gates the data behind a server-side password
# (POST /api/data) — it is never a downloadable file and never on GitHub.
#
# Required — set the password (never committed):  APP_PASSWORD='your-pass' bash deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

REPO="git@github.com:jacobsinger28-star/co-warehouse-sourcing-tool.git"
STAGE="/tmp/cw-deploy"

# An auth method must be provided — never hardcode secrets (this script is committed).
# Either Supabase login (SUPABASE_URL + SUPABASE_ANON_KEY + ALLOWED_EMAILS) or the
# legacy shared APP_PASSWORD (or both, during the transition).
SUPA_OK=0
[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ] && SUPA_OK=1
if [ "$SUPA_OK" = 0 ] && [ -z "${APP_PASSWORD:-}" ]; then
  echo "⛔ No auth method. Run one of:"
  echo "   SUPABASE_URL='https://….supabase.co' SUPABASE_ANON_KEY='…' bash deploy.sh   # allowlist defaults to @simicap.com"
  echo "   APP_PASSWORD='your-strong-pass' bash deploy.sh"
  exit 1
fi

# ── 1. push CLEAN code to GitHub (owner PII excluded) ────────────────────────
# The MONOREPO (parent of frontend/) is the git repo — never git-init here.
# A past run did exactly that: it created frontend/.git, committed, then pulled
# the monorepo with --allow-unrelated-histories, dumping a full copy of the repo
# inside frontend/ with conflict markers. Operate on the parent repo only.
echo "==> [1/4] git: push monorepo code (PII excluded)"
if ! git -C .. rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "⛔ ABORT: parent dir is not the monorepo git checkout — refusing to git init"; exit 1
fi
git -C .. add -A
if git -C .. status --porcelain | grep -qiE 'data\.(real|enc)\.json|(^|/)\.env$'; then
  echo "⛔ ABORT: a PII/secret file is staged for git — check .gitignore"; exit 1
fi
echo "    ✓ safety check passed — no data.real.json / secrets staged"
git -C .. commit -q -m "Deploy: sourcing console update" \
  || echo "    (no code changes to commit)"
git -C .. push origin main \
  || echo "    ⚠ push failed — push manually from the repo root, then re-run"

# ── 2. Railway: CLI + login + project + password ─────────────────────────────
# The Railway project/service (created 2026-07): gracious-reprieve /
# co-warehouse-sourcing-tool. Linked EXPLICITLY — `railway init` would create a
# duplicate project, and the interactive picker dies in scripts.
RW_PROJECT="gracious-reprieve"
RW_SERVICE="co-warehouse-sourcing-tool"
echo "==> [2/4] railway: login + project + auth variables"
command -v railway >/dev/null 2>&1 || npm i -g @railway/cli
railway whoami >/dev/null 2>&1 || railway login
railway link --project "$RW_PROJECT" --service "$RW_SERVICE" --environment production
[ -n "${APP_PASSWORD:-}" ] && railway variables --set "APP_PASSWORD=${APP_PASSWORD}"
if [ "$SUPA_OK" = 1 ]; then
  railway variables \
    --set "SUPABASE_URL=${SUPABASE_URL}" \
    --set "SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}"
  # optional — server defaults to '@simicap.com' (whole-domain entry) when unset
  [ -n "${ALLOWED_EMAILS:-}" ] && railway variables --set "ALLOWED_EMAILS=${ALLOWED_EMAILS}"
fi
echo "    NOTE: if variables were changed, Railway may hold them as STAGED changes —"
echo "    check the project dashboard for an 'Apply changes' banner if they don't stick."

# ── 3. deploy WITH the data, but off GitHub (private `railway up`) ────────────
# The service builds with Root Directory /frontend (the GitHub repo layout), so
# the staged upload must nest everything under frontend/ too.
echo "==> [3/4] railway: deploy (data uploaded privately, not via GitHub)"
if [ ! -f public/data.real.json ]; then
  echo "⛔ public/data.real.json missing — run tools/build_real_data.py + tools/pull_pipedrive_brokers.py first"; exit 1
fi
rm -rf "$STAGE"; mkdir -p "$STAGE/frontend"
# copy the app + the data into a staging dir that has NO .gitignore, so railway
# up uploads data.real.json (a .railwayignore keeps only junk out).
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .vercel \
         --exclude .gitignore --exclude deploy.sh ./ "$STAGE"/frontend/
printf 'node_modules\ndist\n.git\n.vercel\n' > "$STAGE"/.railwayignore
( cd "$STAGE" \
  && railway link --project "$RW_PROJECT" --service "$RW_SERVICE" --environment production \
  && railway up --service "$RW_SERVICE" )

# ── 4. URL + verify ──────────────────────────────────────────────────────────
echo "==> [4/4] done"
railway domain || true
echo
echo "Verify the data loaded server-side:"
echo "   railway logs | grep 'data loaded'      # want: data loaded (<props> props, <brokers> brokers), NOT (0 props"
if [ "$SUPA_OK" = 1 ]; then
  echo "Then open the Railway URL above and sign in with a Supabase account (allowed: ${ALLOWED_EMAILS:-@simicap.com})"
else
  echo "Then open the Railway URL above and sign in with: ${APP_PASSWORD}"
fi
