#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import {
  currentGovernanceArtifactPath,
  currentGovernanceArtifactRoot,
  governanceRunId,
  loadGovernanceControlPlane,
  readRepoText,
  repoRoot,
} from "./lib/governance-control-plane.mjs"

const failures = []
const { logSchema, runtimeRegistry } = loadGovernanceControlPlane()
const artifactRoot = path.join(repoRoot, currentGovernanceArtifactRoot())
fs.mkdirSync(artifactRoot, { recursive: true })
const runtimeOutputById = new Map((runtimeRegistry.toolOutputs ?? []).map((output) => [output.id, output]))
const subprocessEnv = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE || "1",
  PROJECT_PYTHON_ENV:
    process.env.PROJECT_PYTHON_ENV ||
    process.env.UV_PROJECT_ENVIRONMENT ||
    path.join(repoRoot, ".runtime-cache/toolchains/python/.venv"),
  UV_PROJECT_ENVIRONMENT:
    process.env.UV_PROJECT_ENVIRONMENT ||
    process.env.PROJECT_PYTHON_ENV ||
    path.join(repoRoot, ".runtime-cache/toolchains/python/.venv"),
}

const backendSample = emitBackendSample()
const mcpSample = emitMcpSample()
const entrypointSample = emitEntrypointSample()
const universalAuditSample = emitUniversalAuditSample()
const vonageAuditSample = emitVonageAuditSample()

const backendValidation = validateLogEvent(backendSample, "backend")
const mcpValidation = validateLogEvent(mcpSample.payload, "mcp")
const universalAuditValidation = validateLogEvent(universalAuditSample.payload, "universal-audit")
const vonageAuditValidation = validateLogEvent(vonageAuditSample.payload, "vonage-audit")
const entrypointValidation = validateEntrypointSample(entrypointSample)
const mcpRegistryValidation = validateRegistryOwnership({
  source: "mcp-audit",
  outputId: "mcp-audit-log",
  expectedOwner: "apps/mcp-server/src/core/io.ts",
  expectedPath: ".runtime-cache/logs/audit/mcp-audit.jsonl",
  expectedKind: "audit-log",
  expectedContract: "audit-log",
  actualRuntimePath: mcpSample.runtimePath,
})
const universalAuditRegistryValidation = validateRegistryOwnership({
  source: "universal-audit",
  outputId: "universal-platform-audit-log",
  expectedOwner: "apps/api/app/services/universal_platform_service.py",
  expectedPath: ".runtime-cache/automation/universal/audit.jsonl",
  expectedKind: "audit-log",
  expectedContract: "append-only-audit",
  actualRuntimePath: universalAuditSample.runtimePath,
})
const vonageAuditRegistryValidation = validateRegistryOwnership({
  source: "vonage-audit",
  outputId: "vonage-callback-audit-log",
  expectedOwner: "apps/api/app/services/vonage_inbox.py",
  expectedPath: ".runtime-cache/automation/vonage/callback-audit.jsonl",
  expectedKind: "audit-log",
  expectedContract: "append-only-audit",
  actualRuntimePath: vonageAuditSample.runtimePath,
})

writeSample("log-contract-backend.sample.json", backendSample, backendValidation)
writeSample("log-contract-mcp.sample.json", mcpSample, mcpValidation, mcpRegistryValidation)
writeSample(
  "log-contract-universal-audit.sample.json",
  universalAuditSample,
  universalAuditValidation,
  universalAuditRegistryValidation
)
writeSample(
  "log-contract-vonage-audit.sample.json",
  vonageAuditSample,
  vonageAuditValidation,
  vonageAuditRegistryValidation
)
writeSample("log-contract-entrypoint.sample.json", entrypointSample, entrypointValidation)

const loggingPolicy = readRepoText("docs/reference/public-surface-sanitization-policy.md")
for (const token of [
  "docs/reference/generated/governance/log-event-schema.md",
  "docs/reference/generated/governance/runtime-output-registry.md",
]) {
  if (!loggingPolicy.includes(token)) {
    failures.push(`logging policy missing generated-governance reference: ${token}`)
  }
}

for (const requiredOutput of [
  {
    id: "universal-platform-audit-log",
    owner: "apps/api/app/services/universal_platform_service.py",
    paths: [".runtime-cache/automation/universal/audit.jsonl"],
  },
  {
    id: "vonage-callback-audit-log",
    owner: "apps/api/app/services/vonage_inbox.py",
    paths: [".runtime-cache/automation/vonage/callback-audit.jsonl"],
  },
]) {
  const registryOutput = runtimeRegistry.toolOutputs.find((item) => item.id === requiredOutput.id)
  if (!registryOutput) {
    failures.push(`runtime-output-registry missing required audit output: ${requiredOutput.id}`)
    continue
  }
  if (registryOutput.owner !== requiredOutput.owner) {
    failures.push(
      `runtime-output-registry owner mismatch for ${requiredOutput.id}: expected ${requiredOutput.owner}, got ${registryOutput.owner}`
    )
  }
  for (const expectedPath of requiredOutput.paths) {
    if (!(registryOutput.paths ?? []).includes(expectedPath)) {
      failures.push(
        `runtime-output-registry path mismatch for ${requiredOutput.id}: missing ${expectedPath}`
      )
    }
  }
}

if (failures.length > 0) {
  console.error("[log-governance] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[log-governance] ok (run_id=${governanceRunId})`)

function writeSample(fileName, sample, validation, registryValidation = null) {
  const abs = path.join(artifactRoot, fileName)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const payload = sample?.payload ?? sample
  const errors = [...validation.errors, ...(registryValidation?.errors ?? [])]
  const valid = validation.valid && (registryValidation?.valid ?? true)
  fs.writeFileSync(
    abs,
    `${JSON.stringify(
      {
        run_id: governanceRunId,
        valid,
        errors,
        payload,
        runtime_path: sample?.runtimePath ?? null,
        registry_contract: registryValidation?.details ?? null,
      },
      null,
      2
    )}\n`,
    "utf8"
  )
  if (!valid) {
    failures.push(...errors.map((error) => `${fileName}: ${error}`))
  }
}

function emitBackendSample() {
  const managedPythonExecutable = path.join(
    subprocessEnv.PROJECT_PYTHON_ENV,
    "bin/python"
  )
  ensureManagedPythonExecutable(managedPythonExecutable)
  const pythonExecutable = fs.existsSync(managedPythonExecutable)
    ? managedPythonExecutable
    : "python3"
  const code = `
import json, logging
from apps.api.app.core.observability import JsonFormatter, REQUEST_ID_CTX
token = REQUEST_ID_CTX.set("req-backend")
try:
    record = logging.LogRecord("backend.governance", logging.INFO, "governance-sample.py", 1, "backend governance sample", (), None)
    record.event_code = "governance.backend.sample"
    record.component = "backend"
    record.channel = "backend.runtime"
    record.kind = "runtime"
    record.run_id = "${governanceRunId}"
    record.trace_id = "trace-backend"
    record.request_id = "req-backend"
    record.redaction_state = "secret-free"
    record.status_code = 200
    payload = json.loads(JsonFormatter().format(record))
    print(json.dumps(payload))
finally:
    REQUEST_ID_CTX.reset(token)
`
  return JSON.parse(
    execFileSync(pythonExecutable, ["-c", code], {
      cwd: repoRoot,
      encoding: "utf8",
      env: subprocessEnv,
    }).trim()
  )
}

function ensureManagedPythonExecutable(managedPythonExecutable) {
  if (fs.existsSync(managedPythonExecutable)) return
  const envRoot = path.dirname(path.dirname(managedPythonExecutable))
  if (fs.existsSync(envRoot)) {
    fs.rmSync(envRoot, { recursive: true, force: true })
  }
  execFileSync(
    "uv",
    ["sync", "--frozen", "--extra", "dev"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: subprocessEnv,
      stdio: "pipe",
    }
  )
}

function resolveManagedPythonExecutable() {
  const managedPythonExecutable = path.join(
    subprocessEnv.PROJECT_PYTHON_ENV,
    "bin/python"
  )
  ensureManagedPythonExecutable(managedPythonExecutable)
  return fs.existsSync(managedPythonExecutable) ? managedPythonExecutable : "python3"
}

function emitMcpSample() {
  const tempRuntimeRoot = path.join(artifactRoot, "mcp-runtime")
  fs.mkdirSync(tempRuntimeRoot, { recursive: true })
  const output = execFileSync(
    "node",
    [
      "--input-type=module",
      "--import",
      "tsx",
      "-e",
      `
        import { readFileSync } from "node:fs";
        import { auditLogPath, writeAudit } from "./apps/mcp-server/src/core/io.ts";
        process.env.UIQ_MCP_WORKSPACE_ROOT = process.cwd();
        process.env.UIQ_MCP_RUNTIME_CACHE_ROOT = ${JSON.stringify(tempRuntimeRoot)};
        process.env.UIQ_GOVERNANCE_RUN_ID = ${JSON.stringify(governanceRunId)};
        writeAudit({
          type: "governance.mcp.sample",
          ok: true,
          detail: "mcp governance sample",
          meta: { probe: true },
          component: "mcp-server",
          channel: "mcp.audit",
          kind: "audit",
          redactionState: "secret-free",
        });
        const runtimePath = auditLogPath();
        const lines = readFileSync(runtimePath, "utf8").trim().split("\\n");
        console.log(JSON.stringify({ payload: JSON.parse(lines[lines.length - 1]), runtime_path: runtimePath }));
      `,
    ],
    { cwd: repoRoot, encoding: "utf8", env: subprocessEnv }
  )
  return normalizeEmittedSample(JSON.parse(output.trim()), tempRuntimeRoot)
}

function emitUniversalAuditSample() {
  const tempRuntimeRoot = path.join(artifactRoot, "universal-runtime")
  const automationRuntimeRoot = path.join(tempRuntimeRoot, "automation")
  const universalDataRoot = path.join(automationRuntimeRoot, "universal")
  fs.mkdirSync(tempRuntimeRoot, { recursive: true })
  const pythonExecutable = resolveManagedPythonExecutable()
  const output = execFileSync(
    pythonExecutable,
    [
      "-c",
      `
import json
import os
from apps.api.app.services.universal_platform_service import UniversalPlatformService

os.environ["UIQ_RUNTIME_CACHE_ROOT"] = ${JSON.stringify(tempRuntimeRoot)}
os.environ["UNIVERSAL_AUTOMATION_RUNTIME_DIR"] = ${JSON.stringify(automationRuntimeRoot)}
os.environ["UNIVERSAL_PLATFORM_DATA_DIR"] = ${JSON.stringify(universalDataRoot)}

service = UniversalPlatformService()
service._audit("governance.sample", "tester", {"run_id": "${governanceRunId}", "secret": "value"})
line = service._audit_path.read_text(encoding="utf-8").strip().split("\\n")[-1]
print(json.dumps({"payload": json.loads(line), "runtime_path": str(service._audit_path.resolve())}))
      `,
    ],
    { cwd: repoRoot, encoding: "utf8", env: subprocessEnv }
  )
  return normalizeEmittedSample(JSON.parse(output.trim()), tempRuntimeRoot)
}

function emitVonageAuditSample() {
  const tempRuntimeRoot = path.join(artifactRoot, "vonage-runtime")
  fs.mkdirSync(tempRuntimeRoot, { recursive: true })
  const pythonExecutable = resolveManagedPythonExecutable()
  const output = execFileSync(
    pythonExecutable,
    [
      "-c",
      `
import json
import os
from apps.api.app.services.vonage_inbox import VonageInboxService

os.environ["UIQ_RUNTIME_CACHE_ROOT"] = ${JSON.stringify(tempRuntimeRoot)}
os.environ["UNIVERSAL_AUTOMATION_RUNTIME_DIR"] = ${JSON.stringify(path.join(tempRuntimeRoot, "automation"))}

service = VonageInboxService()
service.append_audit(status="ok", reason="governance.sample", payload={"messageId": "mid-1", "msisdn": "+15550001111", "to": "+15559990000"})
line = service._audit_path.read_text(encoding="utf-8").strip().split("\\n")[-1]
print(json.dumps({"payload": json.loads(line), "runtime_path": str(service._audit_path.resolve())}))
      `,
    ],
    { cwd: repoRoot, encoding: "utf8", env: subprocessEnv }
  )
  return normalizeEmittedSample(JSON.parse(output.trim()), tempRuntimeRoot)
}

function emitEntrypointSample() {
  const backendLogPath = path.join(repoRoot, ".runtime-cache/logs/runtime/apps.api.app.log")
  const frontendLogPath = path.join(repoRoot, ".runtime-cache/logs/runtime/frontend.dev.log")
  try {
    try {
      execFileSync("bash", ["scripts/dev-up.sh"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe",
        env: subprocessEnv,
      })
    } catch (error) {
      if (!frontendLogEventuallyLooksReady(frontendLogPath)) {
        throw error
      }
    }
    const backendLines = fs.readFileSync(backendLogPath, "utf8").trim().split("\n").filter(Boolean)
    let backendPayload = null
    for (const line of backendLines.toReversed()) {
      try {
        backendPayload = JSON.parse(line)
        break
      } catch {
        continue
      }
    }
    return {
      backend: backendPayload ?? {},
      frontend_log_present: fs.existsSync(frontendLogPath) && fs.statSync(frontendLogPath).size > 0,
    }
  } finally {
    try {
      execFileSync("bash", ["scripts/dev-down.sh"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe",
        env: subprocessEnv,
      })
    } catch {
      // best-effort cleanup
    }
  }
}

function frontendLogLooksReady(frontendLogPath) {
  if (!fs.existsSync(frontendLogPath)) return false
  const logText = fs.readFileSync(frontendLogPath, "utf8")
  return /Local:\s+http:\/\/127\.0\.0\.1:\d+\/|ready in\s+\d+\s*ms/i.test(logText)
}

function frontendLogEventuallyLooksReady(frontendLogPath) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (frontendLogLooksReady(frontendLogPath)) {
      return true
    }
    sleepMs(250)
  }
  return false
}

function sleepMs(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs)
}

function normalizeEmittedSample(sample, runtimeRootOverride = null) {
  return {
    payload: sample?.payload ?? sample,
    runtimePath: normalizeRuntimePath(sample?.runtime_path, runtimeRootOverride),
  }
}

function normalizeRuntimePath(rawPath, runtimeRootOverride = null) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") return null
  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.join(repoRoot, rawPath)
  if (runtimeRootOverride) {
    const absoluteRuntimeRoot = path.resolve(runtimeRootOverride)
    const relativeToRuntimeRoot = path.relative(absoluteRuntimeRoot, absolutePath)
    if (
      relativeToRuntimeRoot !== "" &&
      !relativeToRuntimeRoot.startsWith("..") &&
      !path.isAbsolute(relativeToRuntimeRoot)
    ) {
      return path.posix.join(runtimeRegistry.runtimeRoot, relativeToRuntimeRoot.replaceAll(path.sep, "/"))
    }
  }
  return path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/")
}

function validateLogEvent(payload, source) {
  const errors = []
  for (const required of logSchema.required ?? []) {
    if (!(required in payload)) errors.push(`${source} missing required field: ${required}`)
  }
  if (logSchema.additionalProperties === false) {
    for (const key of Object.keys(payload)) {
      if (!logSchema.properties[key]) errors.push(`${source} contains unsupported field: ${key}`)
    }
  }
  for (const [key, definition] of Object.entries(logSchema.properties ?? {})) {
    if (!(key in payload)) continue
    const value = payload[key]
    const types = Array.isArray(definition.type) ? definition.type : [definition.type]
    const typeMatches = types.some((expected) => {
      if (expected === "null") return value === null
      if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value)
      return typeof value === expected
    })
    if (!typeMatches) errors.push(`${source} field ${key} has wrong type`)
    if (definition.enum && !definition.enum.includes(value)) errors.push(`${source} field ${key} has unsupported enum value: ${value}`)
    if (key === "timestamp" && typeof value === "string" && !value.includes("T")) {
      errors.push(`${source} timestamp is not ISO-like`)
    }
  }
  return { valid: errors.length === 0, errors }
}

function validateRegistryOwnership({
  source,
  outputId,
  expectedOwner,
  expectedPath,
  expectedKind,
  expectedContract,
  actualRuntimePath,
}) {
  const errors = []
  const runtimeOutput = runtimeOutputById.get(outputId)
  if (!runtimeOutput) {
    return {
      valid: false,
      errors: [`${source} missing runtime-output-registry entry: ${outputId}`],
      details: null,
    }
  }
  if (runtimeOutput.owner !== expectedOwner) {
    errors.push(`${source} registry owner mismatch: expected ${expectedOwner}, got ${runtimeOutput.owner}`)
  }
  if (runtimeOutput.kind !== expectedKind) {
    errors.push(`${source} registry kind mismatch: expected ${expectedKind}, got ${runtimeOutput.kind}`)
  }
  if (!(runtimeOutput.paths ?? []).includes(expectedPath)) {
    errors.push(`${source} registry path mismatch: missing ${expectedPath}`)
  }
  if (actualRuntimePath) {
    const expectedTail = expectedPath.replace(`${runtimeRegistry.runtimeRoot}/`, "")
    if (
      actualRuntimePath !== expectedPath &&
      !actualRuntimePath.endsWith(expectedTail)
    ) {
      errors.push(`${source} emitted runtime path mismatch: expected ${expectedPath}, got ${actualRuntimePath}`)
    }
  }
  if (expectedContract === "append-only-audit") {
    if (!expectedPath.startsWith(`${runtimeRegistry.runtimeRoot}/automation/`)) {
      errors.push(
        `${source} append-only audit must live under ${runtimeRegistry.runtimeRoot}/automation/: ${expectedPath}`
      )
    }
    if (runtimeOutput.kind !== "audit-log") {
      errors.push(`${source} append-only audit must stay classified as audit-log`)
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    details: {
      id: runtimeOutput.id,
      owner: runtimeOutput.owner,
      kind: runtimeOutput.kind,
      expected_contract: expectedContract,
      registered_paths: runtimeOutput.paths ?? [],
      emitted_runtime_path: actualRuntimePath,
    },
  }
}

function validateEntrypointSample(payload) {
  const errors = []
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["entrypoint sample missing payload"] }
  }
  if (!payload.frontend_log_present) {
    errors.push("entrypoint sample missing non-empty frontend dev log")
  }
  const backendValidation = validateLogEvent(payload.backend ?? {}, "entrypoint-backend")
  errors.push(...backendValidation.errors)
  return { valid: errors.length === 0, errors }
}
