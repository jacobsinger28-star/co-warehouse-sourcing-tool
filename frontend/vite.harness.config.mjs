// Untracked harness build config — no-gate App preview into the session
// scratchpad for visual verification. Not part of the app build.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '/private/tmp/claude-501/-Users-razkorteran-Desktop-code-SimiCapital-off-market-operating-system/c9b7d0c4-75b9-4822-96f5-53173d0a32f7/scratchpad/dist-lease',
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'dev-app.html') },
  },
})
