import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EvalRuntime } from "../../eval/runtime.js";
import type { ToolManager } from "../tool-manager.js";
import { TRACE } from "../../utils/logging.js";
import { validateTypeScript } from "./validation.js";

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

export function registerEvalTool(
  mcpServer: McpServer,
  evalRuntime: EvalRuntime,
  toolManager: ToolManager,
  initializedMcpServer: Promise<McpServer>
) {
  TRACE("Registering eval tool");
  mcpServer.registerTool(
    "eval",
    {
      title: "JavaScript Evaluator",
      description:
        "Execute a JavaScript function expression with access to MCP tools. Code is validated with TypeScript compiler before execution. Results are stored in the $results array. Use the `vars` object to persist variables across eval calls (e.g., vars.x = 42; return vars.x;)",
      inputSchema: {
        code: z
          .string()
          .describe(
            "Function expression that optionally accepts a single parameter. Use serverName.toolName(args) to call tools. Use vars object to persist state across calls (e.g., vars.x = 42)."
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

      // Validate code with TypeScript before execution
      const typeDefinitions = await toolManager.getTypeDefinitions();
      const validation = validateTypeScript(code, typeDefinitions);

      if (!validation.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: `TypeScript validation failed. Please fix the errors in your code:\n\n${validation.errors}`,
            },
          ],
          isError: true,
        };
      }

      // Execute the validated code
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
}

export { formatResultOutput, truncateResult };
