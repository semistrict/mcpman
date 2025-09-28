import { command } from "cmd-ts";
import { loadConfig } from "../../config/loader.js";
import { UpstreamServerManager } from "../../mcp/upstream-server-manager.js";

export const listCommand = command({
  name: "list",
  description: "List configured servers and their tools",
  args: {},
  handler: async () => {
    try {
      const config = await loadConfig();
      const upstreamServerManager = new UpstreamServerManager(config);

      console.log("MCPMan Server Configuration\n");

      // Show all configured servers
      for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        const status = serverConfig.disabled ? "disabled" : "enabled";
        console.log(`${serverName} (${serverConfig.transport}, ${status})`);

        if (serverConfig.transport === "stdio") {
          console.log(`  Command: ${serverConfig.command} ${serverConfig.args.join(" ")}`);
        } else if (serverConfig.transport === "http") {
          console.log(`  URL: ${serverConfig.url}`);
        }
      }

      // Connect and show tools for enabled servers
      const enabledServers = Object.entries(config.servers).filter(
        ([_, config]) => !config.disabled
      );

      if (enabledServers.length === 0) {
        console.log("\nNo enabled servers.");
        return;
      }

      console.log("\nConnecting to servers...");
      await upstreamServerManager.connectAll();

      const toolMap = await upstreamServerManager.getAllTools();

      console.log("\nAvailable Tools:\n");

      for (const [serverName, tools] of toolMap) {
        console.log(`${serverName}:`);
        if (tools.length === 0) {
          console.log("  No tools available");
        } else {
          for (const tool of tools) {
            console.log(`  - ${tool.name}: ${tool.description || "No description"}`);
          }
        }
        console.log("");
      }

      await upstreamServerManager.disconnect();
    } catch (error) {
      console.error(
        `Failed to list servers: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  },
});
