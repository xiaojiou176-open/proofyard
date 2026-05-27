#!/usr/bin/env node

import {
  loadGovernanceControlPlane,
  readRepoJson,
  readRepoText,
} from "./lib/governance-control-plane.mjs"

const failures = []
const { dependencyBaselines } = loadGovernanceControlPlane()

for (const manifest of dependencyBaselines.manifests ?? []) {
  const pkg = readRepoJson(manifest.path)
  for (const [sectionName, expectedDeps] of Object.entries(manifest.checks ?? {})) {
    const actualDeps = pkg[sectionName] ?? {}
    for (const [name, expectedVersion] of Object.entries(expectedDeps ?? {})) {
      const actualVersion = actualDeps[name]
      if (actualVersion !== expectedVersion) {
        failures.push(
          `${manifest.path} ${sectionName}.${name} drifted: expected ${expectedVersion}, got ${actualVersion ?? "(missing)"}`
        )
      }
    }
  }
}

const rootPackage = readRepoJson("package.json")
if (!String(rootPackage.packageManager ?? "").startsWith(dependencyBaselines.packageManager)) {
  failures.push(
    `packageManager drifted: expected prefix ${dependencyBaselines.packageManager}, got ${rootPackage.packageManager ?? "(missing)"}`
  )
}

const dockerSource = readRepoText("docker/ci/Dockerfile")
const runtimeLock = readRepoJson("configs/ci/runtime.lock.json")
const buildCiImageSource = readRepoText("scripts/ci/build-ci-image.sh")
const dockerToolchain = dependencyBaselines.dockerToolchain ?? {}

for (const [label, token] of Object.entries({
  nodeImageDigestPrefix: dockerToolchain.nodeImageDigestPrefix,
  pythonImageDigestPrefix: dockerToolchain.pythonImageDigestPrefix,
  playwright: dockerToolchain.playwright
    ? `ARG PLAYWRIGHT_VERSION=${dockerToolchain.playwright}`
    : "",
  uv: dockerToolchain.uv ? `ARG UV_VERSION=${dockerToolchain.uv}` : "",
  actionlint: dockerToolchain.actionlint
    ? `ARG ACTIONLINT_VERSION=${dockerToolchain.actionlint}`
    : "",
  gitleaks: dockerToolchain.gitleaks ? `ARG GITLEAKS_VERSION=${dockerToolchain.gitleaks}` : "",
  k6: dockerToolchain.k6 ? `ARG K6_VERSION=${dockerToolchain.k6}` : "",
  semgrep: dockerToolchain.semgrep ? `ARG SEMGREP_VERSION=${dockerToolchain.semgrep}` : "",
})) {
  if (label === "playwright" && token) {
    const runtimeLockVersion = runtimeLock?.browsers?.playwright
    const buildArgFlowPresent =
      buildCiImageSource.includes('read_runtime_field "browsers.playwright"') &&
      buildCiImageSource.includes('--build-arg "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION"')

    if (
      dockerSource.includes(token) ||
      (runtimeLockVersion === dockerToolchain.playwright && buildArgFlowPresent)
    ) {
      continue
    }
  }

  if (token && !dockerSource.includes(token)) {
    failures.push(`docker toolchain drifted for ${label}: missing token ${token}`)
  }
}

if (failures.length > 0) {
  console.error("[dependency-governance] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[dependency-governance] ok (${dependencyBaselines.manifests.length} manifest(s))`)
