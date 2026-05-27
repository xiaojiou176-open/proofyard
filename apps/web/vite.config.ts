import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { frontendNodeEnv } from "./config/env.node"

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 17373,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${frontendNodeEnv("BACKEND_PORT", "17380")}`,
        changeOrigin: true,
      },
      "/health": {
        target: `http://127.0.0.1:${frontendNodeEnv("BACKEND_PORT", "17380")}`,
        changeOrigin: true,
      },
    },
  },
})
