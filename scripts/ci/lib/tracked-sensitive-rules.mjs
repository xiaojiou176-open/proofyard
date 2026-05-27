import { execFileSync } from "node:child_process"

export const trackedSensitiveExcludedPaths = new Set([
  "scripts/ci/check-public-redaction.mjs",
  "scripts/ci/check-history-sensitive-surface.mjs",
  "scripts/ci/check-repo-sensitive-surface.mjs",
  "scripts/ci/check-repo-sensitive-history.mjs",
  "scripts/ci/check-repo-sensitive-surface.test.mjs",
  "scripts/ci/lib/tracked-sensitive-rules.mjs",
])

export const trackedSensitiveContentRules = [
  {
    id: "absolute-macos-user-path",
    regex: /\/Users\/[^/\r\n]+\/[^\r\n"'`<>{}]+/,
  },
  {
    id: "absolute-linux-home-path",
    regex: /\/home\/[^/\r\n]+\/[^\r\n"'`<>{}]+/,
  },
  {
    id: "absolute-windows-user-path",
    regex: /[A-Za-z]:\\Users\\[^\\\r\n]+\\[^\r\n"'`<>{}]+/,
  },
  {
    id: "aws-access-key-id",
    regex: /AKIA[0-9A-Z]{16}/,
  },
  {
    id: "github-token",
    regex: /gh[pousr]_[A-Za-z0-9]{20,}/,
  },
  {
    id: "openai-style-secret",
    regex: /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/,
  },
  {
    id: "private-key-block",
    regex: /BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY/,
  },
  {
    id: "bearer-token",
    regex: /\bBearer\s+(?!SCRUBBED_|PLACEHOLDER_|TEST_|EXAMPLE_)[A-Za-z0-9._-]{12,}/,
  },
]

export const trackedSensitiveHistoryProbes = [
  { id: "absolute-macos-user-path", probe: ["/", "Users", "/"].join("") },
  { id: "absolute-linux-home-path", probe: "/home/" },
  { id: "absolute-windows-user-path", probe: "Users\\\\" },
  { id: "aws-access-key-id", probe: "AKIA[0-9A-Z]{16}" },
  { id: "github-token", probe: "gh[pousr]_[A-Za-z0-9]{20,}" },
  { id: "openai-style-secret", probe: "(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}" },
  { id: "private-key-block", probe: "BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY" },
]

export function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
}

export function isTrackedSensitiveExcludedPath(relativePath) {
  return trackedSensitiveExcludedPaths.has(relativePath)
}

export function findTrackedSensitiveContentMatch(content) {
  for (const rule of trackedSensitiveContentRules) {
    const match = rule.regex.exec(content)
    if (!match) continue

    const prefix = content.slice(0, match.index)
    return {
      ruleId: rule.id,
      line: prefix.split(/\r?\n/).length,
    }
  }

  return null
}
