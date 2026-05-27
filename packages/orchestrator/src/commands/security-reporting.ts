import type { SecurityIssue, SecurityTicket } from "./security.js"

export type SecurityCluster = {
  id: string
  key: string
  severity: "HIGH" | "MEDIUM" | "LOW"
  count: number
  sampleIssueId: string
}

export function buildClusters(issues: SecurityIssue[]): {
  byRule: SecurityCluster[]
  byComponent: SecurityCluster[]
} {
  const byRuleMap = new Map<string, SecurityCluster>()
  const byCompMap = new Map<string, SecurityCluster>()

  for (const issue of issues) {
    const ruleKey = issue.ruleId
    const compKey = issue.component

    if (!byRuleMap.has(ruleKey)) {
      byRuleMap.set(ruleKey, {
        id: `rule:${ruleKey}`,
        key: ruleKey,
        severity: issue.severity,
        count: 0,
        sampleIssueId: issue.id,
      })
    }
    if (!byCompMap.has(compKey)) {
      byCompMap.set(compKey, {
        id: `component:${compKey}`,
        key: compKey,
        severity: issue.severity,
        count: 0,
        sampleIssueId: issue.id,
      })
    }

    const ruleCluster = byRuleMap.get(ruleKey) as SecurityCluster
    const compCluster = byCompMap.get(compKey) as SecurityCluster
    ruleCluster.count += 1
    compCluster.count += 1

    if (issue.severity === "HIGH") {
      ruleCluster.severity = "HIGH"
      compCluster.severity = "HIGH"
    } else if (issue.severity === "MEDIUM") {
      if (ruleCluster.severity === "LOW") ruleCluster.severity = "MEDIUM"
      if (compCluster.severity === "LOW") compCluster.severity = "MEDIUM"
    }
  }

  const sortByCount = (a: SecurityCluster, b: SecurityCluster): number => b.count - a.count
  return {
    byRule: Array.from(byRuleMap.values()).sort(sortByCount),
    byComponent: Array.from(byCompMap.values()).sort(sortByCount),
  }
}

function mapTicketSeverity(severity: "HIGH" | "MEDIUM" | "LOW"): "BLOCKER" | "MAJOR" | "MINOR" {
  if (severity === "HIGH") return "BLOCKER"
  if (severity === "MEDIUM") return "MAJOR"
  return "MINOR"
}

function buildProposedFix(issue: SecurityIssue): string {
  if (issue.ruleId === "hardcoded.secret") {
    return "Move secrets to runtime env/secret manager and remove literal values from source."
  }
  if (issue.ruleId === "dangerous.eval") {
    return "Replace eval/new Function with explicit parser or validated dispatch table."
  }
  if (issue.ruleId === "childprocess.exec") {
    return "Use strict allowlist validation and safer spawn argument handling before execution."
  }
  if (issue.ruleId === "insecure.http") {
    return "Use HTTPS endpoints where possible, or document and constrain localhost/test-only HTTP usage."
  }
  return "Apply least-privilege and input-validation remediation for this finding."
}

function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function buildFixPlan(ruleId: string, affectedFiles: string[]): SecurityTicket["fixPlan"] {
  return {
    rootCauseHypothesis: `Unsafe pattern '${ruleId}' appears across ${affectedFiles.length} file(s).`,
    actions: [
      `Apply one consistent remediation for '${ruleId}' in affectedFiles[].`,
      "Add or adjust tests/guards to prevent recurrence.",
      "Document explicit exceptions if any findings are intentionally retained.",
    ],
    validation: [
      "Re-run security scan and ensure this cluster ticket no longer appears.",
      "Run impacted test suites and verify behavior is unchanged.",
    ],
  }
}

export function buildTickets(issues: SecurityIssue[]): SecurityTicket[] {
  const grouped = new Map<string, SecurityIssue[]>()
  for (const issue of issues) {
    const clusterKey = `${issue.ruleId}|${issue.component}`
    if (!grouped.has(clusterKey)) {
      grouped.set(clusterKey, [])
    }
    ;(grouped.get(clusterKey) as SecurityIssue[]).push(issue)
  }

  const tickets: SecurityTicket[] = []
  for (const [clusterKey, clusterIssues] of grouped.entries()) {
    const sorted = [...clusterIssues].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
    )
    const representative = sorted[0] as SecurityIssue
    const affectedFiles = Array.from(new Set(sorted.map((item) => item.file))).sort()
    const highestSeverity = sorted.reduce<"HIGH" | "MEDIUM" | "LOW">((acc, cur) => {
      if (acc === "HIGH" || cur.severity === "HIGH") return "HIGH"
      if (acc === "MEDIUM" || cur.severity === "MEDIUM") return "MEDIUM"
      return "LOW"
    }, "LOW")

    tickets.push({
      ticketId: `ticket:${sanitizeKey(clusterKey)}`,
      clusterKey,
      severity: mapTicketSeverity(highestSeverity),
      impactScope: `${representative.component}:${representative.ruleId}`,
      affectedFiles,
      evidence: {
        ruleId: representative.ruleId,
        file: representative.file,
        line: representative.line,
        column: representative.column,
        snippet: representative.snippet,
      },
      reproSteps: [
        `Open representative finding '${representative.file}' at ${representative.line}:${representative.column}`,
        `Search all matches of '${representative.ruleId}' across affectedFiles[]`,
        `Confirm and remediate ${sorted.length} finding(s) in cluster '${clusterKey}'`,
      ],
      fixPlan: buildFixPlan(representative.ruleId, affectedFiles),
      proposedFix: buildProposedFix(representative),
      acceptanceCriteria: [
        `All findings in cluster '${clusterKey}' are fixed or explicitly waived`,
        "Security scan rerun confirms this ticket is resolved",
        "Regression tests pass after remediation",
      ],
    })
  }

  const severityRank: Record<SecurityTicket["severity"], number> = {
    BLOCKER: 3,
    MAJOR: 2,
    MINOR: 1,
  }
  return tickets.sort((a, b) => {
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity]
    }
    return b.affectedFiles.length - a.affectedFiles.length
  })
}
