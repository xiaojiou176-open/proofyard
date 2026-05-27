import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  findGovernanceException,
  loadGovernanceExceptions,
  normalizeRepoPath,
} from "./governance-exceptions.mjs"

function writeJson(pathname, payload) {
  writeFileSync(pathname, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

test("governance exceptions validate debt register linkage and lookup", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-governance-"))
  try {
    const exceptionsPath = join(root, "governance-exceptions.json")
    const debtRegisterPath = join(root, "debt-register.md")
    writeJson(exceptionsPath, {
      schemaVersion: 1,
      exceptions: [
        {
          id: "coverage-packages",
          gate: "coverage-global-source",
          path: "packages",
          reason: "tracked debt",
          owner_role: "platform-owner",
          expires_on: "2026-03-24",
          debt_ref: "DEBT-2026-03-10-200",
        },
      ],
    })
    writeFileSync(
      debtRegisterPath,
      [
        "# Governance Debt Register",
        "",
        "| ID | 类型 | 路径 | 风险 | owner_role | 截止日期 | 退出标准 | 状态 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| DEBT-2026-03-10-200 | test_gap | packages | pending | platform-owner | 2026-03-24 | raise coverage | active |",
        "",
      ].join("\n"),
      "utf8"
    )

    const exceptions = loadGovernanceExceptions({
      exceptionsPath,
      debtRegisterPath,
      today: "2026-03-10",
    })
    assert.equal(exceptions.length, 1)
    assert.equal(normalizeRepoPath("./packages"), "packages")
    assert.deepEqual(findGovernanceException(exceptions, "coverage-global-source", "packages"), exceptions[0])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("governance exceptions reject entries beyond 14-day window", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-governance-expired-"))
  try {
    const exceptionsPath = join(root, "governance-exceptions.json")
    const debtRegisterPath = join(root, "debt-register.md")
    writeJson(exceptionsPath, {
      schemaVersion: 1,
      exceptions: [
        {
          id: "late-entry",
          gate: "firstparty-file-length",
          path: "apps/web/src/hooks/useApiClient.ts",
          reason: "too late",
          owner_role: "frontend-owner",
          expires_on: "2026-03-30",
          debt_ref: "DEBT-2026-03-10-201",
        },
      ],
    })
    writeFileSync(
      debtRegisterPath,
      [
        "# Governance Debt Register",
        "",
        "| ID | 类型 | 路径 | 风险 | owner_role | 截止日期 | 退出标准 | 状态 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| DEBT-2026-03-10-201 | gate_failure | apps/web/src/hooks/useApiClient.ts | pending | frontend-owner | 2026-03-30 | split file | active |",
        "",
      ].join("\n"),
      "utf8"
    )

    assert.throws(
      () =>
        loadGovernanceExceptions({
          exceptionsPath,
          debtRegisterPath,
          today: "2026-03-10",
        }),
      /14-day window/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
