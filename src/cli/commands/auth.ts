import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { boolean, command, flag, number, option, string } from "cmd-ts";
import { OAuthCallbackServer } from "../../auth/callback-server.js";
import { MCPManOAuthProvider } from "../../auth/oauth-provider.js";
import { TokenStorage } from "../../auth/token-storage.js";
import { ConfigError, loadConfig } from "../../config/loader.js";
import { ServerConfigSchema, type HttpServerConfig, type Settings } from "../../config/schema.js";

export const authCommand = command({
  name: "auth",
  description: "Authenticate with OAuth-enabled MCP servers",
  args: {
    reset: flag({
      long: "reset",
      type: boolean,
      description: "Reset stored credentials for the server",
      defaultValue: () => false,
    }),
    list: flag({
      long: "list",
      type: boolean,
      description: "List authentication status for all servers",
      defaultValue: () => false,
    }),
    port: option({
      long: "port",
      type: number,
      description: "Port for OAuth callback server",
      defaultValue: () => 8080,
    }),
    server: option({
      long: "server",
      type: string,
      description: "Name of the server to authenticate with",
    }),
  },
  handler: async (args) => {
    try {
      const config = await loadConfig();

      if (args.list) {
        await listAuthStatus(config);
        return;
      }

      if (!args.server) {
        throw new Error("Server name is required unless using --list");
      }

      const serverName = args.server;
      if (!serverName) {
        throw new Error("Server name is required");
      }
      const rawConfig = config.servers[serverName];

      if (!rawConfig) {
        throw new Error(`Server '${serverName}' not found in configuration`);
      }

      const serverConfig = ServerConfigSchema.parse(rawConfig);

      if (serverConfig.transport !== "http") {
        throw new Error(`Server '${serverName}' is not an HTTP server (OAuth not applicable)`);
      }

      if (!serverConfig.oauth) {
        throw new Error(`Server '${serverName}' does not have OAuth configured`);
      }

      if (args.reset) {
        await resetAuth(serverName);
        return;
      }

      await authenticateServer(serverName, serverConfig, args.port);
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(`Configuration error: ${error.message}`);
        process.exit(1);
      } else {
        console.error(
          `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    }
  },
});

async function listAuthStatus(config: Settings): Promise<void> {
  const tokenStorage = new TokenStorage();

  console.log("Authentication Status:\n");

  for (const [serverName, serverConfig] of Object.entries(config.servers)) {
    const parsedConfig = ServerConfigSchema.parse(serverConfig);
    if (parsedConfig.transport === "http" && parsedConfig.oauth) {
      const tokens = await tokenStorage.loadTokens(serverName);
      const hasTokens = !!tokens?.access_token;
      const isExpired = tokens?.expires_in
        ? Date.now() / 1000 > Date.now() / 1000 + tokens.expires_in
        : false;

      let status = "❌ Not authenticated";
      if (hasTokens && !isExpired) {
        status = "✅ Authenticated";
      } else if (hasTokens && isExpired) {
        status = "⚠️  Expired tokens";
      }

      console.log(`${serverName}: ${status}`);
    } else {
      console.log(`${serverName}: 🔓 No OAuth (${parsedConfig.transport})`);
    }
  }
}

async function resetAuth(serverName: string): Promise<void> {
  const tokenStorage = new TokenStorage();
  await tokenStorage.deleteTokenData(serverName);
  console.log(`✅ Reset authentication data for server '${serverName}'`);
}

async function authenticateServer(
  serverName: string,
  serverConfig: HttpServerConfig,
  port: number
): Promise<void> {
  console.log(`🔐 Starting OAuth authentication for server '${serverName}'...`);

  // Start callback server
  const callbackServer = new OAuthCallbackServer(port);
  const callbackUrl = await callbackServer.start();

  console.log(`📡 OAuth callback server started on ${callbackUrl}`);

  try {
    // Create OAuth provider with callback handling
    const authProvider = new MCPManOAuthProvider(serverName, serverConfig, (authUrl) => {
      console.log(`\n🌐 Opening browser for authorization...`);
      console.log(`If the browser doesn't open automatically, please visit:`);
      console.log(`${authUrl.toString()}\n`);

      // Try to open browser
      const command =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";

      try {
        require("node:child_process").exec(`${command} "${authUrl.toString()}"`);
      } catch (_error) {
        // Ignore browser open errors
      }
    });

    // Create transport and attempt connection
    const serverUrl = new URL(serverConfig.url);
    const transport = new StreamableHTTPClientTransport(serverUrl, {
      authProvider,
    });

    // This will trigger the OAuth flow if needed
    try {
      console.log("🔌 Attempting connection...");

      // Create a mock client to trigger auth
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const client = new Client({ name: "mcpman-auth", version: "1.0.0" }, { capabilities: {} });

      await client.connect(transport);
      console.log("✅ Already authenticated!");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log("⏳ Waiting for authorization callback...");

        // Wait for callback
        const result = await callbackServer.waitForCallback(300000); // 5 minute timeout

        if (result.error) {
          throw new Error(
            `OAuth error: ${result.error}${result.error_description ? ` - ${result.error_description}` : ""}`
          );
        }

        if (!result.code) {
          throw new Error("No authorization code received");
        }

        // Complete the auth flow
        console.log("🔄 Exchanging authorization code for tokens...");
        await transport.finishAuth(result.code);

        // Test the connection again
        const testClient = new Client(
          { name: "mcpman-auth-test", version: "1.0.0" },
          { capabilities: {} }
        );

        await testClient.connect(transport);
        console.log("✅ Authentication successful!");
      } else {
        throw error;
      }
    }
  } finally {
    await callbackServer.stop();
    console.log("📡 OAuth callback server stopped");
  }
}
