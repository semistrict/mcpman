import { command } from "cmd-ts";
import { createDefaultConfig, ensureConfigDir, getConfigPath } from "../../config/loader.js";

export const initCommand = command({
  name: "init",
  description: "Initialize MCPMan configuration",
  args: {},
  handler: async () => {
    try {
      // Ensure config directory exists
      await ensureConfigDir();

      const configPath = getConfigPath();
      const configFile = Bun.file(configPath);

      // Check if config already exists
      if (await configFile.exists()) {
        console.log(`Config file already exists at ${configPath}`);
        return;
      }

      // Create default config
      const defaultConfig = createDefaultConfig();
      await Bun.write(configPath, JSON.stringify(defaultConfig, null, 2));

      console.log(`Created config file at ${configPath}`);
      console.log("\nDefault configuration includes:");
      console.log("- filesystem server using @modelcontextprotocol/server-filesystem");
      console.log("\nEdit the config file to add more MCP servers.");
    } catch (error) {
      console.error(
        `Failed to initialize config: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  },
});
