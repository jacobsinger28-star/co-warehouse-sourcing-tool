# ── build the SPA — PII kept OUT of the public bundle ────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Move the real export OUT of public/ so vite does NOT bake it into the static
# dist. It becomes a server-side-only file that the running server gates behind
# POST /api/data. If absent, ship an empty object → app falls back to sample data.
RUN if [ -f public/data.real.json ]; then mv public/data.real.json ./data.real.json; else echo '{}' > ./data.real.json; fi
RUN [ -f lease-overlay.json ] || echo '{"props":{}}' > lease-overlay.json
RUN npm run build

# ── runtime — Playwright python (Chromium baked in, matches playwright==1.44.0)
# plus Node 20 for server.mjs. The Python sidecar runs the live brokerage
# scrapers; Node fronts everything (auth, data, deals chat, /live proxy).
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY backend/ ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY --from=build /app/dist ./dist
# Copy ALL server modules as a group. Enumerating them by name once let a new
# module (billing.mjs) ship without being copied — the build passed, the server
# crashed at boot on ERR_MODULE_NOT_FOUND, and the site went down at healthcheck.
# A glob can never leave a sibling behind. Tests live in test/ and are excluded.
COPY --from=build /app/*.mjs ./
COPY --from=build /app/crm ./crm
COPY --from=build /app/tools/check-imports.mjs ./tools/check-imports.mjs
COPY --from=build /app/data.real.json ./data.real.json
COPY --from=build /app/lease-overlay.json ./lease-overlay.json
COPY start.sh ./start.sh
RUN chmod +x start.sh
# Fail the BUILD (not the runtime healthcheck) if server.mjs imports a local
# module that isn't in the image — so a broken image is rejected and Railway
# keeps serving the last healthy deploy instead of taking the site down.
RUN node tools/check-imports.mjs server.mjs
# Boot smoke test: actually start the Node server and hit /health, so an image
# that BUILDS but can't BOOT — a missing npm dep (devDep dropped by --omit=dev),
# a syntax error, a bad import the static check can't see — is rejected here at
# build time instead of crash-looping in prod. /health needs no auth/DB; the
# server is designed to boot fail-closed without runtime env. Exits the instant
# /health answers (~1s); hard-fails after 15s.
RUN node server.mjs & SVR=$! ; \
    ok=0 ; \
    for i in $(seq 1 30); do \
      if curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then ok=1; break; fi ; \
      sleep 0.5 ; \
    done ; \
    kill "$SVR" 2>/dev/null || true ; \
    if [ "$ok" = 1 ]; then echo "✓ boot smoke test passed — server answered /health" ; \
    else echo "✗ boot smoke test failed — server did not answer /health in 15s" ; exit 1 ; fi
EXPOSE 8080
CMD ["./start.sh"]
