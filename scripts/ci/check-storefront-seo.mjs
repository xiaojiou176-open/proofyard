#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const failures = []

const html = read("apps/web/index.html")

requireIncludes("apps/web/index.html", html, 'name="description"')
requireIncludes("apps/web/index.html", html, 'name="keywords"')
requireIncludes("apps/web/index.html", html, 'property="og:title"')
requireIncludes("apps/web/index.html", html, 'property="og:description"')
requireIncludes("apps/web/index.html", html, 'property="og:image"')
requireIncludes("apps/web/index.html", html, 'name="twitter:title"')
requireIncludes("apps/web/index.html", html, 'name="twitter:description"')
requireIncludes("apps/web/index.html", html, 'name="twitter:image"')
requireIncludes("apps/web/index.html", html, 'name="twitter:card" content="summary_large_image"')
requireIncludes("apps/web/index.html", html, 'application/ld+json')
requireIncludes("apps/web/index.html", html, '"SoftwareApplication"')
requireIncludes("apps/web/index.html", html, '"Webaudit"')
requireIncludes("apps/web/index.html", html, '"Codex"')
requireIncludes("apps/web/index.html", html, '"Claude Code"')
requireIncludes("apps/web/index.html", html, '"OpenHands"')
requireIncludes("apps/web/index.html", html, '"OpenCode"')
requireIncludes("apps/web/index.html", html, '"OpenClaw"')
requireIncludes("apps/web/index.html", html, '"MCP"')
requireIncludes("apps/web/index.html", html, '"API"')

if (failures.length > 0) {
  console.error("[storefront-seo] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[storefront-seo] ok")

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function requireIncludes(relativePath, content, needle) {
  if (!content.includes(needle)) {
    failures.push(`${relativePath} missing ${JSON.stringify(needle)}`)
  }
}
