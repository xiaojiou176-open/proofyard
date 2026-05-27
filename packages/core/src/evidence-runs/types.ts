export type EvidenceRetentionState = "retained" | "partial" | "missing" | "empty"

export type EvidenceRegistryState = "available" | "empty" | "missing"

export type EvidenceRunProvenance = {
  source: "canonical" | "automation" | "operator" | null
  correlationId: string | null
  linkedRunIds: string[]
  linkedTaskIds: string[]
}

export type EvidenceRunSummary = {
  runId: string
  profile: string | null
  targetName: string | null
  targetType: string | null
  gateStatus: string | null
  retentionState: EvidenceRetentionState
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  manifestPath: string | null
  summaryPath: string | null
  missingPaths: string[]
  provenance: EvidenceRunProvenance
}

export type EvidenceRunDetail = EvidenceRunSummary & {
  availablePaths: string[]
  reports: Record<string, string>
  proofPaths: Record<string, string>
  evidenceIndexCount: number
  stateCount: number
  registryState: EvidenceRegistryState
  parseError?: string
}

export type EvidenceRunListResult = {
  runs: EvidenceRunSummary[]
  registryState: EvidenceRegistryState
}

export type EvidenceRunLatestResult = {
  run: EvidenceRunDetail | null
  registryState: EvidenceRegistryState
}

export type EvidenceRunCompareState = "ready" | "partial_compare"

export type EvidenceRunCompare = {
  baselineRunId: string
  candidateRunId: string
  compareState: EvidenceRunCompareState
  baselineRetentionState: EvidenceRetentionState
  candidateRetentionState: EvidenceRetentionState
  gateStatusDelta: {
    baseline: string | null
    candidate: string | null
  }
  summaryDelta: {
    durationMs: number | null
    failedChecks: number | null
    missingArtifacts: number
  }
  artifactDelta: {
    baselineMissingPaths: string[]
    candidateMissingPaths: string[]
    reportPathChanges: string[]
    proofPathChanges: string[]
  }
}

export type EvidenceSharePack = {
  runId: string
  retentionState: EvidenceRetentionState
  compare?: EvidenceRunCompare | null
  markdownSummary: string
  issueReadySnippet: string
  releaseAppendix: string
  jsonBundle: {
    runId: string
    retentionState: EvidenceRetentionState
    gateStatus: string | null
    missingPaths: string[]
    compare?: EvidenceRunCompare | null
  }
}

export type PromotionCandidate = {
  runId: string
  eligible: boolean
  retentionState: EvidenceRetentionState
  provenanceReady: boolean
  sharePackReady: boolean
  compareReady: boolean
  reviewState: "candidate" | "review" | "approved"
  reviewStateReason: string
  reasonCodes: string[]
  releaseReference: string
  showcaseReference: string
  supportingSharePackReference: string
}
