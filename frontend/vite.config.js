import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone dev server on 3001 so it doesn't collide with the on-market app (3000).
// Honors $PORT when set (lets tooling pick a free port); defaults to 3001 otherwise.
// /api/* proxies to the Express server (server.mjs, :8080) so the authed routes
// (/api/data, /api/deals-chat) work in dev — run `node server.mjs` alongside vite.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 3001,
    host: true,
    proxy: { '/api': 'http://localhost:8080' },
  },
})
