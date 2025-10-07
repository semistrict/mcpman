import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TRACE } from "../../utils/logging.js";
import type { UpstreamServerManager } from "../upstream-server-manager.js";

export function registerHelpTool(
  mcpServer: McpServer,
  upstreamServerManager: UpstreamServerManager,
  initializedMcpServer: Promise<McpServer>
) {
  TRACE("Registering help tool");
  mcpServer.registerTool(
    "help",
    {
      title: "Help",
      description: "Get help information about MCP tools",
      inputSchema: {
        server: z.string().describe("Name of the MCP server to get help for"),
        tool: z.string().optional().describe("Optional specific tool name to get help for"),
      },
    },
    async ({ server, tool }) => {
      await initializedMcpServer; // Wait for upstream servers to be connected
      return await handleHelp(upstreamServerManager, server, tool);
    }
  );
  TRACE("Help tool registered");
}

async function handleHelp(
  upstreamServerManager: UpstreamServerManager,
  serverName: string,
  toolName?: string
) {
  const client = upstreamServerManager.getClient(serverName);
  if (!client) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Server '${serverName}' not found. Available servers: ${upstreamServerManager.getConnectedServers().join(", ")}`,
        },
      ],
    };
  }

  try {
    const result = await client.listTools();
    const tools = result.tools || [];

    if (toolName) {
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Tool '${toolName}' not found in server '${serverName}'. Available tools: ${tools.map((t) => t.name).join(", ")}`,
            },
          ],
        };
      }

      const helpInfo = {
        server: serverName,
        tool: {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema || {},
        },
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(helpInfo, null, 2),
          },
        ],
      };
    } else {
      const helpInfo = {
        server: serverName,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema || {},
        })),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(helpInfo, null, 2),
          },
        ],
      };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error getting tools from server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
