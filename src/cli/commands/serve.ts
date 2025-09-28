import { command } from "cmd-ts";
import { loadConfig } from "../../config/loader.js";
import { EvalRuntime } from "../../eval/runtime.js";
import { ClientManager } from "../../mcp/client-manager.js";
import { MCPServer } from "../../mcp/server.js";

export const serveCommand = command({
  name: "serve",
  description: "Start MCPMan server (stdio mode)",
  args: {},
  handler: async () => {
    try {
      // Load configuration
      const config = await loadConfig();

      // Initialize client manager and connect to all servers
      const clientManager = new ClientManager(config);
      await clientManager.connectAll();

      // Initialize eval runtime
      const evalRuntime = new EvalRuntime(clientManager);

      // Create MCP server
      const mcpServer = new MCPServer();
      mcpServer.setDependencies(evalRuntime, clientManager);

      // Handle graceful shutdown
      const shutdown = async () => {
        console.error("Shutting down...");
        await mcpServer.close();
        await clientManager.disconnect();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Start the server
      console.error("MCPMan server starting...");
      await mcpServer.listen();
    } catch (error) {
      console.error(
        `Failed to start server: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  },
});
