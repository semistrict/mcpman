import { command } from "cmd-ts";
import { loadConfig } from "../../config/loader.js";
import { EvalRuntime } from "../../eval/runtime.js";
import { createMcpServer, disconnectMcpServer, getMcpServer } from "../../mcp/server.js";
import { UpstreamServerManager } from "../../mcp/upstream-server-manager.js";

export const serveCommand = command({
  name: "serve",
  description: "Start MCPMan server (stdio mode)",
  args: {},
  handler: async () => {
    try {
      // Load configuration
      const config = await loadConfig();

      // Initialize client manager
      const upstreamServerManager = new UpstreamServerManager(config);

      // Initialize eval runtime
      const evalRuntime = new EvalRuntime(upstreamServerManager);

      // Create MCP server
      await createMcpServer(evalRuntime, upstreamServerManager);

      // Handle graceful shutdown
      const shutdown = async () => {
        console.error("Shutting down...");
        await disconnectMcpServer();
        await upstreamServerManager.disconnect();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Server is already started by createMcpServer
      console.error("MCPMan server starting...");

      // Set up roots provider now that MCP server is ready
      upstreamServerManager.setRootsProvider(async () => {
        const mcpServer = await getMcpServer();
        const result = await mcpServer.server.listRoots();
        return result.roots;
      });

      // Upstream servers will be connected when client initializes (see oninitialized callback)
    } catch (error) {
      console.error(
        `Failed to start server: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  },
});
