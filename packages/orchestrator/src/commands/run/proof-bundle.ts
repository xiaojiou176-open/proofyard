import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ManifestProof } from "../../../../core/src/index.js"
import { buildProofArtifacts } from "./proof.js"

type ProofBundleInput = Parameters<typeof buildProofArtifacts>[0] & {
  baseDir: string
}

const DEFAULT_PROOF_REPORTS = {
  coveragePath: "reports/proof.coverage.json",
  stabilityPath: "reports/proof.stability.json",
  gapsPath: "reports/proof.gaps.json",
  reproPath: "reports/proof.repro.json",
} satisfies Omit<ManifestProof, "summary">

export function buildAndWriteProofBundle(input: ProofBundleInput): ManifestProof {
  const { baseDir, ...proofInput } = input
  const proofArtifacts = buildProofArtifacts(proofInput)

  writeFileSync(
    resolve(baseDir, DEFAULT_PROOF_REPORTS.coveragePath),
    JSON.stringify(proofArtifacts.coverage, null, 2),
    "utf8"
  )
  writeFileSync(
    resolve(baseDir, DEFAULT_PROOF_REPORTS.stabilityPath),
    JSON.stringify(proofArtifacts.stability, null, 2),
    "utf8"
  )
  writeFileSync(
    resolve(baseDir, DEFAULT_PROOF_REPORTS.gapsPath),
    JSON.stringify(proofArtifacts.gaps, null, 2),
    "utf8"
  )
  writeFileSync(
    resolve(baseDir, DEFAULT_PROOF_REPORTS.reproPath),
    JSON.stringify(proofArtifacts.repro, null, 2),
    "utf8"
  )

  return {
    ...DEFAULT_PROOF_REPORTS,
    summary: {
      configuredCoverageRatio: proofArtifacts.summary.configuredCoverageRatio,
      gatePassRatio: proofArtifacts.summary.gatePassRatio,
      stabilityStatus: proofArtifacts.summary.stabilityStatus,
    },
  }
}
