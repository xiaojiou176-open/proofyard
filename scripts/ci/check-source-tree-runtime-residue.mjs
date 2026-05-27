#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const sourceRoots = ["apps", "packages", "tests"]
const forbiddenDirNames = new Set([".runtime-cache", "__pycache__", "dist", "build"])
const ignoredDirNames = new Set([".git", "node_modules"])
const failures = []

for (const sourceRoot of sourceRoots) {
  walk(sourceRoot)
}

if (failures.length > 0) {
  console.error("[source-tree-runtime-residue] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[source-tree-runtime-residue] ok")

function walk(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) return

  const stat = fs.statSync(absolutePath)
  if (stat.isDirectory()) {
    const dirName = path.basename(relativePath)
    if (ignoredDirNames.has(dirName)) return
    if (forbiddenDirNames.has(dirName)) {
      failures.push(`forbidden runtime/tool residue directory under repo-owned roots: ${relativePath.replaceAll(path.sep, "/")}`)
      return
    }

    for (const entry of fs.readdirSync(absolutePath)) {
      walk(path.join(relativePath, entry))
    }
    return
  }

  if (relativePath.endsWith(".pyc")) {
    failures.push(`forbidden compiled python residue under repo-owned roots: ${relativePath.replaceAll(path.sep, "/")}`)
  }
}
