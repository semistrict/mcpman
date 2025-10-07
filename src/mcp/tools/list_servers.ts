import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TRACE } from "../../utils/logging.js";
import type { UpstreamServerManager } from "../upstream-server-manager.js";

interface ServerInfo {
  connected: boolean;
  toolCount: number;
  tools: unknown[];
}

export function registerListServersTool(
  mcpServer: McpServer,
  upstreamServerManager: UpstreamServerManager,
  initializedMcpServer: Promise<McpServer>
) {
  TRACE("Registering list_servers tool");
  mcpServer.registerTool(
    "list_servers",
    {
      title: "List MCP Servers",
      description:
        "List all connected upstream MCP servers and their tools. This does NOT list MCPMan's own tools (code, eval, invoke, list_servers, help, install) - those are always available and should be called directly.",
      inputSchema: {},
    },
    async () => {
      await initializedMcpServer; // Wait for upstream servers to be connected
      return await handleListServers(upstreamServerManager);
    }
  );
}

async function handleListServers(upstreamServerManager: UpstreamServerManager) {
  const connectedServers = upstreamServerManager.getConnectedServers();
  const toolMap = await upstreamServerManager.getAllTools();

  const servers: Record<string, ServerInfo> = {};

  for (const serverName of connectedServers) {
    const tools = toolMap.get(serverName) || [];
    servers[serverName] = {
      connected: true,
      toolCount: tools.length,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ servers }, null, 2),
      },
    ],
  };
}
