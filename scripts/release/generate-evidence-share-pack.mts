#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildEvidenceSharePack, buildPromotionCandidate } from "../../packages/core/src/index.ts"

const args = process.argv.slice(2)
const runId = args[0]
const compareRunId = args[1] || undefined
const outDir = resolve(args[2] || ".runtime-cache/artifacts/release/share-pack")

if (!runId) {
  throw new Error("usage: node --import tsx scripts/release/generate-evidence-share-pack.mts <runId> [compareRunId] [outDir]")
}

const pack = buildEvidenceSharePack(runId, { compareRunId })
const candidate = buildPromotionCandidate(runId, { compareRunId })
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, `${runId}.share-pack.json`), `${JSON.stringify(pack, null, 2)}\n`, "utf8")
writeFileSync(resolve(outDir, `${runId}.share-pack.md`), `${pack.markdownSummary}\n\n${pack.issueReadySnippet}\n\n${pack.releaseAppendix}\n`, "utf8")
writeFileSync(
  resolve(outDir, `${runId}.promotion-candidate.json`),
  `${JSON.stringify(candidate, null, 2)}\n`,
  "utf8"
)
writeFileSync(
  resolve(outDir, `${runId}.promotion-candidate.md`),
  [
    "## Promotion Candidate",
    `- Run ID: \`${candidate.runId}\``,
    `- Eligible: **${candidate.eligible ? "yes" : "no"}**`,
    `- Retention: **${candidate.retentionState}**`,
    `- Provenance Ready: **${candidate.provenanceReady ? "yes" : "no"}**`,
    `- Share Pack Ready: **${candidate.sharePackReady ? "yes" : "no"}**`,
    `- Compare Ready: **${candidate.compareReady ? "yes" : "no"}**`,
    `- Reason Codes: ${candidate.reasonCodes.length > 0 ? candidate.reasonCodes.join(", ") : "none"}`,
    `- Release Reference: \`${candidate.releaseReference}\``,
    `- Showcase Reference: \`${candidate.showcaseReference}\``,
  ].join("\n") + "\n",
  "utf8"
)
console.log(JSON.stringify({ outDir, runId, compareRunId: compareRunId ?? null }))
