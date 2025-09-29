import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function tryParseAsCallToolResult(result: unknown): CallToolResult | null {
  // Check if result is a content array from upstream server
  if (Array.isArray(result) && result.length > 0) {
    // Check if it looks like MCP content (has type property)
    const isContent = result.every(
      (item) => typeof item === "object" && item !== null && "type" in item
    );

    if (isContent) {
      return {
        content: result as any[],
      };
    }
  }

  return null;
}

export function formatDefaultResult(result: unknown, output?: string): CallToolResult {
  const serializedResult =
    typeof result === "object" && result !== null ? JSON.stringify(result) : String(result);

  return {
    content: [
      {
        type: "text" as const,
        text: `Result: ${serializedResult}${output ? `\nOutput:\n${output}` : ""}`,
      },
    ],
  };
}

export function formatEvalResult(evalResult: { result: unknown; output?: string }): CallToolResult {
  const callToolResult = tryParseAsCallToolResult(evalResult.result);
  if (callToolResult) {
    return callToolResult;
  }

  return formatDefaultResult(evalResult.result, evalResult.output);
}
