import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/score": "http://127.0.0.1:8000",
      "/demo": "http://127.0.0.1:8000",
      "/download": "http://127.0.0.1:8000",
      "/send-email": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
      "/live": "http://127.0.0.1:8000",
      "/pipedrive": "http://127.0.0.1:8000",
      "/template": "http://127.0.0.1:8000",
    },
  },
});
