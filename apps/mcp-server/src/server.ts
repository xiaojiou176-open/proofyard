#!/usr/bin/env node

import { startMcpServer } from "./core.js"

async function main(): Promise<void> {
  await startMcpServer()
  process.stdin.resume()
  await new Promise(() => {
    // Keep stdio MCP process alive after transport is connected.
  })
}

main().catch((error) => {
  console.error(`mcp server failed: ${(error as Error).message}`)
  process.exit(1)
})
