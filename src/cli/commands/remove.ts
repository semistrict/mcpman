import { command, positional, string } from "cmd-ts";
import { ConfigError, getConfigPath, loadConfig } from "../../config/loader.js";

export const removeCommand = command({
  name: "remove",
  description: "Remove an MCP server from the configuration",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Server name to remove",
    }),
  },
  handler: async (args) => {
    try {
      // Load config
      const config = await loadConfig();

      const serverName = args.name;

      // Check if server exists
      if (!config.servers[serverName]) {
        throw new Error(`Server '${serverName}' not found in configuration`);
      }

      // Store server info for display before removal
      const serverConfig = config.servers[serverName];

      // Remove server
      delete config.servers[serverName];

      // Save config
      const configPath = getConfigPath();
      await Bun.write(configPath, JSON.stringify(config, null, 2));

      console.log(`✓ Removed server '${serverName}' from configuration`);
      console.log(`Config saved to: ${configPath}`);

      // Show what was removed
      console.log("\nRemoved server configuration:");
      console.log(`  Name: ${serverName}`);
      console.log(`  Transport: ${serverConfig.transport}`);
      if (serverConfig.transport === "stdio") {
        console.log(`  Command: ${serverConfig.command} ${serverConfig.args?.join(" ") || ""}`);
      } else if (serverConfig.transport === "http") {
        console.log(`  URL: ${serverConfig.url}`);
      }
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(`Configuration error: ${error.message}`);
        process.exit(1);
      } else {
        console.error(
          `Failed to remove server: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    }
  },
});
