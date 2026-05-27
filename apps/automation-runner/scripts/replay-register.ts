import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { type APIRequestContext, type APIResponse, request } from "@playwright/test"
import { AUTOMATION_ENV } from "./lib/env.js"

type EndpointSpec = {
  method: string
  fullUrl?: string
  path: string
  contentType?: string | null
}

type BootstrapStep = {
  method: string
  fullUrl?: string
  path: string
}

type ReplayHint = {
  bodyMode?: "json" | "form" | "raw" | "none"
  contentType?: string | null
  tokenHeaderNames?: string[]
  successStatuses?: number[]
}

type FlowReplaySpec = {
  baseUrl: string
  actionEndpoint?: EndpointSpec | null
  registerEndpoint?: EndpointSpec | null
  bootstrapSequence?: BootstrapStep[]
  csrfBootstrap?: {
    exists: boolean
    fullUrl: string | null
    path: string | null
  }
  requiredHeaders?: Record<string, string>
  payloadExample?: Record<string, unknown>
  replayHints?: ReplayHint
  security?: {
    tokenHeaderNames?: string[]
  }
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..")
const SAFE_RUNTIME_ROOT = path.resolve(REPO_ROOT, ".runtime-cache")
const RUNTIME_ROOT = path.resolve(SAFE_RUNTIME_ROOT, "automation")
const SENSITIVE_KEY_PATTERN =
  /(password|secret|passwd|token|authorization|cookie|otp|csrf|xsrf|code)/i

function latestSpecPath(): string {
  return process.env.UIQ_AUTOMATION_LATEST_SPEC_PATH
    ? path.resolve(process.cwd(), process.env.UIQ_AUTOMATION_LATEST_SPEC_PATH)
    : path.join(RUNTIME_ROOT, "latest-spec.json")
}

function getOption(name: string): string | null {
  const prefix = `--${name}=`
  const matched = process.argv.find((arg) => arg.startsWith(prefix))
  return matched ? matched.slice(prefix.length) : null
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8")
  return JSON.parse(raw) as T
}

export function resolveRelativeOrAbsolute(baseUrl: string, candidate: string): string {
  if (/^https?:\/\//i.test(candidate)) return candidate
  if (!baseUrl) return candidate
  return new URL(candidate, baseUrl).toString()
}

export function firstStringToken(input: unknown): string | null {
  if (!input) return null
  if (typeof input === "string") return input
  if (Array.isArray(input)) {
    for (const item of input) {
      const hit = firstStringToken(item)
      if (hit) return hit
    }
    return null
  }
  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!/(csrf|xsrf|token|sentinel|nonce)/i.test(key)) continue
      if (typeof value === "string" && value.trim()) return value
    }
    for (const value of Object.values(input as Record<string, unknown>)) {
      const hit = firstStringToken(value)
      if (hit) return hit
    }
  }
  return null
}

export function inferBodyMode(
  spec: FlowReplaySpec,
  endpoint: EndpointSpec
): "json" | "form" | "raw" | "none" {
  if (spec.replayHints?.bodyMode) return spec.replayHints.bodyMode
  const contentType = spec.replayHints?.contentType ?? endpoint.contentType ?? ""
  const normalized = contentType.toLowerCase()
  if (!normalized) return "json"
  if (normalized.includes("application/json")) return "json"
  if (normalized.includes("application/x-www-form-urlencoded")) return "form"
  return "raw"
}

function readRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim()
  if (value) return value
  throw new Error(`missing required env: ${name}`)
}

export function isPathInsideRoot(candidatePath: string, root: string): boolean {
  const relativePath = path.relative(root, candidatePath)
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

export function ensureSafeSpecPath(candidatePath: string): string {
  const resolved = path.resolve(candidatePath)
  if (!isPathInsideRoot(resolved, SAFE_RUNTIME_ROOT)) {
    throw new Error(`unsafe --spec path outside runtime root: ${resolved}`)
  }
  return resolved
}

export function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...payload }
  const replayPassword = readRequiredEnv("REPLAY_PASSWORD")
  for (const [key, value] of Object.entries(normalized)) {
    const lowerKey = key.toLowerCase()
    if (/(password|secret|passwd)/.test(lowerKey)) {
      normalized[key] = replayPassword
      continue
    }
    if (typeof value === "string" && value.includes("***REDACTED***")) {
      if (/(password|secret|passwd)/.test(lowerKey)) {
        normalized[key] = readRequiredEnv("REPLAY_PASSWORD")
      } else if (/(token|csrf|xsrf|sentinel)/.test(lowerKey)) {
        normalized[key] = process.env.REPLAY_TOKEN ?? ""
      }
    }
    if (typeof value === "string" && /(email|username|login)/.test(lowerKey)) {
      normalized[key] = `replay+${Date.now()}@example.com`
    }
  }
  if (!("email" in normalized)) normalized.email = `replay+${Date.now()}@example.com`
  if (!("password" in normalized)) normalized.password = readRequiredEnv("REPLAY_PASSWORD")
  return normalized
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = "***REDACTED***"
      continue
    }
    redacted[key] = value
  }
  return redacted
}

export function sanitizeResponseBody(body: string): string {
  return body
    .replace(/(authorization["'\s:=]+)(bearer\s+)?[a-z0-9\-._~+/]+=*/gi, "$1***REDACTED***")
    .replace(/((?:csrf|xsrf|otp|token|code)["'\s:=]+)[a-z0-9\-._~+/]{4,}/gi, "$1***REDACTED***")
}

export async function resolveSpecPath(): Promise<string> {
  const argSpec = getOption("spec")
  if (argSpec) return ensureSafeSpecPath(path.resolve(process.cwd(), argSpec))
  const latest = await readJson<{ specPath: string }>(latestSpecPath())
  return ensureSafeSpecPath(latest.specPath)
}

async function runBootstrap(api: APIRequestContext, spec: FlowReplaySpec): Promise<string | null> {
  const sequence =
    spec.bootstrapSequence && spec.bootstrapSequence.length > 0
      ? spec.bootstrapSequence
      : spec.csrfBootstrap?.exists && spec.csrfBootstrap.path
        ? [{ method: "GET", path: spec.csrfBootstrap.path }]
        : []
  let discoveredToken: string | null = null
  for (const step of sequence) {
    const url = resolveRelativeOrAbsolute(spec.baseUrl, step.fullUrl ?? step.path)
    const method = (step.method || "GET").toUpperCase()
    let response: APIResponse
    switch (method) {
      case "POST":
        response = await api.post(url)
        break
      case "PUT":
        response = await api.put(url)
        break
      case "PATCH":
        response = await api.patch(url)
        break
      case "DELETE":
        response = await api.delete(url)
        break
      default:
        response = await api.get(url)
        break
    }
    const contentType = (response.headers()["content-type"] ?? "").toLowerCase()
    if (contentType.includes("application/json")) {
      try {
        const body = (await response.json()) as unknown
        const token = firstStringToken(body)
        if (token) discoveredToken = token
      } catch {
        // ignore invalid JSON bootstrap body
      }
    }
  }
  return discoveredToken
}

async function main(): Promise<void> {
  const specPath = await resolveSpecPath()
  const spec = await readJson<FlowReplaySpec>(specPath)
  const endpoint = spec.actionEndpoint ?? spec.registerEndpoint
  if (!endpoint) {
    throw new Error("action endpoint is missing in flow request spec")
  }
  const method = (endpoint.method || "POST").toUpperCase()
  const endpointUrl = resolveRelativeOrAbsolute(spec.baseUrl, endpoint.fullUrl ?? endpoint.path)
  const bodyMode = inferBodyMode(spec, endpoint)
  const expectedStatuses =
    spec.replayHints?.successStatuses && spec.replayHints.successStatuses.length > 0
      ? spec.replayHints.successStatuses
      : [200, 201]

  const api = await request.newContext({
    baseURL: spec.baseUrl || undefined,
    extraHTTPHeaders: { Accept: "application/json" },
  })

  const discoveredToken = await runBootstrap(api, spec)
  const tokenHeaderNames = [
    ...(spec.replayHints?.tokenHeaderNames ?? []),
    ...(spec.security?.tokenHeaderNames ?? []),
  ].filter(Boolean)
  const uniqueTokenHeaders = [...new Set(tokenHeaderNames)]

  const payload = normalizePayload(spec.payloadExample ?? {})
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(spec.requiredHeaders ?? {})) {
    if (value === "***DYNAMIC***") continue
    headers[key] = value
  }
  const contentType = spec.replayHints?.contentType ?? endpoint.contentType
  if (contentType) headers["content-type"] = contentType
  const tokenValue = AUTOMATION_ENV.REPLAY_TOKEN ?? discoveredToken ?? null
  if (tokenValue) {
    for (const headerName of uniqueTokenHeaders) {
      headers[headerName] = tokenValue
    }
  }

  let response: APIResponse
  if (method === "GET" || method === "HEAD") {
    response = await api.fetch(endpointUrl, { method, headers })
  } else if (bodyMode === "json") {
    response = await api.fetch(endpointUrl, { method, headers, data: payload })
  } else if (bodyMode === "form") {
    response = await api.fetch(endpointUrl, {
      method,
      headers,
      form: payload as Record<string, string>,
    })
  } else {
    response = await api.fetch(endpointUrl, { method, headers, data: payload })
  }

  const resultText = sanitizeResponseBody(await response.text())
  const ok = expectedStatuses.includes(response.status())
  const output = {
    generatedAt: new Date().toISOString(),
    specPath,
    endpoint: endpoint.path,
    method,
    status: response.status(),
    ok,
    expectedStatuses,
    headersUsed: Object.keys(headers).sort(),
    payload: redactPayload(payload),
    responseBody: resultText.slice(0, 4000),
  }

  const outputPath = path.join(path.dirname(specPath), "replay-result.json")
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8")
  await api.dispose()

  if (!ok) {
    throw new Error(
      `replay failed: status=${response.status()} expected=${expectedStatuses.join(",")}`
    )
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`replay-register failed: ${message}\n`)
    process.exitCode = 1
  })
}
