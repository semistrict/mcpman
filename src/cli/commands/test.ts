import { command, positional, string } from "cmd-ts";
import { loadConfig } from "../../config/loader.js";
import { ClientManager } from "../../mcp/client-manager.js";

export const testCommand = command({
  name: "test",
  description: "Test connection to a specific server",
  args: {
    server: positional({
      type: string,
      displayName: "server",
      description: "Name of the server to test",
    }),
  },
  handler: async (args) => {
    const serverName = args.server;

    try {
      const config = await loadConfig();

      // Check if server exists in config
      if (!config.servers[serverName]) {
        throw new Error(`Server '${serverName}' not found in configuration`);
      }

      const serverConfig = config.servers[serverName];
      if (!serverConfig) {
        throw new Error(`Server '${serverName}' not found in configuration`);
      }

      if (serverConfig.disabled) {
        console.log(`Server '${serverName}' is disabled`);
        return;
      }

      console.log(`Testing connection to server '${serverName}'...`);

      // Show config details
      if (serverConfig.transport === "stdio") {
        console.log(`Transport: stdio`);
        console.log(`Command: ${serverConfig.command} ${serverConfig.args.join(" ")}`);
      } else if (serverConfig.transport === "http") {
        console.log(`Transport: http`);
        console.log(`URL: ${serverConfig.url}`);
      }

      // Test connection
      const clientManager = new ClientManager(config);
      await clientManager.connectAll();

      const client = clientManager.getClient(serverName);
      if (!client) {
        console.log("✗ Failed to connect");
        await clientManager.disconnect();
        return;
      }

      console.log("✓ Connected successfully");

      // Test tool listing
      try {
        const result = await client.listTools();
        const tools = result.tools || [];

        console.log(`✓ Listed tools (${tools.length} available)`);

        if (tools.length > 0) {
          console.log("\nAvailable tools:");
          for (const tool of tools) {
            console.log(`  - ${tool.name}: ${tool.description || "No description"}`);
          }
        }
      } catch (error) {
        console.log(
          `✗ Failed to list tools: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await clientManager.disconnect();
    } catch (error) {
      console.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  },
});
