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
# Override the password:  APP_PASSWORD='your-pass' bash deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

REPO="git@github.com:jacobsinger28-star/co-warehouse-sourcing-tool.git"
APP_PASSWORD="${APP_PASSWORD:-SimiCap1170!}"
STAGE="/tmp/cw-deploy"

# ── 1. push CLEAN code to GitHub (owner PII excluded) ────────────────────────
echo "==> [1/4] git: push code (PII excluded)"
[ -d .git ] || git init -q
git add -A
if git status --porcelain | grep -qiE 'data\.(real|enc)\.json|(^|/)\.env$'; then
  echo "⛔ ABORT: a PII/secret file is staged for git — check .gitignore"; exit 1
fi
echo "    ✓ safety check passed — no data.real.json / secrets staged"
git commit -q -m "Co-warehouse sourcing console — server-side-auth, Railway-ready" \
  || echo "    (no code changes to commit)"
git branch -M main
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REPO"
git pull --rebase --allow-unrelated-histories origin main 2>/dev/null || true
git push -u origin main \
  || echo "    ⚠ push rejected (repo has history). To overwrite: git push -u origin main --force-with-lease"

# ── 2. Railway: CLI + login + project + password ─────────────────────────────
echo "==> [2/4] railway: login + project + password"
command -v railway >/dev/null 2>&1 || npm i -g @railway/cli
railway whoami >/dev/null 2>&1 || railway login
railway status  >/dev/null 2>&1 || railway init      # creates/links a project (interactive)
railway variables --set "APP_PASSWORD=${APP_PASSWORD}"

# ── 3. deploy WITH the data, but off GitHub (private `railway up`) ────────────
echo "==> [3/4] railway: deploy (data uploaded privately, not via GitHub)"
if [ ! -f public/data.real.json ]; then
  echo "⛔ public/data.real.json missing — run tools/build_real_data.py + tools/pull_pipedrive_brokers.py first"; exit 1
fi
rm -rf "$STAGE"; mkdir -p "$STAGE"
# copy the app + the data into a staging dir that has NO .gitignore, so railway
# up uploads data.real.json (a .railwayignore keeps only junk out).
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .vercel \
         --exclude .gitignore --exclude deploy.sh ./ "$STAGE"/
[ -d .railway ] && cp -r .railway "$STAGE"/.railway || true   # carry the project link
printf 'node_modules\ndist\n.git\n.vercel\n' > "$STAGE"/.railwayignore
( cd "$STAGE" && railway up )

# ── 4. URL + verify ──────────────────────────────────────────────────────────
echo "==> [4/4] done"
railway domain || true
echo
echo "Verify the data loaded server-side:"
echo "   railway logs | grep 'data loaded'      # want: data loaded (2446 props, 24 brokers)"
echo "Then open the Railway URL above and sign in with: ${APP_PASSWORD}"
