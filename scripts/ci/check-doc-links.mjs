#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const targets = execFileSync(
  "git",
  ["ls-files", "-z", "--", "*.md", "*.mdx"],
  { encoding: "utf8" }
)
  .trim()
  .split("\0")
  .filter(Boolean)

const markdownLinkPattern = /\[[^\]]*]\(([^)]+)\)/g
const failures = []

function extractMarkdownAnchors(content) {
  const anchors = new Set()
  const headingPattern = /^(#{1,6})\s+(.+)$/gm
  for (const match of content.matchAll(headingPattern)) {
    const raw = match[2].trim().toLowerCase()
    const slug = raw
      .replace(/[`*_[\]()]/g, "")
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
    if (slug) anchors.add(slug)
  }
  return anchors
}

for (const target of targets) {
  if (!fs.existsSync(target)) {
    failures.push(`missing doc-link scan target: ${target}`)
    continue
  }
  const content = fs.readFileSync(target, "utf8")
  const dir = path.dirname(target)
  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawRef = match[1].trim()
    if (
      rawRef.startsWith("http://") ||
      rawRef.startsWith("https://") ||
      rawRef.startsWith("#") ||
      rawRef.startsWith("mailto:")
    ) {
      continue
    }
    const [cleanRef, anchor] = rawRef.split("#")
    if (!cleanRef) continue
    const resolved = path.normalize(path.join(dir, cleanRef))
    if (!fs.existsSync(resolved)) {
      failures.push(`broken local doc link: ${target} -> ${rawRef}`)
      continue
    }
    if (anchor) {
      const targetContent = fs.readFileSync(resolved, "utf8")
      const anchors = extractMarkdownAnchors(targetContent)
      if (!anchors.has(anchor.toLowerCase())) {
        failures.push(`broken local doc anchor: ${target} -> ${rawRef}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error("[doc-links] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`[doc-links] ok (${targets.length} markdown surface(s) scanned)`)
