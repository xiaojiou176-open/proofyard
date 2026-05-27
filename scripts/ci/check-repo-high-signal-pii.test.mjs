import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const scriptPath = path.resolve("scripts/ci/check-repo-high-signal-pii.mjs")

test("allows placeholder and maintainer-safe email patterns", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "webaudit-pii-ok-"))
  try {
    initRepo(tmp)
    fs.writeFileSync(path.join(tmp, "README.md"), "contact support@example.test\nsecurity@webaudit.dev\n")
    git(tmp, ["add", "README.md"])
    git(tmp, ["commit", "-m", "test"])
    const result = spawnSync("node", [scriptPath], { cwd: tmp, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("fails on unexpected real-looking email addresses", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "webaudit-pii-fail-"))
  try {
    initRepo(tmp)
    fs.mkdirSync(path.join(tmp, "docs"), { recursive: true })
    fs.writeFileSync(path.join(tmp, "docs", "note.md"), "owner email is jane.doe@corp.com\n")
    git(tmp, ["add", "docs/note.md"])
    git(tmp, ["commit", "-m", "test"])
    const result = spawnSync("node", [scriptPath], { cwd: tmp, encoding: "utf8" })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /repo-high-signal-pii/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("allows documented test credit card numbers and rejects unexpected ssn-like values", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "webaudit-pii-card-"))
  try {
    initRepo(tmp)
    fs.mkdirSync(path.join(tmp, "docs"), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, "docs", "note.md"),
      "test card 4242 4242 4242 4242 is allowed\\nreal ssn 123-45-6789 must fail\\n"
    )
    git(tmp, ["add", "docs/note.md"])
    git(tmp, ["commit", "-m", "test"])
    const result = spawnSync("node", [scriptPath], { cwd: tmp, encoding: "utf8" })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /ssn-like/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

function initRepo(cwd) {
  git(cwd, ["init"])
  git(cwd, ["config", "user.name", "Codex Test"])
  git(cwd, ["config", "user.email", "codex@example.test"])
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout)
  }
}
