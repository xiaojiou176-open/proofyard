#!/usr/bin/env node

import fs from "node:fs"
import { REQUIRED_STOREFRONT_ASSETS } from "./lib/storefront-asset-policy.mjs"

const failures = []

for (const file of REQUIRED_STOREFRONT_ASSETS) {
  if (!fs.existsSync(file)) {
    failures.push(`missing storefront asset file: ${file}`)
  }
}

const readme = fs.existsSync("README.md") ? fs.readFileSync("README.md", "utf8") : ""
if (!readme.includes("assets/storefront/proofyard-hero.png")) {
  failures.push("README.md missing storefront hero reference")
}
if (!readme.includes("assets/storefront/proofyard-readme-hero.svg")) {
  failures.push("README.md missing proof-loop storefront visual reference")
}
if (!readme.includes("assets/storefront/proofyard-agent-ecosystem-map.svg")) {
  failures.push("README.md missing storefront ecosystem-fit map reference")
}

const readmeHeroMatches = [...readme.matchAll(/!\[[^\]]*\]\((assets\/storefront\/[^)]+)\)/g)]
if (readmeHeroMatches.length !== 1) {
  failures.push(`README.md must reference exactly one storefront hero asset (found ${readmeHeroMatches.length})`)
}

for (const file of REQUIRED_STOREFRONT_ASSETS) {
  if (!fs.existsSync(file)) continue
  const content = fs.readFileSync(file, "utf8")
  if (content.includes("AutoBrowser")) {
    failures.push(`${file} still contains legacy storefront name AutoBrowser`)
  }
}

if (failures.length > 0) {
  console.error("[storefront-assets] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("[storefront-assets] ok")
