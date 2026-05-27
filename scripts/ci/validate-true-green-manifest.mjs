#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import Ajv from "ajv"

function parseArgs(argv) {
  const options = {
    schema: "",
    input: "",
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--schema" && next) options.schema = next
    if (token === "--input" && next) options.input = next
  }

  if (!options.schema) throw new Error("missing --schema")
  if (!options.input) throw new Error("missing --input")
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"))
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const schema = readJson(options.schema)
  const input = readJson(options.input)

  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)
  const isValid = validate(input)

  if (!isValid) {
    console.error("[validate-true-green-manifest] validation failed")
    for (const issue of validate.errors || []) {
      const path = issue.instancePath || "/"
      const message = issue.message || "validation error"
      console.error(`- ${path}: ${message}`)
    }
    process.exit(1)
  }

  console.log("[validate-true-green-manifest] validation passed")
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[validate-true-green-manifest] error: ${message}`)
  process.exit(2)
}
