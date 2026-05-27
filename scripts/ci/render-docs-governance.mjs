#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  loadGovernanceControlPlane,
  renderList,
  renderTable,
} from "./lib/governance-control-plane.mjs"

const repoRoot = process.cwd()

const OUTPUTS = {
  profileThresholds: "docs/reference/generated/profile-thresholds.md",
  mcpContract: "docs/reference/generated/mcp-tool-contract.md",
  ciTopology: "docs/reference/generated/ci-governance-topology.md",
  thirdpartyRegistryCompat: "docs/reference/thirdparty-registry.md",
  upstreamCustomizations: "docs/reference/upstream-customizations.md",
  governanceRepoMap: "docs/reference/generated/governance/repo-map.md",
  governanceDependencyBaselines: "docs/reference/generated/governance/dependency-baselines.md",
  governanceRootAllowlist: "docs/reference/generated/governance/root-allowlist.md",
  governanceRuntimeLivePolicy: "docs/reference/generated/governance/runtime-live-policy.md",
  governanceRuntimeOutputs: "docs/reference/generated/governance/runtime-output-registry.md",
  governanceLogSchema: "docs/reference/generated/governance/log-event-schema.md",
  governanceModuleBoundaries: "docs/reference/generated/governance/module-boundaries.md",
  governanceUpstreamRegistry: "docs/reference/generated/governance/upstream-registry.md",
  governanceUpstreamCompatMatrix: "docs/reference/generated/governance/upstream-compat-matrix.md",
  governanceUpstreamCustomizations:
    "docs/reference/generated/governance/upstream-customizations.md",
}

const PROFILE_FILES = [
  "configs/profiles/pr.yaml",
  "configs/profiles/nightly.yaml",
  "configs/profiles/nightly-core.yaml",
  "configs/profiles/manual.yaml",
  "configs/profiles/manual-core.yaml",
  "configs/profiles/tauri.regression.yaml",
  "configs/profiles/swift.regression.yaml",
]

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function ensureParentDir(relativePath) {
  mkdirSync(path.dirname(path.join(repoRoot, relativePath)), {
    recursive: true,
  })
}

function normalizeScalar(rawValue) {
  const trimmed = String(rawValue).trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseTopLevelMap(relativePath) {
  const lines = readRepoFile(relativePath).split(/\r?\n/)
  const result = {
    name: "",
    gates: {},
    aiReview: {},
    enginePolicy: {},
    steps: [],
  }
  let section = ""
  let nestedSection = ""

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ")
    if (!line.trim() || line.trim().startsWith("#")) {
      continue
    }
    const topLevelMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (topLevelMatch && !line.startsWith("  ")) {
      section = topLevelMatch[1]
      nestedSection = ""
      const value = topLevelMatch[2]
      if (section === "name") {
        result.name = normalizeScalar(value)
      }
      continue
    }
    const listMatch = line.match(/^ {2}-\s+(.*)$/)
    if (listMatch && section === "steps") {
      result.steps.push(normalizeScalar(listMatch[1]))
      continue
    }
    const nestedMatch = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (nestedMatch) {
      const key = nestedMatch[1]
      const value = nestedMatch[2]
      if (section === "gates") {
        result.gates[key] = normalizeScalar(value)
      }
      if (section === "aiReview") {
        result.aiReview[key] = normalizeScalar(value)
      }
      if (section === "enginePolicy") {
        if (value === "") {
          nestedSection = key
        } else {
          result.enginePolicy[key] = normalizeScalar(value)
          nestedSection = ""
        }
      }
      continue
    }
    const deepListMatch = line.match(/^ {4}-\s+(.*)$/)
    if (deepListMatch && section === "enginePolicy" && nestedSection === "required") {
      const existing = Array.isArray(result.enginePolicy.required)
        ? result.enginePolicy.required
        : []
      existing.push(normalizeScalar(deepListMatch[1]))
      result.enginePolicy.required = existing
    }
  }

  return result
}

function extractConstArray(source, constName) {
  const escaped = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = source.match(
    new RegExp(`${escaped}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const;?`, "m")
  )
  if (!match) {
    throw new Error(`unable to locate const array: ${constName}`)
  }
  return Array.from(match[1].matchAll(/"([^"]+)"/g), (entry) => entry[1])
}

function extractToolNamesFromRegisterSource(source) {
  const names = new Set()
  for (const match of source.matchAll(/registerTool\(\s*"([^"]+)"/g)) {
    if (match[1]?.startsWith("uiq_")) {
      names.add(match[1])
    }
  }
  for (const match of source.matchAll(/registerApiTool\(\s*mcpServer,\s*"([^"]+)"/g)) {
    if (match[1]?.startsWith("uiq_")) {
      names.add(match[1])
    }
  }
  return Array.from(names).sort()
}

function extractRunOverrideKeys() {
  const typesSource = readRepoFile("apps/mcp-server/src/core/types.ts")
  const block = typesSource.match(/runOverrideSchema = \{([\s\S]*?)\} as const;?/)
  if (!block) {
    throw new Error("runOverrideSchema definition not found")
  }
  return Array.from(
    block[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm),
    (entry) => entry[1]
  ).sort()
}

function renderProfileThresholdsDoc() {
  const profiles = PROFILE_FILES.map((relativePath) => ({
    path: relativePath,
    ...parseTopLevelMap(relativePath),
  }))

  const lines = [
    "<!-- markdownlint-disable MD013 -->",
    "",
    "# Generated: Profile Thresholds",
    "",
    "Generated from `configs/profiles/*.yaml`. Do not edit this file manually.",
    "",
  ]

  for (const profile of profiles) {
    lines.push(`## \`${profile.name}\``)
    lines.push("")
    if (profile.steps.length > 0) {
      lines.push(`- Steps: \`${profile.steps.join("`, `")}\``)
    }
    const gateEntries = Object.entries(profile.gates)
    if (gateEntries.length > 0) {
      lines.push("")
      lines.push("| Gate | Value |")
      lines.push("| --- | --- |")
      for (const [key, value] of gateEntries) {
        lines.push(`| \`${key}\` | \`${value}\` |`)
      }
    }
    const aiReviewEntries = Object.entries(profile.aiReview)
    if (aiReviewEntries.length > 0) {
      lines.push("")
      lines.push("| AI Review Field | Value |")
      lines.push("| --- | --- |")
      for (const [key, value] of aiReviewEntries) {
        lines.push(`| \`${key}\` | \`${value}\` |`)
      }
    }
    const requiredEngines = Array.isArray(profile.enginePolicy.required)
      ? profile.enginePolicy.required
      : []
    if (requiredEngines.length > 0 || profile.enginePolicy.failOnBlocked !== undefined) {
      lines.push("")
      lines.push(
        `- Engine policy required: ${requiredEngines.length > 0 ? `\`${requiredEngines.join("`, `")}\`` : "`(none)`"}`
      )
      if (profile.enginePolicy.failOnBlocked !== undefined) {
        lines.push(`- Engine policy failOnBlocked: \`${profile.enginePolicy.failOnBlocked}\``)
      }
    }
    lines.push("")
  }

  lines.push("<!-- markdownlint-enable MD013 -->")
  lines.push("")
  return `${lines.join("\n").trimEnd()}\n`
}

function renderMcpContractDoc() {
  const helperSource = readRepoFile("apps/mcp-server/tests/helpers/mcp-client.ts")
  const descriptionContractSource = readRepoFile(
    "apps/mcp-server/tests/mcp-description-contract.test.ts"
  )
  const runToolSource = readRepoFile(
    "apps/mcp-server/src/tools/register-tools/register-run-tools.ts"
  )
  const apiToolSource = readRepoFile(
    "apps/mcp-server/src/tools/register-tools/register-api-tools.ts"
  )
  const closedLoopSource = readRepoFile(
    "apps/mcp-server/src/tools/register-tools/register-closed-loop-tools.ts"
  )

  const coreWorkingSet = extractConstArray(helperSource, "CORE_TOOL_NAMES")
  const advancedWorkingSet = extractConstArray(helperSource, "ADVANCED_TOOL_NAMES")
  const navigationTools = extractConstArray(descriptionContractSource, "REQUIRED_NEW_DOC_TOOLS")
  const runtimeTools = Array.from(
    new Set([
      ...extractToolNamesFromRegisterSource(runToolSource),
      ...extractToolNamesFromRegisterSource(apiToolSource),
      ...extractToolNamesFromRegisterSource(closedLoopSource),
    ])
  ).sort()
  const runOverrideKeys = extractRunOverrideKeys()

  const lines = [
    "# Generated: MCP Tool Contract",
    "",
    "Generated from MCP runtime source and contract tests. Do not edit this file manually.",
    "",
    "## Navigation Contract Tools",
    "",
    ...navigationTools.map((tool) => `- \`${tool}\``),
    "",
    "## Core Working Set",
    "",
    ...coreWorkingSet.map((tool) => `- \`${tool}\``),
    "",
    "## Advanced Working Set",
    "",
    ...advancedWorkingSet.map((tool) => `- \`${tool}\``),
    "",
    "## Full Runtime Tool Catalog",
    "",
    ...runtimeTools.map((tool) => `- \`${tool}\``),
    "",
    "## Run Override Fields",
    "",
    ...runOverrideKeys.map((key) => `- \`${key}\``),
    "",
  ]

  return `${lines.join("\n").trimEnd()}\n`
}

function extractIndentedListBlock(content, jobName, propertyName) {
  const lines = content.split(/\r?\n/)
  const collected = []
  let inJob = false
  let inBlock = false

  for (const line of lines) {
    if (!inJob) {
      if (line === `  ${jobName}:`) {
        inJob = true
      }
      continue
    }
    if (!inBlock) {
      if (/^ {2}[A-Za-z0-9_.-]+:$/.test(line)) {
        break
      }
      if (line.trim() === `${propertyName}:`) {
        inBlock = true
      }
      continue
    }
    if (!line.startsWith("      - ")) {
      break
    }
    collected.push(line.replace("      - ", "").trim())
  }

  return collected
}

function renderCiTopologyDoc() {
  const prNeeds = extractIndentedListBlock(
    readRepoFile(".github/workflows/pr.yml"),
    "pr_truth_gate",
    "needs"
  )
  const ciNeeds = extractIndentedListBlock(
    readRepoFile(".github/workflows/ci.yml"),
    "repo_truth_required_gate",
    "needs"
  )
  const nightlyNeeds = extractIndentedListBlock(
    readRepoFile(".github/workflows/nightly.yml"),
    "nightly-summary-gate",
    "needs"
  )
  const manualNeeds = extractIndentedListBlock(
    readRepoFile(".github/workflows/manual.yml"),
    "manual-summary-gate",
    "needs"
  )
  const releaseNeeds = extractIndentedListBlock(
    readRepoFile(".github/workflows/release-candidate.yml"),
    "release-gate",
    "needs"
  )

  const lines = [
    "<!-- markdownlint-disable MD013 -->",
    "",
    "# Generated: CI Governance Topology",
    "",
    "Generated from workflow truth surfaces and local hook contracts. Do not edit this file manually.",
    "",
    "Weekly is no longer a governance layer. The current institutional model is:",
    "",
    "- `pre-commit`",
    "- `pre-push`",
    "- `hosted`",
    "- `nightly`",
    "- `manual`",
    "",
    "| Layer | Contract | Canonical Surfaces | Key Inputs |",
    "| --- | --- | --- | --- |",
    "| `pre-commit` | local-fast commit gate | `configs/tooling/pre-commit-config.yaml`, `scripts/ci/pre-commit-required-gates.sh` | `env:generate`, `env:check`, `repo:sensitive:check`, `repo:pii:check`, staged atomic gate, staged truth gates |",
    "| `pre-push` | stronger local pre-push gate | `configs/tooling/pre-commit-config.yaml`, `scripts/ci/pre-push-required-gates.sh` | `repo:sensitive:check`, `repo:sensitive:history:check`, `repo:pii:check`, `openai-residue-gate`, test-truth gates, optional heavy gates |",
    "| `hosted` | GitHub-hosted deterministic merge/release/maintenance automation | `.github/workflows/pre-commit.yml`, `.github/workflows/pr.yml`, `.github/workflows/ci.yml`, `.github/workflows/release-candidate.yml`, `.github/workflows/runtime-gc.yml` | `pr truth deterministic gate (aggregate)`, `repo truth deterministic gate (aggregate)`, `release-gate`, runtime-gc maintenance |",
    `| \`nightly\` | scheduled deep verification | \`.github/workflows/nightly.yml\`, \`configs/profiles/nightly.yaml\`, \`configs/profiles/nightly-core.yaml\` | \`${nightlyNeeds.join("`, `")}\` |`,
    `| \`manual\` | operator-invoked heavy review lane | \`.github/workflows/manual.yml\`, \`configs/profiles/manual.yaml\`, \`configs/profiles/manual-core.yaml\` | \`${manualNeeds.join("`, `")}\` |`,
    "",
    "## Hosted Workflow Truth Surfaces",
    "",
    "| Workflow | Truth Surface | Required Inputs |",
    "| --- | --- | --- |",
    `| \`PR Gate\` | \`pr truth deterministic gate (aggregate)\` | \`${prNeeds.join("`, `")}\` |`,
    `| \`CI\` | \`repo truth deterministic gate (aggregate)\` | \`${ciNeeds.join("`, `")}\` |`,
    `| \`Release Candidate Gate\` | \`release-gate\` | \`${releaseNeeds.join("`, `")}\` |`,
    `| \`Nightly Gate\` | \`nightly-summary-gate\` | \`${nightlyNeeds.join("`, `")}\` |`,
    `| \`Manual Gate\` | \`manual-summary-gate\` | \`${manualNeeds.join("`, `")}\` |`,
  ]

  lines.push("")
  lines.push("<!-- markdownlint-enable MD013 -->")
  lines.push("")
  return `${lines.join("\n").trimEnd()}\n`
}

function renderRootAllowlistDoc() {
  const { rootAllowlist } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Root Allowlist",
    "",
    "Generated from `configs/governance/root-allowlist.json`. Do not edit this file manually.",
    "",
    "## Allowed Tracked Roots",
    "",
    renderList(rootAllowlist.allowedTrackedRoots),
    "",
    "## Allowed Local Runtime Roots",
    "",
    renderList(rootAllowlist.allowedLocalRuntimeRoots),
    "",
    "## Allowed Local Tooling Roots",
    "",
    renderList(rootAllowlist.allowedLocalToolingRoots),
    "",
    "## Forbidden Root Names",
    "",
    renderList(rootAllowlist.forbiddenRootNames),
    "",
    "## Archive Targets",
    "",
    renderTable(
      ["Kind", "Path"],
      Object.entries(rootAllowlist.archiveTargets).map(([kind, target]) => [
        `\`${kind}\``,
        `\`${target}\``,
      ])
    ),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderRepoMapDoc() {
  const { repoMap } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Repo Map",
    "",
    "Generated from `configs/governance/repo-map.json`. Do not edit this file manually.",
    "",
    "## Canonical Roots",
    "",
    renderTable(
      ["ID", "Path", "Display Name", "Kind", "Official Entrypoints"],
      repoMap.canonicalRoots.map((entry) => [
        `\`${entry.id}\``,
        `\`${entry.path}\``,
        entry.displayName,
        `\`${entry.kind}\``,
        entry.entrypoints.map((item) => `\`${item}\``).join("<br>"),
      ])
    ),
    "",
    "## Legacy Root Aliases (Forbidden In Current Surfaces)",
    "",
    renderTable(
      ["Legacy", "Canonical"],
      repoMap.legacyRootAliases.map((entry) => [`\`${entry.legacy}/\``, `\`${entry.canonical}/\``])
    ),
    "",
    "## Forbidden Runtime Tokens",
    "",
    renderList(repoMap.forbiddenRuntimeTokens),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderRuntimeOutputRegistryDoc() {
  const { runtimeRegistry, runtimeLivePolicy } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Runtime Output Registry",
    "",
    "Generated from `configs/governance/runtime-output-registry.json`. Do not edit this file manually.",
    "",
    "## Managed Buckets",
    "",
    renderTable(
      ["Bucket", "Path", "Kind", "Cleanup Owner", "Retention"],
      runtimeRegistry.managedBuckets.map((bucket) => [
        `\`${bucket.id}\``,
        `\`${bucket.path}\``,
        `\`${bucket.kind}\``,
        `\`${bucket.cleanupOwner}\``,
        `\`${bucket.retention.strategy}\``,
      ])
    ),
    "",
    "## Repo-exclusive External Layers",
    "",
    renderTable(
      ["ID", "Path", "Kind", "Cleanup Class", "Owner"],
      runtimeRegistry.repoExclusiveExternalLayers.map((layer) => [
        `\`${layer.id}\``,
        `\`${layer.path}\``,
        `\`${layer.kind}\``,
        `\`${layer.cleanupClass}\``,
        `\`${layer.owner}\``,
      ])
    ),
    "",
    "## Reclaim Scopes",
    "",
    renderTable(
      ["ID", "Path", "Kind", "Cleanup Class", "Rebuild Command", "Risk"],
      (runtimeRegistry.reclaimScopes ?? []).map((scope) => [
        `\`${scope.id}\``,
        `\`${scope.path}\``,
        `\`${scope.kind}\``,
        `\`${scope.cleanupClass}\``,
        `\`${scope.rebuildCommand}\``,
        `\`${scope.risk}\``,
      ])
    ),
    "",
    "## Tool Output Registration",
    "",
    renderTable(
      ["ID", "Owner", "Kind", "Paths"],
      runtimeRegistry.toolOutputs.map((output) => [
        `\`${output.id}\``,
        `\`${output.owner}\``,
        `\`${output.kind}\``,
        output.paths.map((entry) => `\`${entry}\``).join("<br>"),
      ])
    ),
    "",
    "## Root Noise Paths",
    "",
    renderList(runtimeRegistry.rootNoisePaths),
    "",
    "## Runtime Live Policy Buckets",
    "",
    renderList(runtimeLivePolicy.allowedBuckets),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderLogSchemaDoc() {
  const { logSchema } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Log Event Schema",
    "",
    "Generated from `configs/governance/log-event.schema.json`. Do not edit this file manually.",
    "",
    "## Required Fields",
    "",
    renderList(logSchema.required),
    "",
    "## Enum Fields",
    "",
    renderTable(
      ["Field", "Allowed Values"],
      ["level", "kind", "redaction_state", "source_kind"].map((key) => [
        `\`${key}\``,
        logSchema.properties[key].enum.map((value) => `\`${value}\``).join(", "),
      ])
    ),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderModuleBoundariesDoc() {
  const { moduleBoundaries } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Module Boundaries",
    "",
    "Generated from `configs/governance/module-boundaries.json`. Do not edit this file manually.",
    "",
    renderTable(
      ["Root", "Role", "May Depend On", "Must Not Depend On"],
      moduleBoundaries.responsibilityMap.map((entry) => [
        `\`${entry.root}\``,
        entry.role,
        entry.mayDependOn.map((item) => `\`${item}\``).join(", "),
        entry.mustNotDependOn.map((item) => `\`${item}\``).join(", "),
      ])
    ),
    "",
    "## Contract-Only Roots",
    "",
    renderList(moduleBoundaries.contractOnlyRoots),
    "",
    "## Public Surface Packages",
    "",
    renderTable(
      ["Package", "Manifest", "Allowed Importers"],
      (moduleBoundaries.publicSurfacePackages ?? []).map((entry) => [
        `\`${entry.packageName}\``,
        `\`${entry.manifestPath}\``,
        (entry.allowedImporters ?? []).map((item) => `\`${item}\``).join(", "),
      ])
    ),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderDependencyBaselinesDoc() {
  const { dependencyBaselines } = loadGovernanceControlPlane()
  const rows = []
  for (const manifest of dependencyBaselines.manifests ?? []) {
    for (const [sectionName, deps] of Object.entries(manifest.checks ?? {})) {
      for (const [name, version] of Object.entries(deps ?? {})) {
        rows.push([`\`${manifest.path}\``, `\`${sectionName}\``, `\`${name}\``, `\`${version}\``])
      }
    }
  }
  const lines = [
    "# Generated: Governance Dependency Baselines",
    "",
    "Generated from `configs/governance/dependency-baselines.json`. Do not edit this file manually.",
    "",
    renderTable(["Manifest", "Section", "Dependency", "Pinned Version"], rows),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderRuntimeLivePolicyDoc() {
  const { runtimeLivePolicy } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Runtime Live Policy",
    "",
    "Generated from `configs/governance/runtime-live-policy.json`. Do not edit this file manually.",
    "",
    "## Allowed Runtime Buckets",
    "",
    renderList(runtimeLivePolicy.allowedBuckets ?? []),
    "",
    "## Legacy Buckets Forbidden",
    "",
    renderList(runtimeLivePolicy.legacyBucketsMustNotExist ?? []),
    "",
    "## Size Budgets (MB)",
    "",
    renderTable(
      ["Key", "Budget MB"],
      Object.entries(runtimeLivePolicy.sizeBudgetsMb ?? {}).map(([key, value]) => [
        `\`${key}\``,
        `\`${value}\``,
      ])
    ),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderUpstreamRegistryDoc() {
  const { upstreamRegistry } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Upstream Registry",
    "",
    "Generated from `configs/governance/upstream-registry.json`. Do not edit this file manually.",
    "",
    renderTable(
      ["ID", "Kind", "Role", "Source", "Pin", "Owner", "Compat Group", "Contract Kind", "Status"],
      upstreamRegistry.entries.map((entry) => [
        `\`${entry.id}\``,
        `\`${entry.kind}\``,
        entry.role,
        `\`${entry.source}\``,
        `\`${entry.pin}\``,
        `\`${entry.owner}\``,
        `\`${entry.compat_group}\``,
        `\`${entry.contract_kind}\``,
        `\`${entry.status}\``,
      ])
    ),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderThirdpartyRegistryCompatDoc() {
  const lines = [
    "# Reference Stub: Third-Party Upstream Sync Registry",
    "",
    "> Generated reference pointer. This path stays in `docs/reference/` as a stable maintenance entry, while the full generated registry lives under the governance-generated surface.",
    ">",
    "> Canonical generated source:",
    "> - `docs/reference/generated/governance/upstream-registry.md`",
    ">",
    "> Control-plane JSON source:",
    "> - `configs/governance/upstream-registry.json`",
    "",
    "Use this page as a pointer, not as a hand-maintained duplicate. Operational details live in:",
    "",
    "- `docs/reference/dependencies-and-third-party.md`",
    "- `docs/runbooks/thirdparty-upstream-sync.md`",
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderUpstreamCompatMatrixDoc() {
  const { upstreamCompatMatrix } = loadGovernanceControlPlane()
  const lines = [
    "# Generated: Governance Upstream Compatibility Matrix",
    "",
    "Generated from `configs/governance/upstream-compat-matrix.json`. Do not edit this file manually.",
    "",
    renderTable(
      ["Group", "Supported IDs", "Upgrade Validation", "Policy", "Proof Artifact"],
      upstreamCompatMatrix.groups.map((group) => [
        `\`${group.id}\``,
        group.supported.map((entry) => `\`${entry}\``).join(", "),
        group.upgradeValidation.map((entry) => `\`${entry}\``).join(", "),
        `\`${group.policy}\``,
        `\`${group.requiredProofArtifact}\``,
      ])
    ),
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderUpstreamCustomizationsReferenceStub() {
  const { upstreamCustomizations } = loadGovernanceControlPlane()
  const lines = [
    "# Reference Stub: Governance Upstream Customizations",
    "",
    "> Generated reference pointer. This path stays in `docs/reference/` as a stable maintenance entry, while the full generated content lives under the governance-generated surface.",
    ">",
    "> Canonical generated source:",
    "> - `docs/reference/generated/governance/upstream-customizations.md`",
    ">",
    "> Control-plane JSON source:",
    "> - `configs/governance/upstream-customizations.json`",
    "",
    `- Current generated status: \`${upstreamCustomizations.status}\``,
    "",
  ]
  return `${lines.join("\n").trimEnd()}\n`
}

function renderUpstreamCustomizationsGeneratedDoc() {
  const { upstreamCustomizations } = loadGovernanceControlPlane()
  const customizations = upstreamCustomizations.customizations ?? []
  const lines = [
    "# Generated: Governance Upstream Customizations",
    "",
    "Generated from `configs/governance/upstream-customizations.json`. Do not edit this file manually.",
    "",
    `- Status: \`${upstreamCustomizations.status}\``,
    "",
  ]
  if (customizations.length === 0) {
    lines.push("No active upstream customizations are registered.")
    lines.push("")
    return `${lines.join("\n").trimEnd()}\n`
  }
  lines.push(
    renderTable(
      ["ID", "Upstream", "Local Paths", "Strategy", "Owner", "Verified", "Status"],
      customizations.map((entry) => [
        `\`${entry.id}\``,
        `\`${entry.upstream_id}\``,
        (entry.local_paths ?? []).map((item) => `\`${item}\``).join("<br>"),
        `\`${entry.sync_strategy}\``,
        `\`${entry.owner}\``,
        `\`${entry.last_verified_at}\``,
        `\`${entry.status}\``,
      ])
    )
  )
  lines.push("")
  return `${lines.join("\n").trimEnd()}\n`
}

function buildRenderedOutputs() {
  return new Map([
    [OUTPUTS.profileThresholds, renderProfileThresholdsDoc()],
    [OUTPUTS.mcpContract, renderMcpContractDoc()],
    [OUTPUTS.ciTopology, renderCiTopologyDoc()],
    [OUTPUTS.thirdpartyRegistryCompat, renderThirdpartyRegistryCompatDoc()],
    [OUTPUTS.upstreamCustomizations, renderUpstreamCustomizationsReferenceStub()],
    [OUTPUTS.governanceRepoMap, renderRepoMapDoc()],
    [OUTPUTS.governanceDependencyBaselines, renderDependencyBaselinesDoc()],
    [OUTPUTS.governanceRootAllowlist, renderRootAllowlistDoc()],
    [OUTPUTS.governanceRuntimeLivePolicy, renderRuntimeLivePolicyDoc()],
    [OUTPUTS.governanceRuntimeOutputs, renderRuntimeOutputRegistryDoc()],
    [OUTPUTS.governanceLogSchema, renderLogSchemaDoc()],
    [OUTPUTS.governanceModuleBoundaries, renderModuleBoundariesDoc()],
    [OUTPUTS.governanceUpstreamRegistry, renderUpstreamRegistryDoc()],
    [OUTPUTS.governanceUpstreamCompatMatrix, renderUpstreamCompatMatrixDoc()],
    [OUTPUTS.governanceUpstreamCustomizations, renderUpstreamCustomizationsGeneratedDoc()],
  ])
}

function main() {
  const checkOnly = process.argv.includes("--check")
  const outputs = buildRenderedOutputs()
  const drifted = []

  for (const [relativePath, expectedContent] of outputs.entries()) {
    const absolutePath = path.join(repoRoot, relativePath)
    if (checkOnly) {
      let currentContent = ""
      try {
        currentContent = readFileSync(absolutePath, "utf8")
      } catch {
        currentContent = ""
      }
      if (currentContent !== expectedContent) {
        drifted.push(relativePath)
      }
      continue
    }
    ensureParentDir(relativePath)
    writeFileSync(absolutePath, expectedContent, "utf8")
  }

  if (checkOnly && drifted.length > 0) {
    console.error("docs governance render drift detected:")
    for (const relativePath of drifted) {
      console.error(`- ${relativePath}`)
    }
    process.exit(1)
  }

  const mode = checkOnly ? "check" : "write"
  console.log(`[docs-governance-render] ${mode} ok (${Array.from(outputs.keys()).length} file(s))`)
}

main()
