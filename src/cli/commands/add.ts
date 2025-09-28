import { boolean, command, flag, option, positional, restPositionals, string } from "cmd-ts";
import { OAuthCallbackServer } from "../../auth/callback-server.js";
import { MCPManOAuthProvider } from "../../auth/oauth-provider.js";
import {
  ConfigError,
  createDefaultConfig,
  ensureConfigDir,
  getConfigPath,
  loadConfig,
} from "../../config/loader.js";
import type { HttpServerConfig, ServerConfig, Settings } from "../../config/schema.js";

const transportType = {
  from: async (str: string) => {
    if (str !== "stdio" && str !== "http" && str !== "auto") {
      throw new Error("Transport must be 'stdio', 'http', or 'auto'");
    }
    return str as "stdio" | "http" | "auto";
  },
};

export const addCommand = command({
  name: "add",
  description: "Add a new MCP server to the configuration",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Server name",
    }),
    urlOrCommand: positional({
      type: string,
      displayName: "url-or-command",
      description: "URL for HTTP server or command for stdio server",
    }),
    transport: option({
      short: "t",
      long: "transport",
      type: transportType,
      description: "Transport type (auto-detected if not specified)",
      defaultValue: () => "auto" as "stdio" | "http" | "auto",
    }),
    env: option({
      short: "e",
      long: "env",
      type: string,
      description: "Environment variable (KEY=value, can be repeated)",
      defaultValue: () => "",
    }),
    header: option({
      long: "header",
      type: string,
      description: "HTTP header (KEY=value, can be repeated)",
      defaultValue: () => "",
    }),
    disabled: flag({
      long: "disabled",
      type: boolean,
      description: "Add server as disabled",
      defaultValue: () => false,
    }),
    args: restPositionals({
      type: string,
      description: "Additional arguments for stdio transport",
    }),
  },
  handler: async (args) => {
    try {
      // Parse environment variables
      const env: Record<string, string> = {};
      if (args.env) {
        const [key, ...valueParts] = args.env.split("=");
        if (!key || valueParts.length === 0) {
          throw new Error(`Invalid environment variable format: ${args.env}. Use KEY=value`);
        }
        env[key] = valueParts.join("=");
      }

      // Parse HTTP headers
      const headers: Record<string, string> = {};
      if (args.header) {
        const [key, ...valueParts] = args.header.split("=");
        if (!key || valueParts.length === 0) {
          throw new Error(`Invalid header format: ${args.header}. Use KEY=value`);
        }
        headers[key] = valueParts.join("=");
      }

      // Auto-detect transport if not specified
      let transport = args.transport;
      if (transport === "auto") {
        // Auto-detect based on URL pattern
        if (args.urlOrCommand.startsWith("http://") || args.urlOrCommand.startsWith("https://")) {
          transport = "http";
        } else {
          transport = "stdio";
        }
      }

      let serverConfig: ServerConfig;

      if (transport === "stdio") {
        // Parse command and args - urlOrCommand is the command, args.args are additional args
        const allArgs = [args.urlOrCommand, ...args.args];
        const [command, ...cmdArgs] = allArgs;

        if (!command) {
          throw new Error("Command is required for stdio transport");
        }

        serverConfig = {
          transport: "stdio",
          command,
          args: cmdArgs,
          env,
          disabled: args.disabled,
          timeout: 30000,
        };
      } else if (transport === "http") {
        serverConfig = {
          transport: "http",
          url: args.urlOrCommand,
          headers,
          disabled: args.disabled,
          timeout: 30000,
        };
      } else {
        throw new Error(`Unsupported transport: ${transport}`);
      }

      const serverName = args.name;

      // Validate server name
      if (!serverName || !/^[a-zA-Z0-9_-]+$/.test(serverName)) {
        throw new Error("Server name must contain only letters, numbers, hyphens, and underscores");
      }

      // Load or create config
      let config: Settings;
      try {
        config = await loadConfig();
      } catch (error) {
        if (error instanceof ConfigError && error.message.includes("not found")) {
          console.log("Config file not found, creating default config...");
          await ensureConfigDir();
          config = createDefaultConfig();
        } else {
          throw error;
        }
      }

      // Check if server already exists
      if (config.servers[serverName]) {
        throw new Error(`Server '${serverName}' already exists in configuration`);
      }

      // For HTTP servers, detect OAuth and authenticate before saving config
      if (serverConfig.transport === "http") {
        console.log(`🔍 Checking OAuth requirements for '${serverName}'...`);

        // Try to detect OAuth support
        const oauthConfig = await detectOAuthSupport(args.urlOrCommand);

        if (oauthConfig && "clientName" in oauthConfig) {
          console.log(`🔐 OAuth authentication required for '${serverName}'`);
          console.log("Starting authentication flow...");

          // Add OAuth config to server config
          serverConfig.oauth = oauthConfig;

          // Authenticate before saving
          await authenticateServer(serverName, serverConfig);
          console.log(`✅ Authentication successful!`);
        }
      }

      // Add new server (now with OAuth config if detected)
      config.servers[serverName] = serverConfig;

      // Save config
      const configPath = getConfigPath();
      await Bun.write(configPath, JSON.stringify(config, null, 2));

      console.log(`✓ Added server '${serverName}' to configuration`);
      console.log(`Config saved to: ${configPath}`);

      // Show summary
      console.log("\nServer configuration:");
      console.log(`  Name: ${serverName}`);
      console.log(`  Transport: ${serverConfig.transport}`);
      if (serverConfig.transport === "stdio") {
        console.log(`  Command: ${serverConfig.command} ${serverConfig.args.join(" ")}`);
        if (Object.keys(serverConfig.env).length > 0) {
          console.log(
            `  Environment: ${Object.entries(serverConfig.env)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}`
          );
        }
      } else if (serverConfig.transport === "http") {
        console.log(`  URL: ${serverConfig.url}`);
        if (Object.keys(serverConfig.headers).length > 0) {
          console.log(
            `  Headers: ${Object.entries(serverConfig.headers)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}`
          );
        }
      }
      console.log(`  Status: ${serverConfig.disabled ? "disabled" : "enabled"}`);
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(`Configuration error: ${error.message}`);
        process.exit(1);
      } else {
        console.error(
          `Failed to add server: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    }
  },
});

interface OAuthDetectionError {
  requiresOAuth: boolean;
  error?: string;
}

interface OAuthConfig {
  clientName: string;
  redirectUrl: string;
  scopes: string[];
  clientId?: string;
  clientSecret?: string;
}

async function detectOAuthSupport(url: string): Promise<OAuthDetectionError | OAuthConfig | null> {
  try {
    // Try to make an unauthenticated request to detect OAuth requirements
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "mcpman",
            version: "1.0.0",
          },
        },
      }),
    });

    // If we get 401, check for OAuth metadata
    if (response.status === 401) {
      const wwwAuth = response.headers.get("www-authenticate");

      if (wwwAuth && (wwwAuth.includes("Bearer") || wwwAuth.includes("oauth"))) {
        console.log("🔍 OAuth required - server returned 401 with authentication requirement");

        // Return basic OAuth config for MCP
        return {
          clientName: "mcpman",
          redirectUrl: "http://localhost:8080/oauth/callback",
          scopes: ["mcp:tools"],
        };
      }
    }

    // No OAuth required
    return null;
  } catch (error) {
    // Network errors or other issues - assume no OAuth for now
    console.log(
      `ℹ️  Could not detect OAuth requirements: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

async function authenticateServer(
  serverName: string,
  serverConfig: HttpServerConfig
): Promise<void> {
  const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

  // Start callback server
  const callbackServer = new OAuthCallbackServer(8080);
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
      const client = new Client({ name: "mcpman-auth", version: "1.0.0" }, { capabilities: {} });

      await client.connect(transport);
      console.log("✅ Already authenticated!");

      // Clean up and return early since we're already authenticated
      await client.close();
      return;
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

        // Test the connection again with a fresh transport
        const testAuthProvider = new MCPManOAuthProvider(serverName, serverConfig);
        const testTransport = new StreamableHTTPClientTransport(serverUrl, {
          authProvider: testAuthProvider,
        });

        const testClient = new Client(
          { name: "mcpman-auth-test", version: "1.0.0" },
          { capabilities: {} }
        );

        await testClient.connect(testTransport);
        await testClient.close();
      } else {
        throw error;
      }
    }
  } finally {
    await callbackServer.stop();
    console.log("📡 OAuth callback server stopped");
  }
}

async function _promptForServerName(): Promise<string> {
  // Simple readline-like prompt for server name
  process.stdout.write("Enter server name: ");

  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      const name = data.toString().trim();
      resolve(name);
    });
  });
}
