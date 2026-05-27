#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const repoRoot = process.cwd()
const outDir = resolve(repoRoot, ".runtime-cache/artifacts/ci")
const outJson = resolve(outDir, "history-object-inventory.json")
const outMd = resolve(outDir, "history-object-inventory.md")

const suspiciousPrefixes = [
  ".runtime-cache/",
  ".lighthouseci/",
  "mutants/",
  "reports/",
  "artifacts/",
  "test-results/",
  "node_modules/",
  "dist/",
  "build/",
  "logs/",
  ".agents/",
]

const suspiciousExtensions = [
  ".har",
  ".har.json",
  ".sqlite",
  ".db",
  ".zip",
  ".pdf",
  ".dmg",
  ".pkg",
  ".mp4",
  ".mov",
  ".trace",
  ".trace.zip",
  ".webm",
  ".png",
  ".jpg",
  ".jpeg",
  ".csv",
]

mkdirSync(dirname(outJson), { recursive: true })

const blobListing = execFileSync(
  "bash",
  [
    "-lc",
    "git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)'",
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }
)
  .trim()
  .split("\n")
  .filter(Boolean)

const blobs = blobListing
  .map((line) => {
    const [type, object, sizeRaw, ...rest] = line.split(" ")
    return {
      type,
      object,
      size: Number(sizeRaw),
      path: rest.join(" ").trim(),
    }
  })
  .filter((entry) => entry.type === "blob" && entry.path.length > 0)

const topBlobs = blobs
  .slice()
  .sort((left, right) => right.size - left.size)
  .slice(0, 100)

const suspiciousBlobs = topBlobs.filter(
  (entry) =>
    suspiciousPrefixes.some((prefix) => entry.path.startsWith(prefix)) ||
    suspiciousExtensions.some((ext) => entry.path.endsWith(ext))
)

const prefixSummary = suspiciousPrefixes
  .map((prefix) => ({
    prefix,
    count: blobs.filter((entry) => entry.path.startsWith(prefix)).length,
    maxBytes: Math.max(
      0,
      ...blobs.filter((entry) => entry.path.startsWith(prefix)).map((entry) => entry.size)
    ),
  }))
  .filter((entry) => entry.count > 0)

const refs = execFileSync("git", ["for-each-ref", "--format=%(refname)"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean)

const hiddenLikeRefs = refs.filter((ref) => ref.startsWith("refs/pull/"))
const remoteRefs = refs.filter((ref) => ref.startsWith("refs/remotes/"))

const payload = {
  generatedAt: new Date().toISOString(),
  suspiciousPrefixes,
  suspiciousExtensions,
  summary: {
    totalBlobs: blobs.length,
    topBlobCount: topBlobs.length,
    suspiciousBlobCount: suspiciousBlobs.length,
    hiddenLikeRefCount: hiddenLikeRefs.length,
    remoteRefCount: remoteRefs.length,
  },
  prefixSummary,
  suspiciousTopBlobs: suspiciousBlobs.map((entry) => ({
    path: entry.path,
    bytes: entry.size,
    object: entry.object,
  })),
  topBlobs: topBlobs.map((entry) => ({
    path: entry.path,
    bytes: entry.size,
    object: entry.object,
  })),
  refs: {
    hiddenLikeRefs,
    remoteRefs: remoteRefs.slice(0, 100),
  },
}

const markdown = [
  "# History Object Inventory",
  "",
  `- generated_at: ${payload.generatedAt}`,
  `- total_blobs: ${payload.summary.totalBlobs}`,
  `- suspicious_blob_count: ${payload.summary.suspiciousBlobCount}`,
  `- hidden_like_ref_count: ${payload.summary.hiddenLikeRefCount}`,
  `- remote_ref_count: ${payload.summary.remoteRefCount}`,
  "",
  "## Prefix Summary",
  "",
  "| Prefix | Count | Largest Blob (bytes) |",
  "| :-- | --: | --: |",
  ...prefixSummary.map((entry) => `| \`${entry.prefix}\` | ${entry.count} | ${entry.maxBytes} |`),
  "",
  "## Suspicious Top Blobs",
  "",
  "| Path | Bytes | Object |",
  "| :-- | --: | :-- |",
  ...suspiciousBlobs.map(
    (entry) => `| \`${entry.path}\` | ${entry.size} | \`${entry.object.slice(0, 12)}\` |`
  ),
  "",
  "## Hidden-like Refs",
  "",
  ...(hiddenLikeRefs.length > 0 ? hiddenLikeRefs.map((ref) => `- \`${ref}\``) : ["- none"]),
  "",
].join("\n")

writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
writeFileSync(outMd, `${markdown}\n`, "utf8")

console.log(
  `[history-object-inventory] ok suspicious_blobs=${payload.summary.suspiciousBlobCount} hidden_like_refs=${payload.summary.hiddenLikeRefCount} json=${outJson} md=${outMd}`
)
