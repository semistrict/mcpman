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
  upstreamServerManager: UpstreamServerManager,
  serverPort?: number
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
  registerTools(mcpServer, evalRuntime, upstreamServerManager, serverPort);

  connectMcpServer();

  TRACE("Server created and tools registered, ready for connections");
  return initializedMcpServer;
}

function registerTools(
  mcpServer: McpServer,
  evalRuntime: EvalRuntime,
  upstreamServerManager: UpstreamServerManager,
  serverPort?: number
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

  // Register invoke tool
  TRACE("Registering invoke tool");
  mcpServer.registerTool(
    "invoke",
    {
      title: "Invoke Tool",
      description:
        "Directly invoke a tool from an underlying MCP server with schema validation. The parameters will be validated against the tool's input schema before invocation.",
      inputSchema: {
        server: z.string().describe("Name of the MCP server"),
        tool: z.string().describe("Name of the tool to invoke"),
        parameters: z.unknown().optional().describe("Parameters to pass to the tool"),
      },
    },
    async ({ server, tool, parameters }) => {
      await initializedMcpServer; // Wait for upstream servers to be connected
      return await handleInvoke(upstreamServerManager, server, tool, parameters);
    }
  );
  TRACE("Invoke tool registered");

  // Register open_ui tool
  TRACE("Registering open_ui tool");
  mcpServer.registerTool(
    "open_ui",
    {
      title: "Open UI",
      description: "Open the MCPMan web UI in the system browser",
      inputSchema: {},
    },
    async () => {
      return await handleOpenUI(serverPort);
    }
  );
  TRACE("Open_ui tool registered");
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

async function handleInvoke(
  upstreamServerManager: UpstreamServerManager,
  serverName: string,
  toolName: string,
  parameters?: unknown
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
      isError: true,
    };
  }

  try {
    // Get the tool schema from the server
    const result = await client.listTools();
    const tools = result.tools || [];
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Tool '${toolName}' not found in server '${serverName}'. Available tools: ${tools.map((t) => t.name).join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Validate parameters against the tool's input schema using Zod
    if (tool.inputSchema) {
      try {
        // Convert JSON Schema to Zod schema and validate
        const zodSchema = jsonSchemaToZod(tool.inputSchema);
        const validatedParams = zodSchema.parse(parameters || {});

        // Call the tool with validated parameters
        const toolResult = await upstreamServerManager.callTool(
          serverName,
          toolName,
          validatedParams
        );

        return {
          content: Array.isArray(toolResult)
            ? toolResult
            : [
                {
                  type: "text" as const,
                  text: JSON.stringify(toolResult, null, 2),
                },
              ],
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Parameter validation error: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    } else {
      // No schema to validate against, call directly
      const toolResult = await upstreamServerManager.callTool(serverName, toolName, parameters);

      return {
        content: Array.isArray(toolResult)
          ? toolResult
          : [
              {
                type: "text" as const,
                text: JSON.stringify(toolResult, null, 2),
              },
            ],
      };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error invoking tool '${toolName}' on server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Convert JSON Schema to Zod schema for validation
function jsonSchemaToZod(schema: unknown): z.ZodType {
  const jsonSchema = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };

  if (!jsonSchema || typeof jsonSchema !== "object") {
    return z.unknown();
  }

  if (jsonSchema.type === "object" && jsonSchema.properties) {
    const shape: Record<string, z.ZodType> = {};
    const required = new Set(jsonSchema.required || []);

    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      let fieldSchema = jsonSchemaToZod(value);
      if (!required.has(key)) {
        fieldSchema = fieldSchema.optional();
      }
      shape[key] = fieldSchema;
    }

    return z.object(shape);
  }

  if (jsonSchema.type === "array") {
    return z.array(z.unknown());
  }

  if (jsonSchema.type === "string") {
    return z.string();
  }

  if (jsonSchema.type === "number") {
    return z.number();
  }

  if (jsonSchema.type === "integer") {
    return z.number().int();
  }

  if (jsonSchema.type === "boolean") {
    return z.boolean();
  }

  if (jsonSchema.type === "null") {
    return z.null();
  }

  return z.unknown();
}

async function handleOpenUI(serverPort?: number) {
  const port = serverPort || process.env.MCPMAN_UI_PORT || 8726;
  const url = `http://localhost:${port}`;

  try {
    // Use system's default browser to open the URL
    const { spawn } = await import("node:child_process");
    const platform = process.platform;

    let command: string;
    let args: string[];

    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "start";
      args = ["", url];
    } else {
      // Linux and other Unix-like systems
      command = "xdg-open";
      args = [url];
    }

    spawn(command, args, { detached: true, stdio: "ignore" });

    return {
      content: [
        {
          type: "text" as const,
          text: `Opened MCPMan UI in browser: ${url}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to open browser: ${error instanceof Error ? error.message : String(error)}. Please manually open: ${url}`,
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
