import { command, option, positional, string } from "cmd-ts";
import { loadConfig } from "../../config/loader.js";
import { EvalRuntime } from "../../eval/runtime.js";
import { ToolManager } from "../../mcp/tool-manager.js";
import { UpstreamServerManager } from "../../mcp/upstream-server-manager.js";
import { formatEvalResult } from "../../utils/call-tool-result.js";
import { generateCodeWithAgentSDK } from "../../mcp/tools/code.js";

export const codeCommand = command({
  name: "code",
  description: "Generate and execute code from a natural language description using Agent SDK",
  args: {
    description: positional({
      type: string,
      displayName: "description",
      description:
        "Natural language description of what the code should do (e.g., 'list all files in the current directory')",
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
      console.log("Generating code from description...");

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

      // Initialize eval runtime and tool manager
      const evalRuntime = new EvalRuntime(upstreamServerManager);
      const toolManager = new ToolManager(upstreamServerManager, evalRuntime);

      // Generate TypeScript type definitions
      const typeDefinitions = await toolManager.getTypeDefinitions();

      // Generate code using Agent SDK
      const generatedCode = await generateCodeWithAgentSDK(args.description, typeDefinitions);

      console.log("\nGenerated code:");
      console.log("─".repeat(80));
      console.log(generatedCode);
      console.log("─".repeat(80));
      console.log("\nExecuting...\n");

      // Execute the generated code
      const evalResult = await toolManager.executeCode(generatedCode, {});

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
      console.error(
        `Code generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  },
});
