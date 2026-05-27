#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { listFilesRecursive, loadGovernanceControlPlane, repoRoot, readRepoJson } from "./lib/governance-control-plane.mjs"

const failures = []
const { moduleBoundaries } = loadGovernanceControlPlane()
const packages = moduleBoundaries.publicSurfacePackages ?? []
const packageRules = new Map()

for (const entry of packages) {
  const manifest = readRepoJson(entry.manifestPath)
  const exportsMap = manifest.exports ?? {}
  const allowedSpecifiers = new Set([entry.packageName])
  for (const key of Object.keys(exportsMap)) {
    if (key === ".") continue
    allowedSpecifiers.add(`${entry.packageName}/${key.replace(/^\.\//, "")}`)
  }
  packageRules.set(entry.packageName, {
    allowedImporters: entry.allowedImporters ?? [],
    allowedSpecifiers,
  })
}

const scanRoots = ["apps", "tests", "scripts", "packages"]
for (const root of scanRoots) {
  for (const file of listFilesRecursive(root, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])) {
    const relative = path.relative(repoRoot, file).replaceAll(path.sep, "/")
    const content = fs.readFileSync(file, "utf8")
    const matches = content.matchAll(/\b(?:import|export)\s+[^"'`]*?from\s+["'`]([^"'`]+)["'`]|\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)
    for (const match of matches) {
      const specifier = match[1] ?? match[2]
      if (!specifier?.startsWith("@uiq/")) continue
      const [pkgName, subpath] = specifier.split("/", 3).length > 2
        ? [`${specifier.split("/")[0]}/${specifier.split("/")[1]}`, specifier.split("/").slice(2).join("/")]
        : [specifier, ""]
      const rule = packageRules.get(pkgName)
      if (!rule) continue
      const importerAllowed = rule.allowedImporters.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))
      if (!importerAllowed) {
        failures.push(`${relative}: importer not allowed to consume ${pkgName}`)
        continue
      }
      const normalizedSpecifier = subpath ? `${pkgName}/${subpath}` : pkgName
      if (!rule.allowedSpecifiers.has(normalizedSpecifier)) {
        failures.push(`${relative}: public surface violation for ${normalizedSpecifier}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error("[public-surface-boundaries] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[public-surface-boundaries] ok (${packageRules.size} package rule(s))`)
