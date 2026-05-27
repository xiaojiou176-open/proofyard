#!/usr/bin/env node

import {
  listImmediateDirectoryEntries,
  loadGovernanceControlPlane,
  matchesSimpleGlob,
  repoRoot,
} from "./lib/governance-control-plane.mjs"
import fs from "node:fs"
import path from "node:path"

const failures = []
const { runtimeRegistry, runtimeLivePolicy } = loadGovernanceControlPlane()
const runtimeRoot = runtimeRegistry.runtimeRoot
const runtimeAbs = path.join(repoRoot, runtimeRoot)
const registeredBuckets = new Set(
  runtimeRegistry.managedBuckets.map((bucket) => bucket.path.replace(`${runtimeRoot}/`, "").split("/")[0])
)
const policyBuckets = new Set(runtimeLivePolicy.allowedBuckets ?? [])
const liveBuckets = new Set(listImmediateDirectoryEntries(runtimeRoot))
const requiredLifecycleOwners = runtimeLivePolicy.requiredLifecycleOwners ?? {}
const allowedImmediateSubdirs = runtimeLivePolicy.allowedImmediateSubdirs ?? {}
const bucketContracts = runtimeLivePolicy.bucketContracts ?? []

const bucketOwners = new Map(runtimeRegistry.managedBuckets.map((bucket) => [bucket.id, bucket.cleanupOwner]))
const bucketById = new Map(runtimeRegistry.managedBuckets.map((bucket) => [bucket.id, bucket]))
const toolOutputById = new Map((runtimeRegistry.toolOutputs ?? []).map((output) => [output.id, output]))
const registryImmediateSubdirs = new Map()

for (const output of runtimeRegistry.toolOutputs ?? []) {
  for (const runtimePath of output.paths ?? []) {
    if (!runtimePath.startsWith(`${runtimeRoot}/`)) continue
    const remainder = runtimePath.slice(`${runtimeRoot}/`.length)
    const segments = remainder.split("/").filter(Boolean)
    const bucket = segments[0]
    const subdir = segments[1]
    if (!bucket || !subdir || subdir.startsWith("<")) continue
    if (!registryImmediateSubdirs.has(bucket)) {
      registryImmediateSubdirs.set(bucket, new Set())
    }
    registryImmediateSubdirs.get(bucket).add(subdir)
  }
}

function listImmediateEntries(relativeDir) {
  const absPath = path.join(repoRoot, relativeDir)
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) return []
  return fs.readdirSync(absPath).sort()
}

function normalizeEntryToken(entry) {
  return entry.endsWith("/") ? entry.slice(0, -1) : entry
}

function deriveImmediateEntry(bucketPath, outputPath) {
  if (!outputPath.startsWith(`${bucketPath}/`)) return null
  const remainder = outputPath.slice(bucketPath.length + 1).replace(/^\/+/, "")
  if (!remainder) return null
  return normalizeEntryToken(remainder.split("/")[0])
}

for (const bucket of policyBuckets) {
  if (!registeredBuckets.has(bucket)) {
    failures.push(`runtime-live-policy bucket missing from registry: ${bucket}`)
  }
}

for (const bucket of registeredBuckets) {
  if (!policyBuckets.has(bucket)) {
    failures.push(`runtime registry bucket missing from runtime-live-policy: ${bucket}`)
  }
}

for (const [bucket, owner] of bucketOwners.entries()) {
  if (requiredLifecycleOwners[bucket] && requiredLifecycleOwners[bucket] !== owner) {
    failures.push(`runtime lifecycle owner mismatch for bucket '${bucket}': policy=${requiredLifecycleOwners[bucket]} registry=${owner}`)
  }
}

for (const bucket of liveBuckets) {
  if (!policyBuckets.has(bucket)) {
    failures.push(`unexpected runtime bucket present: ${bucket}`)
  }
}

for (const legacyBucket of runtimeLivePolicy.legacyBucketsMustNotExist ?? []) {
  if (liveBuckets.has(legacyBucket)) {
    failures.push(`legacy runtime bucket must not exist: ${legacyBucket}`)
  }
}

for (const fileName of runtimeLivePolicy.legacyLooseFilesMustNotExist ?? []) {
  const absPath = path.join(runtimeAbs, fileName)
  if (fs.existsSync(absPath)) {
    failures.push(`legacy runtime loose file must not exist: ${runtimeRoot}/${fileName}`)
  }
}

for (const [bucket, subdirs] of Object.entries(allowedImmediateSubdirs)) {
  const registrySubdirs = registryImmediateSubdirs.get(bucket) ?? new Set()
  for (const subdir of subdirs) {
    if (!registrySubdirs.has(subdir)) {
      failures.push(`runtime-live-policy subdir missing from registry tool outputs: ${bucket}/${subdir}`)
    }
  }
}

for (const bucket of Object.keys(allowedImmediateSubdirs)) {
  const bucketPath = path.join(runtimeAbs, bucket)
  if (!fs.existsSync(bucketPath) || !fs.statSync(bucketPath).isDirectory()) continue
  const liveSubdirs = listImmediateDirectoryEntries(path.join(runtimeRoot, bucket))
  const allowedSubdirs = new Set(allowedImmediateSubdirs[bucket] ?? [])
  for (const subdir of liveSubdirs) {
    if (!allowedSubdirs.has(subdir)) {
      failures.push(`unexpected runtime subdir present: ${bucket}/${subdir}`)
    }
  }
}

for (const contract of bucketContracts) {
  const bucket = bucketById.get(contract.bucketId)
  if (!bucket) {
    failures.push(`runtime-live bucket contract missing registry bucket: ${contract.bucketId}`)
    continue
  }

  const expectedLifecycleOwner = requiredLifecycleOwners[contract.bucketId]
  if (!expectedLifecycleOwner) {
    failures.push(`runtime-live bucket contract missing lifecycle owner: ${contract.bucketId}`)
  } else if (bucket.cleanupOwner !== expectedLifecycleOwner) {
    failures.push(
      `runtime-live bucket contract lifecycle owner mismatch for '${contract.bucketId}': policy=${expectedLifecycleOwner} registry=${bucket.cleanupOwner}`
    )
  }

  const allowedEntries = (contract.allowedLiveEntries ?? []).map((entry) => normalizeEntryToken(entry))
  const allowedEntrySet = new Set(allowedEntries)
  for (const liveEntry of listImmediateEntries(bucket.path)) {
    if (!allowedEntries.some((pattern) => matchesSimpleGlob(liveEntry, pattern))) {
      failures.push(`unexpected runtime live entry present: ${contract.bucketId}/${liveEntry}`)
    }
  }

  for (const requiredOutput of contract.requiredToolOutputs ?? []) {
    const registryOutput = toolOutputById.get(requiredOutput.id)
    if (!registryOutput) {
      failures.push(`runtime-live bucket contract missing registry tool output: ${requiredOutput.id}`)
      continue
    }
    if (registryOutput.owner !== requiredOutput.owner) {
      failures.push(
        `runtime-live tool output owner mismatch for '${requiredOutput.id}': policy=${requiredOutput.owner} registry=${registryOutput.owner}`
      )
    }

    const allowedOutputEntries = (requiredOutput.allowedEntries ?? []).map((entry) => normalizeEntryToken(entry))
    for (const entry of allowedOutputEntries) {
      if (!allowedEntrySet.has(entry)) {
        failures.push(`runtime-live bucket contract missing allowed entry for '${requiredOutput.id}': ${contract.bucketId}/${entry}`)
      }
    }

    const bucketScopedPaths = (registryOutput.paths ?? []).filter((outputPath) => outputPath.startsWith(`${bucket.path}/`))
    if (bucketScopedPaths.length === 0) {
      failures.push(`runtime-live tool output missing bucket-scoped path for '${requiredOutput.id}': ${contract.bucketId}`)
      continue
    }

    for (const outputPath of bucketScopedPaths) {
      const immediateEntry = deriveImmediateEntry(bucket.path, outputPath)
      if (!immediateEntry) {
        failures.push(`runtime-live tool output path escapes bucket '${contract.bucketId}': ${requiredOutput.id} -> ${outputPath}`)
        continue
      }
      if (!allowedOutputEntries.some((pattern) => matchesSimpleGlob(immediateEntry, pattern))) {
        failures.push(`runtime-live tool output subpath mismatch: ${requiredOutput.id} -> ${immediateEntry}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error("[runtime-live-inventory] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[runtime-live-inventory] ok (${liveBuckets.size} live bucket(s))`)
