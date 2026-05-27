import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  classifyGovernedToolError,
  governedErrorResponse,
  withGovernedExecution,
} from "../core/governance.js"
import { registerApiTools } from "./register-tools/register-api-tools.js"
import { registerMcpResources as registerMcpResourcesImpl } from "./register-tools/register-resources.js"
import { registerRunTools } from "./register-tools/register-run-tools.js"

export function registerMcpTools(mcpServer: McpServer): void {
  const governedServer = createGovernedMcpServer(mcpServer)
  registerApiTools(governedServer)
  registerRunTools(governedServer)
}

export function registerMcpResources(mcpServer: McpServer): void {
  registerMcpResourcesImpl(mcpServer)
}

function createGovernedMcpServer(mcpServer: McpServer): McpServer {
  const patchable = mcpServer as unknown as {
    registerTool: (
      name: string,
      config: unknown,
      handler: (input: unknown, extra: unknown) => unknown
    ) => unknown
  }
  const originalRegisterTool = patchable.registerTool.bind(mcpServer)
  patchable.registerTool = (
    name: string,
    config: unknown,
    handler: (input: unknown, extra: unknown) => unknown
  ): unknown => {
    return originalRegisterTool(name, config, async (input: unknown, extra: unknown) => {
      try {
        return await withGovernedExecution(name, async ({ timeoutMs }) => {
          return (await Promise.race([
            Promise.resolve(handler(input, extra)),
            new Promise((_, reject) => {
              setTimeout(
                () => reject(new Error(`${name} timed out after ${timeoutMs}ms`)),
                timeoutMs
              )
            }),
          ])) as unknown
        })
      } catch (error) {
        const classified = classifyGovernedToolError(name, error)
        return governedErrorResponse(
          name,
          classified.reasonCode,
          classified.detail,
          classified.meta
        )
      }
    })
  }
  return mcpServer
}
