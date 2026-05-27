#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { loadProfileConfig, loadTargetConfig } from "../../packages/orchestrator/src/commands/run/run-config.js"
import {
  validateProfileConfig,
  validateTargetConfig,
} from "../../packages/orchestrator/src/commands/run/run-validate.js"

const [argvKind, argvName, argvPayloadPath] = process.argv.slice(2)
const kind = process.env.UIQ_STUDIO_CONFIG_KIND ?? argvKind
const name = process.env.UIQ_STUDIO_CONFIG_NAME ?? argvName
const payloadPath = process.env.UIQ_STUDIO_PAYLOAD_PATH ?? argvPayloadPath

if (!kind || !name) {
  throw new Error(
    "usage: node --import tsx scripts/config/validate-studio-config.mts <profile|target> <name> [jsonPayloadPath] or set UIQ_STUDIO_CONFIG_KIND/UIQ_STUDIO_CONFIG_NAME[/UIQ_STUDIO_PAYLOAD_PATH]"
  )
}

if (kind === "profile") {
  if (payloadPath) {
    const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as Parameters<
      typeof validateProfileConfig
    >[0]
    validateProfileConfig(payload, name)
  } else {
    loadProfileConfig(name)
  }
} else if (kind === "target") {
  if (payloadPath) {
    const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as Parameters<
      typeof validateTargetConfig
    >[0]
    validateTargetConfig(payload, name)
  } else {
    loadTargetConfig(name)
  }
} else {
  throw new Error("kind must be profile or target")
}

console.log(JSON.stringify({ ok: true, kind, name, payloadPath: payloadPath ?? null }))
