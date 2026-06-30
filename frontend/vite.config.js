import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone dev server on 3001 so it doesn't collide with the on-market app (3000).
// Honors $PORT when set (lets tooling pick a free port); defaults to 3001 otherwise.
// When wired to the backend, add a proxy block here for /api, /live, /pipedrive, etc.
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 3001, host: true },
})
