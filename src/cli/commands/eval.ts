import { command, positional, string, option } from "cmd-ts";
import { loadConfig } from "../../config/loader.js";
import { EvalRuntime } from "../../eval/runtime.js";
import { ClientManager } from "../../mcp/client-manager.js";

export const evalCommand = command({
  name: "eval",
  description: "Evaluate JavaScript code with access to MCP tools",
  args: {
    code: positional({
      type: string,
      displayName: "code",
      description: "JavaScript code to evaluate",
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
    const code = args.code;

    try {
      // Load configuration
      const config = await loadConfig();

      // Initialize client manager with roots provider
      const clientManager = new ClientManager(config, async () => {
        const rootDirs = args.roots
          .split(",")
          .map((dir) => dir.trim())
          .filter((dir) => dir.length > 0);
        return rootDirs.map((rootPath: string) => ({
          uri: `file://${rootPath}`,
          name: rootPath,
        }));
      });
      await clientManager.connectAll();

      // Initialize eval runtime
      const evalRuntime = new EvalRuntime(clientManager);

      // Execute the code
      const { result, output } = await evalRuntime.eval(code);

      // Output console logs/errors first
      if (output) {
        console.log(output);
      }

      // Output the result
      if (result !== undefined) {
        if (typeof result === "string") {
          console.log(result);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }

      await clientManager.disconnect();
      process.exit(0);
    } catch (error) {
      console.error(`Eval failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  },
});
