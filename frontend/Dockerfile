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
RUN npm run build

# ── runtime — tiny server that serves dist + gates the data ──────────────────
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/data.real.json ./data.real.json
EXPOSE 8080
CMD ["node", "server.mjs"]
