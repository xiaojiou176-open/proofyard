#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const TARGET_VERSION = "1.42.0"

const files = {
  pyproject: path.join(ROOT, "pyproject.toml"),
  requirements: path.join(ROOT, "scripts/computer-use/requirements.txt"),
  uvLock: path.join(ROOT, "uv.lock"),
  packageJson: path.join(ROOT, "apps/automation-runner/package.json"),
  pnpmLock: path.join(ROOT, "pnpm-lock.yaml"),
}

const read = (file) => fs.readFileSync(file, "utf8")

const errors = []

const pyprojectText = read(files.pyproject)
const pyprojectMatch = pyprojectText.match(/"google-genai([^"]*)"/)
if (!pyprojectMatch) {
  errors.push("pyproject.toml is missing a google-genai declaration")
} else {
  const spec = pyprojectMatch[1]
  if (spec !== `==${TARGET_VERSION}`) {
    errors.push(`pyproject.toml expects google-genai==${TARGET_VERSION}, found google-genai${spec}`)
  }
}

const requirementsText = read(files.requirements)
const requirementsMatch = requirementsText.match(/^google-genai([^\s#]*)/m)
if (!requirementsMatch) {
  errors.push("scripts/computer-use/requirements.txt is missing a google-genai declaration")
} else {
  const spec = requirementsMatch[1]
  if (spec !== `==${TARGET_VERSION}`) {
    errors.push(`requirements.txt expects google-genai==${TARGET_VERSION}, found google-genai${spec}`)
  }
}

const uvLockText = read(files.uvLock)
const uvSpecifierMatch = uvLockText.match(
  /\{ name = "google-genai", marker = "extra == 'dev'", specifier = "([^"]+)" \}/
)
if (!uvSpecifierMatch) {
  errors.push("uv.lock is missing the google-genai dev specifier entry")
} else {
  const uvSpecifier = uvSpecifierMatch[1]
  if (uvSpecifier !== `==${TARGET_VERSION}`) {
    errors.push(`uv.lock specifier expects ==${TARGET_VERSION}, found ${uvSpecifier}`)
  }
}

const uvVersionMatch = uvLockText.match(
  /\[\[package\]\]\nname = "google-genai"\nversion = "([^"]+)"/
)
if (!uvVersionMatch) {
  errors.push("uv.lock is missing the pinned google-genai version")
} else {
  const uvVersion = uvVersionMatch[1]
  if (uvVersion !== TARGET_VERSION) {
    errors.push(`uv.lock pinned version expects ${TARGET_VERSION}, found ${uvVersion}`)
  }
}

const packageJson = JSON.parse(read(files.packageJson))
const nodeSpec = packageJson?.devDependencies?.["@google/genai"]
if (!nodeSpec) {
  errors.push("apps/automation-runner/package.json is missing devDependencies.@google/genai")
} else if (nodeSpec !== TARGET_VERSION) {
  errors.push(`apps/automation-runner/package.json expects @google/genai ${TARGET_VERSION}, found ${nodeSpec}`)
}

const pnpmLockLines = read(files.pnpmLock).split("\n")
let inAutomationImporter = false
let inGeminiDep = false
let lockSpecifier = ""
let lockVersion = ""

for (const line of pnpmLockLines) {
  if (/^  automation:\s*$/.test(line) || /^  automation\/package\.json:\s*$/.test(line)) {
    inAutomationImporter = true
    inGeminiDep = false
    continue
  }
  if (inAutomationImporter && /^  [^ ].*:\s*$/.test(line)) {
    break
  }
  if (!inAutomationImporter) {
    continue
  }
  if (/^      '@google\/genai':\s*$/.test(line)) {
    inGeminiDep = true
    continue
  }
  if (inGeminiDep && /^      [^ ].*:\s*$/.test(line)) {
    inGeminiDep = false
  }
  if (!inGeminiDep) {
    continue
  }
  const specifierMatch = line.match(/^\s+specifier:\s+(.+)$/)
  if (specifierMatch) {
    lockSpecifier = specifierMatch[1].trim()
  }
  const versionMatch = line.match(/^\s+version:\s+(.+)$/)
  if (versionMatch) {
    lockVersion = versionMatch[1].trim()
  }
}

if (!lockSpecifier || !lockVersion) {
  errors.push("pnpm-lock.yaml is missing the @google/genai entry under the automation importer")
} else {
  if (lockSpecifier !== TARGET_VERSION) {
    errors.push(`pnpm-lock.yaml specifier expects ${TARGET_VERSION}, found ${lockSpecifier}`)
  }
  if (!lockVersion.startsWith(`${TARGET_VERSION}`)) {
    errors.push(`pnpm-lock.yaml version should start with ${TARGET_VERSION}, found ${lockVersion}`)
  }
}

if (errors.length > 0) {
  console.error("[gemini-sdk-check] version consistency check failed:")
  for (const err of errors) {
    console.error(`- ${err}`)
  }
  process.exit(1)
}

console.log(`[gemini-sdk-check] OK: Python and Node Gemini SDK versions are pinned to ${TARGET_VERSION}`)
