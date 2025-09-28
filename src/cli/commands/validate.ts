import { command } from "cmd-ts";
import { ConfigError, loadConfig } from "../../config/loader.js";
import { ClientManager } from "../../mcp/client-manager.js";

export const validateCommand = command({
  name: "validate",
  description: "Validate MCPMan configuration and test server connections",
  args: {},
  handler: async () => {
    try {
      // Validate config syntax
      console.log("Validating configuration...");
      const config = await loadConfig();
      console.log("✓ Configuration is valid");

      // Test server connections
      console.log("\nTesting server connections...");
      const clientManager = new ClientManager(config);

      const serverNames = Object.keys(config.servers).filter(
        (name) => !config.servers[name]?.disabled
      );

      if (serverNames.length === 0) {
        console.log("No enabled servers to test");
        return;
      }

      // Connect to all servers
      await clientManager.connectAll();

      // Check each server
      for (const serverName of serverNames) {
        const client = clientManager.getClient(serverName);
        if (client) {
          try {
            // Try to list tools to verify connection
            await client.listTools();
            console.log(`✓ ${serverName}: Connected`);
          } catch (error) {
            console.log(
              `✗ ${serverName}: Failed to list tools - ${error instanceof Error ? error.message : String(error)}`
            );
          }
        } else {
          console.log(`✗ ${serverName}: Not connected`);
        }
      }

      // Clean up connections
      await clientManager.disconnect();
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(`Configuration error: ${error.message}`);
        process.exit(1);
      } else {
        console.error(
          `Validation failed: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    }
  },
});
