#!/usr/bin/env node

import fs from "node:fs"
import { resolve } from "node:path"
import yaml from "yaml"

const repoRoot = resolve(".")
const rootPackage = JSON.parse(fs.readFileSync(resolve(repoRoot, "package.json"), "utf8"))

const skillDir = resolve(repoRoot, "skills/webaudit-mcp")
const skillPath = resolve(skillDir, "SKILL.md")
const manifestPath = resolve(skillDir, "manifest.yaml")

const failures = []

function expectFile(path, label) {
  if (!fs.existsSync(path)) {
    failures.push(`missing ${label}: ${path}`)
    return ""
  }
  return fs.readFileSync(path, "utf8")
}

const skillText = expectFile(skillPath, "skill doc")
const manifestText = expectFile(manifestPath, "skill manifest")
const manifest = manifestText ? yaml.parse(manifestText) : null

if (manifest) {
  const requiredScalarFields = ["name", "version", "description", "protocol", "transport", "auth"]
  for (const field of requiredScalarFields) {
    if (typeof manifest[field] !== "string" || manifest[field].trim().length === 0) {
      failures.push(`manifest missing non-empty string field: ${field}`)
    }
  }

  if (manifest.name !== "webaudit-mcp") {
    failures.push(`manifest name must be webaudit-mcp, got: ${JSON.stringify(manifest.name)}`)
  }
  if (manifest.version !== rootPackage.version) {
    failures.push(
      `manifest version must match root package version ${rootPackage.version}, got: ${JSON.stringify(manifest.version)}`
    )
  }
  if (manifest.protocol !== "stdio" || manifest.transport !== "stdio") {
    failures.push("manifest protocol/transport must both be stdio")
  }
  if (manifest.auth !== "local-with-optional-backend-token") {
    failures.push(
      `manifest auth must be local-with-optional-backend-token, got: ${JSON.stringify(manifest.auth)}`
    )
  }

  const listFields = ["surfaces", "supported_shells", "install_modes", "docs", "limitations"]
  for (const field of listFields) {
    if (!Array.isArray(manifest[field]) || manifest[field].length === 0) {
      failures.push(`manifest must include a non-empty ${field} list`)
    }
  }
}

if (skillText) {
  const requiredPhrases = [
    "Webaudit",
    "stdio",
    "local-with-optional-backend-token",
    "Current / usable today",
    "Publish-ready but not yet published",
    "@webaudit/mcp-server",
    "pnpm mcp:start",
    "not an official plugin",
    "not a hosted service",
    "not yet published",
  ]

  for (const phrase of requiredPhrases) {
    if (!skillText.includes(phrase)) {
      failures.push(`skill doc missing phrase: ${phrase}`)
    }
  }
}

if (failures.length > 0) {
  console.error("[skill-surface-contract] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[skill-surface-contract] ok")
