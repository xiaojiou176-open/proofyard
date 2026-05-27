import { defineConfig } from "@playwright/experimental-ct-react"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = resolve(fileURLToPath(import.meta.url), "..")
const repoRoot = resolve(__dirname, "../../../../")

const ctHost = process.env.UIQ_CT_HOST ?? "127.0.0.1"
const ctPort = Number(process.env.UIQ_CT_PORT ?? 4174)
const ctBaseUrl = `http://${ctHost}:${ctPort}`
const defaultWorkers = process.env.CI ? "4" : "50%"

function resolveWorkers(): number | string {
  const raw =
    process.env.UIQ_PLAYWRIGHT_CT_WORKERS ?? process.env.UIQ_PLAYWRIGHT_WORKERS ?? defaultWorkers
  if (/^\d+%$/.test(raw)) return raw
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  throw new Error(
    `Invalid Playwright workers value '${raw}'. Use positive integer or percentage like '50%'.`
  )
}

export default defineConfig({
  testDir: __dirname,
  snapshotDir: "./__snapshots__",
  workers: resolveWorkers(),
  outputDir: resolve(repoRoot, ".runtime-cache/artifacts/test-results/apps-web-ct"),
  use: {
    baseURL: ctBaseUrl,
    ctPort,
    ctTemplateDir: "template",
    ctViteConfig: {
      plugins: [react()],
      resolve: {
        alias: {
          react: resolve(__dirname, "../../../../node_modules/react"),
          "react-dom": resolve(__dirname, "../../../../node_modules/react-dom"),
          "react/jsx-runtime": resolve(__dirname, "../../../../node_modules/react/jsx-runtime.js"),
        },
      },
      server: {
        host: ctHost,
        port: ctPort,
        strictPort: true,
      },
      preview: {
        host: ctHost,
        port: ctPort,
        strictPort: true,
      },
    },
  },
})
