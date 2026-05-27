#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import YAML from "yaml"

const DEFAULT_VALUE_CHECKS = [
  {
    key: "AUTOMATION_MAX_PARALLEL",
    baseline: "8",
  },
  {
    key: "CACHE_TTL_SECONDS",
    baseline: "3600",
  },
  {
    key: "CACHE_MAX_ENTRIES",
    baseline: "2000",
  },
  {
    key: "UIQ_TEST_LOG_DIR",
    baseline: ".runtime-cache/artifacts/ci/test-matrix",
    script: {
      path: "scripts/test-matrix.sh",
      pattern: /LOG_BASE="\$\{UIQ_TEST_LOG_DIR:-([^"]+)\}"/,
    },
    docsPath: "docs/reference/configuration.md",
  },
]

function normalizeDefault(value) {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "true" : "false"
  return String(value).trim()
}

function loadContractDefaults(contractPathInput) {
  const contractPath = resolve(contractPathInput)
  const contract = YAML.parse(readFileSync(contractPath, "utf8"))
  if (!contract || typeof contract !== "object" || !Array.isArray(contract.variables)) {
    throw new Error(`invalid contract file: ${contractPathInput}`)
  }
  const defaults = new Map()
  for (const variable of contract.variables) {
    if (!variable || typeof variable !== "object") continue
    const name = String(variable.name || "").trim()
    if (!name) continue
    defaults.set(name, normalizeDefault(variable.default))
  }
  return defaults
}

function loadEnvExampleDefaults(envPathInput) {
  const envPath = resolve(envPathInput)
  const content = readFileSync(envPath, "utf8")
  const defaults = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue
    defaults.set(key, value)
  }
  return defaults
}

function loadDocsDefaults(docPathInput) {
  const docPath = resolve(docPathInput)
  const content = readFileSync(docPath, "utf8")
  const defaults = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine.startsWith("|")) continue
    const parts = rawLine.split("|").map((part) => part.trim())
    if (parts.length < 7) continue
    const key = parts[1]?.replaceAll("`", "").trim()
    const defaultValue = parts[5]?.replaceAll("`", "").trim()
    if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key)) continue
    defaults.set(key, defaultValue ?? "")
  }
  return defaults
}

function loadScriptDefault(scriptConfig) {
  const scriptPath = resolve(scriptConfig.path)
  const content = readFileSync(scriptPath, "utf8")
  const match = content.match(scriptConfig.pattern)
  if (!match) {
    throw new Error(`missing script default pattern in ${scriptConfig.path}`)
  }
  return String(match[1] ?? "").trim()
}

function main() {
  const contractDefaults = loadContractDefaults("configs/env/contract.yaml")
  const envDefaults = loadEnvExampleDefaults(".env.example")
  const docsDefaults = loadDocsDefaults("docs/reference/configuration.md")

  const errors = []
  for (const check of DEFAULT_VALUE_CHECKS) {
    const key = check.key
    const baselineValue = check.baseline
    const contractValue = contractDefaults.get(key)
    const envValue = envDefaults.get(key)
    if (contractValue === undefined) {
      errors.push(`missing in configs/env/contract.yaml: ${key}`)
      continue
    }
    if (envValue === undefined) {
      errors.push(`missing in .env.example: ${key}`)
      continue
    }
    if (contractValue !== envValue) {
      errors.push(
        `${key} mismatch between contract (${contractValue}) and .env.example (${envValue})`
      )
    }
    if (contractValue !== baselineValue) {
      errors.push(
        `${key} drifted from baseline in contract: expected ${baselineValue}, got ${contractValue}`
      )
    }
    if (envValue !== baselineValue) {
      errors.push(
        `${key} drifted from baseline in .env.example: expected ${baselineValue}, got ${envValue}`
      )
    }
    if (check.docsPath) {
      const docsValue = docsDefaults.get(key)
      if (docsValue === undefined) {
        errors.push(`missing in ${check.docsPath}: ${key}`)
      } else if (docsValue !== baselineValue) {
        errors.push(`${key} drifted from baseline in ${check.docsPath}: expected ${baselineValue}, got ${docsValue}`)
      }
    }
    if (check.script) {
      const scriptValue = loadScriptDefault(check.script)
      if (scriptValue !== baselineValue) {
        errors.push(`${key} drifted from script baseline in ${check.script.path}: expected ${baselineValue}, got ${scriptValue}`)
      }
    }
  }

  if (errors.length > 0) {
    console.error("[config-drift] FAILED")
    for (const item of errors) {
      console.error(`- ${item}`)
    }
    process.exit(1)
  }

  console.log("[config-drift] PASS")
  console.log(`[config-drift] checked keys: ${DEFAULT_VALUE_CHECKS.map((item) => item.key).join(", ")}`)
}

main()
