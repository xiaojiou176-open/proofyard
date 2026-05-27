#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const ROOT_DIR = process.cwd()
const PACKAGE_JSON_PATHS = [
  "package.json",
  "apps/web/package.json",
  "apps/automation-runner/package.json",
  "apps/mcp-server/package.json",
  "packages/ui/package.json",
  "packages/ai-prompts/package.json",
]
const DISALLOWED_CHILD_LOCKS = ["apps/web/pnpm-lock.yaml", "apps/mcp-server/pnpm-lock.yaml"]
const DOCKERFILES = ["docker/ci/Dockerfile", "apps/api/Dockerfile", "apps/web/Dockerfile"]
const COMPOSE_FILES = ["docker-compose.yml"]
const RANGE_PATTERN =
  /(^|[\s(])(?:\^|~|>=|<=|>|<|\*|x\b|workspace:|\d+\s*-\s*\d+|\|\|)(?=[^\s)]*)/

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT_DIR, relativePath))
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8")
}

function parseJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function parsePyprojectDeps(text) {
  return [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

function isExactVersion(spec) {
  if (spec.startsWith("workspace:")) return true
  if (spec.startsWith("file:") || spec.startsWith("link:")) return true
  if (spec.startsWith("git+")) return true
  return !RANGE_PATTERN.test(spec)
}

const errors = []

if (!exists("package.json")) {
  errors.push("missing root package.json")
} else {
  const rootPkg = parseJson("package.json")
  const packageManager = String(rootPkg.packageManager || "")
  if (!packageManager.startsWith("pnpm@")) {
    errors.push(`root packageManager must start with 'pnpm@', got '${packageManager || "(empty)"}'`)
  }
}

if (!exists("pnpm-lock.yaml")) {
  errors.push("missing root pnpm-lock.yaml")
} else {
  const lockText = read("pnpm-lock.yaml")
  if (!/\nimporters:\s*\n/m.test(lockText)) {
    errors.push("root pnpm-lock.yaml missing importers section")
  }
  for (const importer of [".", "apps/web", "apps/automation-runner", "apps/mcp-server", "packages/ui"]) {
    if (!new RegExp(`\\n\\s{2}${importer.replace("/", "\\/")}:\\s*\\n`).test(lockText)) {
      errors.push(`root pnpm-lock.yaml missing importer '${importer}'`)
    }
  }
}

for (const childLock of DISALLOWED_CHILD_LOCKS) {
  if (exists(childLock)) {
    errors.push(`unexpected child pnpm lockfile found: ${childLock}`)
  }
}

for (const relativePath of PACKAGE_JSON_PATHS) {
  if (!exists(relativePath)) {
    errors.push(`missing package.json: ${relativePath}`)
    continue
  }
  const pkg = parseJson(relativePath)
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const section = pkg[sectionName] || {}
    for (const [name, spec] of Object.entries(section)) {
      if (!isExactVersion(String(spec))) {
        errors.push(`${relativePath} ${sectionName}.${name} must be pinned exactly, got '${spec}'`)
      }
    }
  }
}

if (!exists("pyproject.toml")) {
  errors.push("missing pyproject.toml")
} else {
  const pyprojectText = read("pyproject.toml")
  const dependenciesBlock = pyprojectText.match(/dependencies = \[(.*?)\]/s)
  const devBlock = pyprojectText.match(/dev = \[(.*?)\]/s)
  for (const block of [dependenciesBlock?.[1], devBlock?.[1]]) {
    if (!block) continue
    for (const spec of parsePyprojectDeps(block)) {
      if (!isExactVersion(spec)) {
        errors.push(`pyproject.toml dependency must be pinned exactly, got '${spec}'`)
      }
    }
  }
}

if (!exists("uv.lock")) {
  errors.push("missing uv.lock")
}

if (!exists("configs/ci/runtime.lock.json")) {
  errors.push("missing configs/ci/runtime.lock.json")
} else {
  const runtimeLock = parseJson("configs/ci/runtime.lock.json")
  if (runtimeLock.platform !== "linux/amd64") {
    errors.push(`runtime lock platform must be linux/amd64, got '${runtimeLock.platform}'`)
  }
  for (const [name, image] of Object.entries(runtimeLock.base_images || {})) {
    const reference = String(image?.reference || "")
    if (!reference.includes("@sha256:")) {
      errors.push(`runtime lock base_images.${name}.reference must be digest-pinned, got '${reference}'`)
    }
  }
}

for (const relativePath of [...DOCKERFILES, ...COMPOSE_FILES]) {
  if (!exists(relativePath)) continue
  const text = read(relativePath)
  if (relativePath.endsWith("Dockerfile")) {
    for (const match of text.matchAll(/^FROM\s+([^\s]+)$/gm)) {
      if (!match[1].includes("@sha256:") && !match[1].startsWith("${")) {
        errors.push(`${relativePath} contains non-digest FROM reference '${match[1]}'`)
      }
    }
    continue
  }
  for (const match of text.matchAll(/image:\s+([^\s]+)/g)) {
    if (!match[1].includes("@sha256:") && !match[1].includes("${")) {
      errors.push(`${relativePath} contains non-digest image reference '${match[1]}'`)
    }
  }
}

if (errors.length > 0) {
  console.error("lockfile sync check failed:")
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log("lockfile sync check passed.")
console.log("- root pnpm lockfile present with unified workspace importers")
console.log("- no disallowed child pnpm lockfiles found")
console.log("- package.json and pyproject direct dependencies are exact")
console.log("- runtime lock and Docker image references are digest-pinned")
