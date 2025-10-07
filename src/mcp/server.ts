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

  // Register eval tool
  TRACE("Registering eval tool");
  mcpServer.registerTool(
    "eval",
    {
      title: "JavaScript Evaluator",
      description:
        "Execute a JavaScript function expression with access to MCP tools. Results from the invoke tool are stored in the $results array.",
      inputSchema: {
        code: z
          .string()
          .describe(
            "Function expression that optionally accepts a single parameter. Use serverName.toolName(args) to call tools."
          ),
        arg: z
          .object({})
          .passthrough()
          .optional()
          .describe("Object to pass as parameter to the function"),
      },
    },
    async ({ code, arg }) => {
      await initializedMcpServer; // Wait for upstream servers to be connected
      const result = await evalRuntime.eval(code, arg);

      // Combine result and output for storage in $results
      let combinedResult: unknown;
      if (result.output) {
        // If there's output, combine it with the result
        if (typeof result.result === "string") {
          combinedResult = `${result.result}\n${result.output}`;
        } else if (typeof result.result === "object" && result.result !== null) {
          combinedResult = `${JSON.stringify(result.result)}\n${result.output}`;
        } else {
          combinedResult = `${String(result.result)}\n${result.output}`;
        }
      } else {
        combinedResult = result.result;
      }

      // Store combined result in $results and get index
      const resultsIndex = await evalRuntime.appendResult(combinedResult);

      // Format output with $results pointer
      const formattedOutput = formatResultOutput(resultsIndex, "eval", combinedResult);
      return {
        content: [
          {
            type: "text" as const,
            text: formattedOutput,
          },
        ],
      };
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
      title: "Invoke Tools",
      description:
        "Invoke multiple tools from underlying MCP servers with schema validation. Pass an array of tool calls to invoke them together rather than making separate tool calls one after another. In parallel mode (parallel: true), all tools are invoked concurrently and all results/errors are returned. In sequential mode (parallel: false, default), tools are invoked one at a time in order, stopping and returning results so far if any tool fails.",
      inputSchema: {
        calls: z
          .array(
            z.object({
              server: z.string().describe("Name of the MCP server"),
              tool: z.string().describe("Name of the tool to invoke"),
              parameters: z
                .object({})
                .passthrough()
                .optional()
                .describe("Parameters to pass to the tool"),
            })
          )
          .describe("Array of tool calls to invoke"),
        parallel: z
          .boolean()
          .default(false)
          .describe("Whether to invoke tools in parallel or sequentially"),
      },
    },
    async ({ calls, parallel }) => {
      await initializedMcpServer; // Wait for upstream servers to be connected
      return await handleInvoke(upstreamServerManager, evalRuntime, calls, parallel);
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

function truncateResult(text: string, resultsIndex: number, maxLength = 250): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncationMsg = `\n\n... (result truncated, see $results[${resultsIndex}] for full result) ...\n\n`;
  const sideLength = Math.floor((maxLength - truncationMsg.length) / 2);
  const start = text.slice(0, sideLength);
  const end = text.slice(-sideLength);

  return `${start}${truncationMsg}${end}`;
}

function formatResultOutput(resultsIndex: number, label: string, rawResult: unknown): string {
  // Convert result to text
  let resultText: string;
  if (Array.isArray(rawResult)) {
    resultText = rawResult
      .map((item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item
          ? item.text
          : JSON.stringify(item)
      )
      .join("\n");
  } else if (typeof rawResult === "object" && rawResult !== null) {
    resultText = JSON.stringify(rawResult, null, 2);
  } else {
    resultText = String(rawResult);
  }

  // Truncate if needed
  resultText = truncateResult(resultText, resultsIndex);

  // Format with $results pointer
  return `$results[${resultsIndex}] = // ${label}\n${resultText}`;
}

function unwrapToolResult(toolResult: unknown): unknown {
  // If it's an array of content items, unwrap them
  if (Array.isArray(toolResult)) {
    // If single text item, return just the text
    if (toolResult.length === 1 && toolResult[0]?.type === "text" && "text" in toolResult[0]) {
      return toolResult[0].text;
    }
    // If multiple items, return array of unwrapped items
    return toolResult.map((item) => {
      if (item?.type === "text" && "text" in item) {
        return item.text;
      }
      return item;
    });
  }
  return toolResult;
}

async function handleInvoke(
  upstreamServerManager: UpstreamServerManager,
  evalRuntime: EvalRuntime,
  calls: Array<{ server: string; tool: string; parameters?: unknown }>,
  parallel: boolean
) {
  const invokeSingle = async (
    call: { server: string; tool: string; parameters?: unknown },
    index: number
  ): Promise<{
    success: boolean;
    result: { type: "text"; text: string };
    toolResult?: unknown;
    resultsIndex?: number;
  }> => {
    const { server: serverName, tool: toolName, parameters } = call;

    const client = upstreamServerManager.getClient(serverName);
    if (!client) {
      return {
        success: false,
        result: {
          type: "text" as const,
          text: `Error: Server '${serverName}' not found. Available servers: ${upstreamServerManager.getConnectedServers().join(", ")}`,
        },
      };
    }

    try {
      // Get the tool schema from the server
      const result = await client.listTools();
      const tools = result.tools || [];
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        return {
          success: false,
          result: {
            type: "text" as const,
            text: `Error: Tool '${toolName}' not found in server '${serverName}'. Available tools: ${tools.map((t) => t.name).join(", ")}`,
          },
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

          // Unwrap and append to $results
          const unwrappedResult = unwrapToolResult(toolResult);
          const resultsIndex = await evalRuntime.appendResult(unwrappedResult);

          // Format output with shared function
          const formattedOutput = formatResultOutput(
            resultsIndex,
            `${serverName}.${toolName}`,
            toolResult
          );

          return {
            success: true,
            result: {
              type: "text" as const,
              text: formattedOutput,
            },
            toolResult,
            resultsIndex,
          };
        } catch (error) {
          if (error instanceof z.ZodError) {
            return {
              success: false,
              result: {
                type: "text" as const,
                text: `Parameter validation error: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
              },
            };
          }
          throw error;
        }
      } else {
        // No schema to validate against, call directly
        const toolResult = await upstreamServerManager.callTool(serverName, toolName, parameters);

        // Unwrap and append to $results
        const unwrappedResult = unwrapToolResult(toolResult);
        const resultsIndex = await evalRuntime.appendResult(unwrappedResult);

        // Format output with shared function
        const formattedOutput = formatResultOutput(
          resultsIndex,
          `${serverName}.${toolName}`,
          toolResult
        );

        return {
          success: true,
          result: {
            type: "text" as const,
            text: formattedOutput,
          },
          toolResult,
          resultsIndex,
        };
      }
    } catch (error) {
      return {
        success: false,
        result: {
          type: "text" as const,
          text: `Error invoking tool '${toolName}' on server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  };

  let results: Array<{ type: "text"; text: string }>;

  if (parallel) {
    // Invoke all calls in parallel, all results and errors are returned
    const allResults = await Promise.all(calls.map((call, index) => invokeSingle(call, index)));
    results = allResults.map((r) => r.result);
  } else {
    // Invoke calls sequentially, stop on first error
    results = [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (!call) continue;
      const { success, result } = await invokeSingle(call, i);
      results.push(result);
      if (!success) {
        break;
      }
    }
  }

  return {
    content: results,
  };
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
