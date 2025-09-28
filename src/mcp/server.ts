import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { EvalRuntime } from "../eval/runtime.js";
import type { UpstreamServerManager } from "./upstream-server-manager.js";
import { TRACE } from "../utils/logging.js";

interface ServerInfo {
  connected: boolean;
  toolCount: number;
  tools: unknown[];
}

const mcpServer: McpServer = new McpServer({
  name: "mcpman",
  version: "1.0.0",
});

let resolveInitialized: (mcpServer: McpServer) => void = () => {
  // Placeholder - will be overridden
};
let rejectInitialized: (reason?: unknown) => void = () => {
  // Placeholder - will be overridden
};
const initializedMcpServer: Promise<McpServer> = new Promise<McpServer>((resolve, reject) => {
  resolveInitialized = () => resolve(mcpServer);
  rejectInitialized = (reason) => reject(reason);
});

export function createMcpServer(
  evalRuntime: EvalRuntime,
  upstreamServerManager: UpstreamServerManager
): McpServer {
  TRACE("Creating MCP server with oninitialized callback");

  // Set the oninitialized callback on the underlying server
  mcpServer.server.oninitialized = async () => {
    // Client has connected and completed initialization
    // Now we can connect to upstream servers
    TRACE("CLIENT INITIALIZED! Now connecting to upstream servers...");
    try {
      await upstreamServerManager.connectAll();
      resolveInitialized(mcpServer);
      TRACE("SUCCESS: Connected to all upstream servers");
    } catch (error) {
      if (rejectInitialized) {
        rejectInitialized(error);
      }
      TRACE("ERROR connecting to upstream servers:", error);
    }
  };

  // Register eval tool
  mcpServer.registerTool(
    "eval",
    {
      title: "JavaScript Evaluator",
      description: "Execute an IIFE with access to MCP tools and a parameter object",
      inputSchema: {
        code: z
          .string()
          .describe(
            "Function expression that optionally accepts a single parameter. Use serverName.toolName(args) to call tools."
          ),
        arg: z.unknown().optional().describe("Object to pass as parameter to the function"),
      },
    },
    async ({ code, arg }) => {
      await initializedMcpServer; // Ensure initialization is complete
      const result = await evalRuntime.eval(code, arg);

      const serializedResult =
        typeof result.result === "object" && result.result !== null
          ? JSON.stringify(result.result)
          : String(result.result);

      return {
        content: [
          {
            type: "text" as const,
            text: `Result: ${serializedResult}${result.output ? `\nOutput:\n${result.output}` : ""}`,
          },
        ],
      };
    }
  );

  // Register list_servers tool
  mcpServer.registerTool(
    "list_servers",
    {
      title: "List MCP Servers",
      description: "List all connected MCP servers and their tools",
      inputSchema: {},
    },
    async () => {
      await initializedMcpServer; // Ensure initialization is complete
      return await handleListServers(upstreamServerManager);
    }
  );

  // Register help tool
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
      await initializedMcpServer; // Ensure initialization is complete
      return await handleHelp(upstreamServerManager, server, tool);
    }
  );

  return mcpServer;
}

export function getMcpServer(): Promise<McpServer> {
  return initializedMcpServer;
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

export async function connectMcpServer(): Promise<void> {
  TRACE("Connecting MCP server to stdio transport");
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  TRACE("MCP server connected to stdio transport");
}

export async function disconnectMcpServer(): Promise<void> {
  await mcpServer.close();
}
