import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { readUtf8, runsRoot, safeResolveUnder } from "../../core/constants.js"
import { latestRunId } from "./shared.js"

export function registerMcpResources(mcpServer: McpServer): void {
  mcpServer.registerResource(
    "uiq-latest-manifest",
    "uiq://runs/latest/manifest",
    {
      title: "Latest UIQ Manifest",
      description: "Latest run manifest.json in this workspace",
      mimeType: "application/json",
    },
    async () => {
      const runId = latestRunId()
      if (!runId) {
        return {
          contents: [
            {
              uri: "uiq://runs/latest/manifest",
              text: JSON.stringify({ error: "no runs found" }, null, 2),
            },
          ],
        }
      }
      return {
        contents: [
          {
            uri: "uiq://runs/latest/manifest",
            text: readUtf8(safeResolveUnder(runsRoot(), runId, "manifest.json")),
          },
        ],
      }
    }
  )

  mcpServer.registerResource(
    "uiq-latest-summary",
    "uiq://runs/latest/summary",
    {
      title: "Latest UIQ Summary",
      description: "Latest run reports/summary.json in this workspace",
      mimeType: "application/json",
    },
    async () => {
      const runId = latestRunId()
      if (!runId) {
        return {
          contents: [
            {
              uri: "uiq://runs/latest/summary",
              text: JSON.stringify({ error: "no runs found" }, null, 2),
            },
          ],
        }
      }
      return {
        contents: [
          {
            uri: "uiq://runs/latest/summary",
            text: readUtf8(safeResolveUnder(runsRoot(), runId, "reports/summary.json")),
          },
        ],
      }
    }
  )
}
