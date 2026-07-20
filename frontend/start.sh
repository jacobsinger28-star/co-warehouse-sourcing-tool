#!/bin/sh
# Container entrypoint: Python live-scrape sidecar (localhost-only — the Node
# server is the sole, authed way in) + the Node server on $PORT.
cd /app/backend
uvicorn live_api:app --host 127.0.0.1 --port 8000 &
cd /app
exec node server.mjs
