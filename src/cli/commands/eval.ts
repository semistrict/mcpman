import { command, option, positional, string } from "cmd-ts";
import { loadConfig } from "../../config/loader.js";
import { EvalRuntime } from "../../eval/runtime.js";
import { UpstreamServerManager } from "../../mcp/upstream-server-manager.js";
import { formatEvalResult } from "../../utils/call-tool-result.js";

export const evalCommand = command({
  name: "eval",
  description: "Evaluate an IIFE with access to MCP tools and a parameter object",
  args: {
    code: positional({
      type: string,
      displayName: "function",
      description:
        "Function expression that optionally accepts a single parameter (e.g., '(arg) => arg.value * 2')",
    }),
    arg: option({
      type: string,
      long: "arg",
      short: "a",
      description: "JSON object to pass as parameter to the IIFE",
      defaultValue: () => "{}",
    }),
    roots: option({
      type: string,
      long: "roots",
      short: "r",
      description:
        "Comma-separated root directories to provide to MCP servers (defaults to current directory)",
      defaultValue: () => process.cwd(),
    }),
  },
  handler: async (args) => {
    try {
      // Parse the arg argument as JSON
      let argValue: unknown;
      try {
        argValue = JSON.parse(args.arg);
      } catch (error) {
        throw new Error(
          `Invalid JSON in --arg argument: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Load configuration
      const config = await loadConfig();

      // Initialize client manager with roots provider
      const upstreamServerManager = new UpstreamServerManager(config, async () => {
        const rootDirs = args.roots
          .split(",")
          .map((dir) => dir.trim())
          .filter((dir) => dir.length > 0);
        return rootDirs.map((rootPath: string) => ({
          uri: `file://${rootPath}`,
          name: rootPath,
        }));
      });
      await upstreamServerManager.connectAll();

      // Initialize eval runtime
      const evalRuntime = new EvalRuntime(upstreamServerManager);

      // Execute the function expression with the argument
      const evalResult = await evalRuntime.eval(args.code, argValue);

      // Format the result using the same logic as the MCP server
      const formattedResult = formatEvalResult(evalResult);

      // Output the formatted result
      for (const content of formattedResult.content) {
        if (content.type === "text") {
          console.log(content.text);
        } else {
          console.log(JSON.stringify(content, null, 2));
        }
      }

      await upstreamServerManager.disconnect();
      process.exit(0);
    } catch (error) {
      console.error(`Eval failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  },
});
