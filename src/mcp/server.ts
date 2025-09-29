import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { EvalRuntime } from "../eval/runtime.js";
import type { UpstreamServerManager } from "./upstream-server-manager.js";
import { TRACE } from "../utils/logging.js";
import { formatEvalResult } from "../utils/call-tool-result.js";

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
): Promise<McpServer> {
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

  // Register tools immediately with static descriptions
  registerTools(mcpServer, evalRuntime, upstreamServerManager);

  connectMcpServer();

  TRACE("Server created and tools registered, ready for connections");
  return initializedMcpServer;
}

function registerTools(
  mcpServer: McpServer,
  evalRuntime: EvalRuntime,
  upstreamServerManager: UpstreamServerManager
) {
  TRACE("Registering MCP server tools...");

  // Generate static description with configured server names
  const staticDescription = generateStaticEvalDescription(upstreamServerManager);

  // Register eval tool
  TRACE("Registering eval tool");
  mcpServer.registerTool(
    "eval",
    {
      title: "JavaScript Evaluator",
      description: staticDescription,
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
      await initializedMcpServer; // Wait for upstream servers to be connected
      const result = await evalRuntime.eval(code, arg);
      return formatEvalResult(result);
    }
  );
  TRACE("Eval tool registered");

  // Register list_servers tool
  TRACE("Registering list_servers tool");
  mcpServer.registerTool(
    "list_servers",
    {
      title: "List MCP Servers",
      description: "List all connected MCP servers and their tools",
      inputSchema: {},
    },
    async () => {
      await initializedMcpServer; // Wait for upstream servers to be connected
      return await handleListServers(upstreamServerManager);
    }
  );
  TRACE("List_servers tool registered");

  // Register help tool
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
  TRACE("All tools registered successfully");
}

export function getMcpServer(): Promise<McpServer> {
  return initializedMcpServer;
}

function generateStaticEvalDescription(upstreamServerManager: UpstreamServerManager): string {
  const configuredServers = upstreamServerManager.getConfiguredServers();

  let description =
    "Execute a JavaScript function expression with access to MCP tools and a parameter object.\n\n";

  if (configuredServers.length === 0) {
    description += "No MCP servers configured.";
  } else {
    description += "Configured MCP servers:\n\n";
    for (const serverName of configuredServers) {
      description += `• ${serverName}\n`;
    }
    description +=
      "\nUse serverName.toolName(args) to call tools (e.g., filesystem.list_directory({path: '.'}))\n";
    description += "Use help('serverName') to list available tools for each server.";
  }

  return description;
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

async function connectMcpServer(): Promise<void> {
  TRACE("Connecting MCP server to stdio transport");
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  TRACE("MCP server connected to stdio transport");
}

export async function disconnectMcpServer(): Promise<void> {
  await mcpServer.close();
}
