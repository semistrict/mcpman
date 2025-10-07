import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EvalRuntime } from "../../eval/runtime.js";
import type { UpstreamServerManager } from "../upstream-server-manager.js";
import { TRACE } from "../../utils/logging.js";
import { formatResultOutput } from "./eval.js";

export function registerInvokeTool(
  mcpServer: McpServer,
  upstreamServerManager: UpstreamServerManager,
  evalRuntime: EvalRuntime,
  initializedMcpServer: Promise<McpServer>
) {
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
    _index: number
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
