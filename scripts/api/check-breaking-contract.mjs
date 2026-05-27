#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

function run(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function parseSpec(text, label) {
  try {
    return JSON.parse(
      execFileSync(
        "uv",
        [
          "run",
          "python",
          "-c",
          [
            "import json, sys, yaml",
            "print(json.dumps(yaml.safe_load(sys.stdin.read())))",
          ].join("; "),
        ],
        { encoding: "utf8", input: text }
      )
    )
  } catch (error) {
    throw new Error(
      `failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function opMethods(pathItem) {
  const methods = ["get", "post", "put", "patch", "delete", "options", "head"]
  return methods.filter((m) => pathItem && typeof pathItem[m] === "object")
}

function normalizeParam(p) {
  return {
    name: String(p?.name ?? ""),
    in: String(p?.in ?? ""),
    required: Boolean(p?.required),
  }
}

function toOperationMap(spec) {
  const map = new Map()
  const pathsObj = spec?.paths && typeof spec.paths === "object" ? spec.paths : {}
  for (const [route, pathItem] of Object.entries(pathsObj)) {
    const pathParams = Array.isArray(pathItem?.parameters)
      ? pathItem.parameters.map(normalizeParam)
      : []
    for (const method of opMethods(pathItem)) {
      const op = pathItem[method] ?? {}
      const key = `${method.toUpperCase()} ${route}`
      const opParams = Array.isArray(op.parameters) ? op.parameters.map(normalizeParam) : []
      const allParams = [...pathParams, ...opParams]
      const responses = op.responses && typeof op.responses === "object" ? op.responses : {}
      const successCodes = Object.keys(responses).filter((code) => /^2\d\d$/.test(code))
      map.set(key, {
        operationId: typeof op.operationId === "string" ? op.operationId : null,
        params: allParams,
        requestBodyRequired: Boolean(op?.requestBody?.required),
        successCodes,
      })
    }
  }
  return map
}

function indexParams(params) {
  const idx = new Map()
  for (const p of params) {
    idx.set(`${p.in}:${p.name}`, p)
  }
  return idx
}

function readMainSpec(specPath) {
  const gitPath = specPath.replace(/\\/g, "/")
  try {
    return run(`git show origin/main:${gitPath}`)
  } catch {
    run("git fetch origin main --depth=1")
    return run(`git show origin/main:${gitPath}`)
  }
}

function extractClientSurface(clientPath) {
  if (!fs.existsSync(clientPath)) return []
  const src = fs.readFileSync(clientPath, "utf8")
  const matches = [...src.matchAll(/^export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/gm)]
  return matches.map((m) => m[1])
}

const repoRoot = process.cwd()
const specPath = path.resolve(repoRoot, "contracts/openapi/api.yaml")
const clientPath = path.resolve(repoRoot, "apps/web/src/api-gen/client.ts")
const outDir = path.resolve(repoRoot, ".runtime-cache/artifacts/api")

if (!fs.existsSync(specPath)) {
  console.error(`[api-break] spec not found: ${specPath}`)
  process.exit(1)
}

const currentSpec = parseSpec(fs.readFileSync(specPath, "utf8"), "current spec")
const mainSpec = parseSpec(readMainSpec("contracts/openapi/api.yaml"), "origin/main spec")

const currentOps = toOperationMap(currentSpec)
const mainOps = toOperationMap(mainSpec)

const findings = []
for (const [key, base] of mainOps.entries()) {
  const next = currentOps.get(key)
  if (!next) {
    findings.push(`removed operation: ${key}`)
    continue
  }

  if (base.operationId && next.operationId && base.operationId !== next.operationId) {
    findings.push(`operationId changed for ${key}: ${base.operationId} -> ${next.operationId}`)
  }

  const baseParams = indexParams(base.params)
  const nextParams = indexParams(next.params)
  for (const [paramKey, baseParam] of baseParams.entries()) {
    const nextParam = nextParams.get(paramKey)
    if (!nextParam) {
      findings.push(`removed parameter for ${key}: ${paramKey}`)
      continue
    }
    if (!baseParam.required && nextParam.required) {
      findings.push(`parameter became required for ${key}: ${paramKey}`)
    }
  }

  if (!base.requestBodyRequired && next.requestBodyRequired) {
    findings.push(`requestBody became required for ${key}`)
  }

  for (const code of base.successCodes) {
    if (!next.successCodes.includes(code)) {
      findings.push(`removed success response for ${key}: HTTP ${code}`)
    }
  }
}

const clientFns = extractClientSurface(clientPath)
const opIds = [...currentOps.values()].map((o) => o.operationId).filter(Boolean)

fs.mkdirSync(outDir, { recursive: true })
const jsonOut = path.join(outDir, "api-breaking-report.json")
const mdOut = path.join(outDir, "client-surface-report.md")

const payload = {
  generatedAt: new Date().toISOString(),
  baseRef: "origin/main",
  specPath: "contracts/openapi/api.yaml",
  findings,
  summary: {
    baseOperations: mainOps.size,
    currentOperations: currentOps.size,
    clientExports: clientFns.length,
    currentOperationIds: opIds.length,
  },
  clientSurface: {
    file: "apps/web/src/api-gen/client.ts",
    exportedFunctions: clientFns,
    currentOperationIds: opIds,
  },
}

fs.writeFileSync(jsonOut, `${JSON.stringify(payload, null, 2)}\n`)

const md = [
  "# API Client Surface Report",
  "",
  `- Generated At: ${payload.generatedAt}`,
  `- Base Ref: ${payload.baseRef}`,
  `- OpenAPI: ${payload.specPath}`,
  `- Base Operations: ${payload.summary.baseOperations}`,
  `- Current Operations: ${payload.summary.currentOperations}`,
  `- Client Exports: ${payload.summary.clientExports}`,
  "",
  "## Client Exported Functions",
  ...(clientFns.length > 0 ? clientFns.map((n) => `- ${n}`) : ["- None"]),
  "",
  "## Breaking Findings",
  ...(findings.length > 0 ? findings.map((f) => `- ${f}`) : ["- None"]),
  "",
  `JSON report: ${jsonOut}`,
].join("\n")

fs.writeFileSync(mdOut, `${md}\n`)

console.log(`[api-break] wrote ${jsonOut}`)
console.log(`[api-break] wrote ${mdOut}`)

if (findings.length > 0) {
  console.error(`[api-break] breaking changes detected: ${findings.length}`)
  process.exit(1)
}

console.log("[api-break] no breaking changes detected")
