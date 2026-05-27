import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "../..")
const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node scripts/ci/e2e-authenticity-gate.mjs [--help]

Environment variables:
  E2E_STUB_NONSTUB_MAX_RATIO            Max stub/non-stub ratio (default: 4)
  E2E_COUNTERFACTUAL_REQUIRED_DIRS      Comma-separated spec directories to enforce (default: tests/frontend-e2e,apps/web/tests/e2e)
  E2E_COUNTERFACTUAL_REQUIRED_TAG       Required tag for counterfactual canary specs (default: @counterfactual)
  E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR  Minimum tagged specs per required dir (default: 1)
`)
  process.exit(0)
}

const requiredNonStubSpecs = [
  "tests/frontend-e2e/non-stub-core-flow.spec.ts",
  "apps/web/tests/e2e/non-stub-core-flow.spec.ts",
]
const criticalSpecs = [
  "tests/frontend-e2e/first-use-guardrails.spec.ts",
  "tests/frontend-e2e/critical-buttons.spec.ts",
]
const frontendE2eDirs = ["tests/frontend-e2e", "apps/web/tests/e2e"]
const ratioCheckDirs = [...frontendE2eDirs]
const stubToNonStubMaxRatio = Number.parseFloat(process.env.E2E_STUB_NONSTUB_MAX_RATIO ?? "4")
const counterfactualRequiredDirs = (
  process.env.E2E_COUNTERFACTUAL_REQUIRED_DIRS ?? "tests/frontend-e2e,apps/web/tests/e2e"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
const counterfactualRequiredTag = (process.env.E2E_COUNTERFACTUAL_REQUIRED_TAG ?? "@counterfactual").trim()
const counterfactualMinFilesPerDirRaw = process.env.E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR ?? "1"
const counterfactualMinFilesPerDir = Number.parseInt(counterfactualMinFilesPerDirRaw, 10)
const nonStubScriptName = "test:e2e:frontend:nonstub"
const criticalScriptName = "test:e2e:frontend:critical"
const PLAYWRIGHT_SKIP_CALL_PATTERN = /\b(?:test|it|describe|pwTest)\.skip\s*\(/
const PLAYWRIGHT_ONLY_CALL_PATTERN = /\b(?:test|it|describe|pwTest)\.only\s*\(|\b(?:fit|fdescribe)\s*\(/

function collectMatches(content, pattern) {
  const matches = []
  let match = pattern.exec(content)
  while (match) {
    matches.push(match)
    match = pattern.exec(content)
  }
  return matches
}

async function read(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  return fs.readFile(absolutePath, "utf8")
}

async function listSpecFiles(relativeDir) {
  const root = path.join(repoRoot, relativeDir)
  const files = []

  async function walk(currentDir, relativePrefix = "") {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const nextPrefix = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name
      const nextAbsolute = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await walk(nextAbsolute, nextPrefix)
        continue
      }

      if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
        files.push(path.posix.join(relativeDir, nextPrefix))
      }
    }
  }

  await walk(root)
  return files
}

const failures = []
const infoLines = []

let packageJsonContent = ""
try {
  packageJsonContent = await read("package.json")
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  failures.push(`[routing-check] unable to read package.json: ${message}`)
}

if (packageJsonContent) {
  let packageJson = {}
  try {
    packageJson = JSON.parse(packageJsonContent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`[routing-check] package.json is not valid JSON: ${message}`)
  }

  const scripts = packageJson && typeof packageJson === "object" ? packageJson.scripts : undefined
  const nonStubScript =
    typeof scripts?.[nonStubScriptName] === "string" ? scripts[nonStubScriptName].trim() : ""
  const criticalScript =
    typeof scripts?.[criticalScriptName] === "string" ? scripts[criticalScriptName].trim() : ""

  if (!nonStubScript) {
    failures.push(`[routing-check] missing or empty package.json script: ${nonStubScriptName}.`)
  }
  if (!criticalScript) {
    failures.push(`[routing-check] missing or empty package.json script: ${criticalScriptName}.`)
  }

  if (nonStubScript && criticalScript && nonStubScript === criticalScript) {
    failures.push(
      `[routing-check] ${nonStubScriptName} and ${criticalScriptName} must route to different test targets, but their script values are identical.`
    )
  }

  if (nonStubScript && !nonStubScript.includes("@frontend-nonstub|@nonstub")) {
    failures.push(
      `[routing-check] ${nonStubScriptName} must include grep selector @frontend-nonstub|@nonstub.`
    )
  }

  if (
    criticalScript &&
    !criticalScript.includes("@frontend-critical-buttons|@frontend-first-use")
  ) {
    failures.push(
      `[routing-check] ${criticalScriptName} must include grep selector @frontend-critical-buttons|@frontend-first-use.`
    )
  }
}

for (const nonStubSpec of requiredNonStubSpecs) {
  let nonStubContent = ""
  try {
    nonStubContent = await read(nonStubSpec)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`[non-stub] unable to read ${nonStubSpec}: ${message}`)
    continue
  }

  if (!/\B@nonstub\b/.test(nonStubContent)) {
    failures.push(`[non-stub] ${nonStubSpec} must include at least one @nonstub test tag.`)
  }
}

for (const spec of criticalSpecs) {
  let content = ""
  try {
    content = await read(spec)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`[critical-check] unable to read ${spec}: ${message}`)
    continue
  }

  if (PLAYWRIGHT_SKIP_CALL_PATTERN.test(content)) {
    failures.push(
      `[critical-check] ${spec} contains *.skip(...); required critical paths must fail loudly instead of skipping.`
    )
  }
  if (PLAYWRIGHT_ONLY_CALL_PATTERN.test(content)) {
    failures.push(
      `[critical-check] ${spec} contains focused test marker (*.only/fit/fdescribe); critical paths must not use focused tests.`
    )
  }
}

for (const frontendE2eDir of frontendE2eDirs) {
  let frontendE2eSpecs = []
  try {
    frontendE2eSpecs = await listSpecFiles(frontendE2eDir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`[frontend-e2e] unable to list ${frontendE2eDir}: ${message}`)
    continue
  }

  const frontendE2ENonStubSpecs = []
  for (const spec of frontendE2eSpecs) {
    let content = ""
    try {
      content = await read(spec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`[frontend-e2e] unable to read ${spec}: ${message}`)
      continue
    }

    const isNonStubSpec = /\B@nonstub\b/.test(content)
    const hasSkip = PLAYWRIGHT_SKIP_CALL_PATTERN.test(content)
    const hasOnly = PLAYWRIGHT_ONLY_CALL_PATTERN.test(content)

    if (hasSkip && !isNonStubSpec) {
      failures.push(
        `[frontend-e2e] ${spec} contains *.skip(...); frontend-e2e suite must fail loudly instead of skipping.`
      )
    }

    if (isNonStubSpec && hasSkip && !content.includes("CI must fail instead of skipping")) {
      failures.push(
        `[frontend-e2e] ${spec} uses *.skip(...) in @nonstub test but is missing the 'CI must fail instead of skipping' guard.`
      )
    }

    if (hasOnly) {
      failures.push(
        `[frontend-e2e] ${spec} contains focused test marker (*.only/fit/fdescribe); E2E suites must run full scope in CI/local gates.`
      )
    }

    const waitCalls = collectMatches(content, /\b(?:page|context|locator|frame)\.waitForTimeout\s*\(/g)
    if (waitCalls.length > 0) {
      failures.push(
        `[frontend-e2e] ${spec} contains waitForTimeout; use explicit condition waits instead.`
      )
    }

    if (isNonStubSpec) {
      frontendE2ENonStubSpecs.push(spec)
      if (/\bpage\.route\s*\(/.test(content)) {
        failures.push(
          `[frontend-e2e] ${spec} is tagged @nonstub but still uses page.route(...); nonstub specs must use a real API path.`
        )
      }

      const createsLocalServer =
        /\bcreateServer\s*\(/.test(content) ||
        /\bhttp\.createServer\s*\(/.test(content) ||
        /\bhttps\.createServer\s*\(/.test(content) ||
        /\bfrom\s*['"]node:http['"]/.test(content) ||
        /\bfrom\s*['"]http['"]/.test(content)
      if (createsLocalServer) {
        failures.push(
          `[frontend-e2e] ${spec} is tagged @nonstub but appears to create a local mock backend (createServer/node:http/http.createServer). @nonstub specs must hit real app API paths and must not self-host mock servers inside the spec.`
        )
      }

      const listensOnLocalhost =
        /\blisten\s*\(\s*(['"`])(?:127\.0\.0\.1|localhost)\1/.test(content) ||
        /\blisten\s*\(\s*\d+\s*,\s*(['"`])(?:127\.0\.0\.1|localhost)\1/.test(content) ||
        /\bhost\s*:\s*(['"`])(?:127\.0\.0\.1|localhost)\1/.test(content)
      if (listensOnLocalhost) {
        failures.push(
          `[frontend-e2e] ${spec} is tagged @nonstub but appears to listen on localhost/127.0.0.1. @nonstub specs cannot bootstrap a local backend in-spec to fake authenticity.`
        )
      }

      const usesDataUrlStart =
        /\bpage\.goto\s*\(\s*(['"`])data:/.test(content) || /\bdata:text\/html\b/.test(content)
      if (usesDataUrlStart) {
        failures.push(
          `[frontend-e2e] ${spec} is tagged @nonstub but uses data: URL bootstrap. @nonstub specs must run against a real web app/runtime URL, not in-memory data URLs.`
        )
      }
    }
  }

  if (frontendE2eSpecs.length > 0 && frontendE2ENonStubSpecs.length === 0) {
    failures.push(
      `[frontend-e2e] ${frontendE2eDir} has 0 @nonstub specs; add at least one real nonstub spec with @nonstub tag.`
    )
  }
}

if (!Number.isFinite(stubToNonStubMaxRatio) || stubToNonStubMaxRatio <= 0) {
  failures.push(
    `[ratio-check] E2E_STUB_NONSTUB_MAX_RATIO must be a positive number, received ${JSON.stringify(process.env.E2E_STUB_NONSTUB_MAX_RATIO ?? "4")}.`
  )
} else {
  for (const dir of ratioCheckDirs) {
    let specFiles = []
    try {
      specFiles = await listSpecFiles(dir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`[ratio-check] unable to list ${dir}: ${message}`)
      continue
    }

    if (specFiles.length === 0) continue

    let nonStubCount = 0
    for (const spec of specFiles) {
      try {
        const content = await read(spec)
        if (/\B@nonstub\b/.test(content)) {
          nonStubCount += 1
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`[ratio-check] unable to read ${spec}: ${message}`)
      }
    }

    const stubCount = Math.max(0, specFiles.length - nonStubCount)
    if (nonStubCount === 0) {
      failures.push(`[ratio-check] ${dir} has 0 non-stub specs; add at least one @nonstub spec.`)
      continue
    }

    const ratio = stubCount / nonStubCount
    if (ratio > stubToNonStubMaxRatio) {
      failures.push(
        `[ratio-check] stub/non-stub ratio ${stubCount}:${nonStubCount} (${ratio.toFixed(2)}:1) exceeds ${stubToNonStubMaxRatio}:1 in ${dir}.`
      )
    }
  }
}

if (!Number.isInteger(counterfactualMinFilesPerDir) || counterfactualMinFilesPerDir < 1) {
  failures.push(
    `[counterfactual-check] E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR must be an integer >= 1, received ${JSON.stringify(counterfactualMinFilesPerDirRaw)}.`
  )
}

if (counterfactualRequiredDirs.length > 0 && counterfactualRequiredTag.length === 0) {
  failures.push("[counterfactual-check] E2E_COUNTERFACTUAL_REQUIRED_TAG must not be empty.")
}

if (
  failures.length === 0 &&
  counterfactualRequiredDirs.length > 0 &&
  Number.isInteger(counterfactualMinFilesPerDir) &&
  counterfactualMinFilesPerDir >= 1
) {
  const escapedTag = counterfactualRequiredTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const tagPattern = new RegExp(`\\B${escapedTag}\\b`)
  for (const dir of counterfactualRequiredDirs) {
    let specFiles = []
    try {
      specFiles = await listSpecFiles(dir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`[counterfactual-check] unable to list ${dir}: ${message}`)
      continue
    }
    if (specFiles.length === 0) {
      failures.push(`[counterfactual-check] ${dir} contains no .spec.ts files for counterfactual canary gate.`)
      continue
    }

    let taggedCount = 0
    for (const spec of specFiles) {
      try {
        const content = await read(spec)
        if (tagPattern.test(content)) {
          taggedCount += 1
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`[counterfactual-check] unable to read ${spec}: ${message}`)
      }
    }

    if (taggedCount < counterfactualMinFilesPerDir) {
      failures.push(
        `[counterfactual-check] ${dir} has ${taggedCount} ${counterfactualRequiredTag} specs; requires >= ${counterfactualMinFilesPerDir}.`
      )
    } else {
      infoLines.push(
        `[counterfactual-check] ${dir} tagged specs=${taggedCount} (required>=${counterfactualMinFilesPerDir}, tag=${counterfactualRequiredTag})`
      )
    }
  }
} else if (counterfactualRequiredDirs.length === 0) {
  infoLines.push("[counterfactual-check] skipped (E2E_COUNTERFACTUAL_REQUIRED_DIRS is empty)")
}

if (failures.length > 0) {
  console.error("[e2e-authenticity-gate] FAILED")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[e2e-authenticity-gate] OK (stub/non-stub max ratio ${stubToNonStubMaxRatio}:1, frontend-e2e coverage enabled, override via E2E_STUB_NONSTUB_MAX_RATIO)`)
for (const line of infoLines) {
  console.log(line)
}
