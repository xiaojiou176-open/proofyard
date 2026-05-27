#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const failures = []

const surfaces = {
  readme: read("README.md"),
  docsReadme: read("docs/README.md"),
  docsIndex: read("docs/index.md"),
  aiAgents: read("docs/how-to/proofyard-for-ai-agents.md"),
  codingAgents: read("docs/how-to/proofyard-for-coding-agents.md"),
  api: read("docs/reference/universal-api.md"),
  mcp: read("apps/mcp-server/README.md"),
  webIndex: read("apps/web/index.html"),
}

requireIncludes("README.md", surfaces.readme, "ProofTrail for Coding Agents and Agent Ecosystems")
requireIncludes("README.md", surfaces.readme, "browser automation for Codex")
requireIncludes("README.md", surfaces.readme, "browser automation for Claude Code")
requireIncludes("README.md", surfaces.readme, "OpenHands")
requireIncludes("README.md", surfaces.readme, "OpenCode")
requireIncludes("README.md", surfaces.readme, "OpenClaw")
requireIncludes("README.md", surfaces.readme, "not claiming")

requireIncludes("docs/README.md", surfaces.docsReadme, "proofyard-for-coding-agents.md")
requireIncludes("docs/index.md", surfaces.docsIndex, "ProofTrail for Coding Agents and Agent Ecosystems")
requireIncludes("docs/index.md", surfaces.docsIndex, "Codex")
requireIncludes("docs/index.md", surfaces.docsIndex, "Claude Code")
requireIncludes("docs/index.md", surfaces.docsIndex, "OpenHands")
requireIncludes("docs/index.md", surfaces.docsIndex, "OpenCode")
requireIncludes("docs/index.md", surfaces.docsIndex, "OpenClaw")

requireIncludes("docs/how-to/proofyard-for-ai-agents.md", surfaces.aiAgents, "browser automation for Codex")
requireIncludes("docs/how-to/proofyard-for-ai-agents.md", surfaces.aiAgents, "OpenHands")
requireIncludes("docs/how-to/proofyard-for-ai-agents.md", surfaces.aiAgents, "OpenCode")
requireIncludes("docs/how-to/proofyard-for-ai-agents.md", surfaces.aiAgents, "OpenClaw")
requireIncludes("docs/how-to/proofyard-for-ai-agents.md", surfaces.aiAgents, "not claiming")
requireIncludes("docs/how-to/proofyard-for-coding-agents.md", surfaces.codingAgents, "Codex")
requireIncludes("docs/how-to/proofyard-for-coding-agents.md", surfaces.codingAgents, "Claude Code")
requireIncludes("docs/how-to/proofyard-for-coding-agents.md", surfaces.codingAgents, "OpenHands")
requireIncludes("docs/how-to/proofyard-for-coding-agents.md", surfaces.codingAgents, "OpenCode")
requireIncludes("docs/how-to/proofyard-for-coding-agents.md", surfaces.codingAgents, "OpenClaw")
requireIncludes("docs/how-to/proofyard-for-coding-agents.md", surfaces.codingAgents, "Most truthful fit")
requireIncludes("docs/how-to/proofyard-for-coding-agents.md", surfaces.codingAgents, "not claiming")

requireIncludes("docs/reference/universal-api.md", surfaces.api, "Codex")
requireIncludes("docs/reference/universal-api.md", surfaces.api, "Claude Code")
requireIncludes("docs/reference/universal-api.md", surfaces.api, "OpenHands")
requireIncludes("docs/reference/universal-api.md", surfaces.api, "OpenCode")
requireIncludes("docs/reference/universal-api.md", surfaces.api, "OpenClaw")
requireIncludes("apps/mcp-server/README.md", surfaces.mcp, "Codex")
requireIncludes("apps/mcp-server/README.md", surfaces.mcp, "Claude Code")
requireIncludes("apps/mcp-server/README.md", surfaces.mcp, "OpenHands")
requireIncludes("apps/mcp-server/README.md", surfaces.mcp, "OpenCode")
requireIncludes("apps/mcp-server/README.md", surfaces.mcp, "OpenClaw")

requireIncludes("apps/web/index.html", surfaces.webIndex, 'name="keywords"')
requireIncludes("apps/web/index.html", surfaces.webIndex, "Codex")
requireIncludes("apps/web/index.html", surfaces.webIndex, "Claude Code")
requireIncludes("apps/web/index.html", surfaces.webIndex, "OpenHands")
requireIncludes("apps/web/index.html", surfaces.webIndex, "OpenCode")
requireIncludes("apps/web/index.html", surfaces.webIndex, "OpenClaw")
requireIncludes("apps/web/index.html", surfaces.webIndex, "og:image")
requireIncludes("apps/web/index.html", surfaces.webIndex, "twitter:image")
requireIncludes("apps/web/index.html", surfaces.webIndex, "summary_large_image")

if (failures.length > 0) {
  console.error("[ai-discovery-surfaces] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[ai-discovery-surfaces] ok")

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function requireIncludes(relativePath, content, needle) {
  if (!content.includes(needle)) {
    failures.push(`${relativePath} missing ${JSON.stringify(needle)}`)
  }
}
