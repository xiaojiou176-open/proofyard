import { spawn } from "node:child_process"
import { mkdir, readFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const runtimeDir = path.resolve(scriptDir, "..", "..", ".runtime-cache")
const previewHost = "127.0.0.1"
const previewPortStart = 4173
const backendHost = "127.0.0.1"
const defaultBackendPort = 17380
let backendPort = String(defaultBackendPort)
let backendHealthUrl = `http://${backendHost}:${backendPort}/health/`
const shouldUseRealBackend = process.env.UI_AUDIT_USE_REAL_BACKEND === "1"

function canListen(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => {
      resolve(false)
    })
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findAvailablePort(host, startPort, maxAttempts = 20) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset
    if (await canListen(host, port)) {
      return port
    }
  }
  throw new Error(`No available port found from ${startPort} to ${startPort + maxAttempts - 1}`)
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32"
    const commandMap = {
      pnpm: "pnpm.cmd",
      node: "node.exe",
    }
    const finalCmd = isWindows ? commandMap[cmd] ?? cmd : cmd
    const finalArgs = args
    const child = spawn(finalCmd, finalArgs, {
      stdio: "inherit",
      shell: false,
      ...options,
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${cmd} ${args.join(" ")} failed with exit code ${code}`))
    })
  })
}

async function waitForServer(url, retries = 80, delayMs = 250) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        return
      }
    } catch {
      // Ignore and retry.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error(`Preview server is not reachable at ${url}`)
}

async function ensureBackendForAudit() {
  try {
    const runtimeBackendPortPath = path.resolve(runtimeDir, "dev", "backend.port")
    const savedPort = (await readFile(runtimeBackendPortPath, "utf-8")).trim()
    if (/^\d+$/.test(savedPort)) {
      backendPort = savedPort
      backendHealthUrl = `http://${backendHost}:${backendPort}/health/`
    }
  } catch {
    // Use default backend port when runtime metadata is absent.
  }
  if (shouldUseRealBackend) {
    try {
      const res = await fetch(backendHealthUrl)
      if (res.ok) {
        console.log("UI audit backend: reuse existing backend service")
        return null
      }
      throw new Error(`backend health check failed: ${res.status}`)
    } catch (error) {
      console.log(`UI audit backend: fallback to mock backend (${String(error)})`)
    }
  }

  if (!(await canListen(backendHost, Number(backendPort)))) {
    const selectedPort = await findAvailablePort(backendHost, defaultBackendPort + 1, 40)
    backendPort = String(selectedPort)
    backendHealthUrl = `http://${backendHost}:${backendPort}/health/`
    console.log(`UI audit backend: selected mock backend port ${backendPort}`)
  } else if (!shouldUseRealBackend) {
    console.log("UI audit backend: use mock backend (set UI_AUDIT_USE_REAL_BACKEND=1 to reuse real)")
  }

  const isWindows = process.platform === "win32"
const mockBackendProc = spawn(
    isWindows ? "node.exe" : "node",
    ["scripts/mock-backend.mjs"],
    {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        UI_AUDIT_BACKEND_PORT: backendPort,
      },
    }
  )
  await waitForServer(backendHealthUrl)
  return mockBackendProc
}

await mkdir(runtimeDir, { recursive: true })

const mockBackendProc = await ensureBackendForAudit()
const previewPort = await findAvailablePort(previewHost, previewPortStart)
const targetUrl = `http://${previewHost}:${previewPort}`
const isWindows = process.platform === "win32"
const previewProc = spawn(
  isWindows ? "pnpm.cmd" : "pnpm",
  [
    "exec",
    "vite",
    "preview",
    "--host",
    previewHost,
    "--port",
    String(previewPort),
    "--strictPort",
  ],
  {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      BACKEND_PORT: backendPort,
    },
  }
)

try {
  await waitForServer(targetUrl)
  await runCommand("pnpm", [
    "exec",
    "lighthouse",
    targetUrl,
    "--chrome-flags=--headless",
    "--only-categories=performance,accessibility,best-practices,seo",
    "--output=json",
    `--output-path=${runtimeDir}/lighthouse.report.json`,
  ])
  await runCommand("node", ["scripts/run-axe-audit.mjs", targetUrl])
  console.log(
    `UI audit finished. Reports: ${runtimeDir}/lighthouse.report.json, ${runtimeDir}/axe.report.json`
  )
} finally {
  previewProc.kill("SIGTERM")
  if (mockBackendProc) {
    mockBackendProc.kill("SIGTERM")
  }
}
