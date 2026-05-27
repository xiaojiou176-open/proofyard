import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

const TARGETS = [
  "apps/api/app",
  "apps/api/alembic",
  "apps/automation-runner/scripts",
  "apps/automation-runner/playwright.config.ts",
  "apps/mcp-server/src",
  "packages/orchestrator/src/commands",
  "apps/web/src",
  "apps/web/scripts",
  "apps/web/vite.config.ts",
  "scripts/run-e2e.sh",
  "scripts/test-matrix.sh",
  "scripts/usability/lane-d-usability.ts",
] as const

const FILE_EXTENSIONS = new Set([".py", ".ts", ".tsx", ".js", ".mjs", ".sh"])

function walkFiles(path: string, output: string[]): void {
  const stat = statSync(path)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      walkFiles(resolve(path, entry), output)
    }
    return
  }

  const ext = path.slice(path.lastIndexOf("."))
  if (FILE_EXTENSIONS.has(ext)) output.push(path)
}

export function collectRuntimeEnvRefs(
  repoRoot = resolve("."),
  targets: readonly string[] = TARGETS
): string[] {
  const files: string[] = []
  for (const target of targets) {
    const abs = resolve(repoRoot, target)
    try {
      walkFiles(abs, files)
    } catch {
      // optional target
    }
  }

  const refs = new Set<string>()
  const regexes = [
    /\benv_(?:str|int|float|bool|csv)\(\s*['"]([A-Z0-9_]+)['"]/g,
    /\b(?:requiredEnv|mcpEnv|mcpBool|mcpInt|orchestratorEnv|orchestratorBool|orchestratorInt|automationEnv|automationBool|automationInt|frontendNodeEnv)\(\s*['"]([A-Z0-9_]+)['"]/g,
    /\b(?:readEnv|readBoolEnv|readIntEnv|readCsvEnv)\(\s*[^,]+,\s*['"]([A-Z0-9_]+)['"]/g,
    /\bcall_remote_engine\(\s*['"]([A-Z0-9_]+)['"]\s*,/g,
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[['"]([A-Z0-9_]+)['"]\]/g,
    /import\.meta\.env\.([A-Z0-9_]+)/g,
  ]

  for (const file of files) {
    const content = readFileSync(file, "utf8")
    for (const regex of regexes) {
      for (const match of content.matchAll(regex)) {
        if (match[1]) refs.add(match[1])
      }
    }
  }

  return [...refs].sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const refs = collectRuntimeEnvRefs()
  process.stdout.write(`${refs.join("\n")}\n`)
}
