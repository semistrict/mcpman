import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ConfigError,
  createDefaultConfig,
  ensureConfigDir,
  getConfigPath,
  loadConfig,
} from "../../config/loader.js";
import type { ServerConfig } from "../../config/schema.js";
import { TRACE } from "../../utils/logging.js";
import type { UpstreamServerManager } from "../upstream-server-manager.js";

export function registerInstallTool(
  mcpServer: McpServer,
  upstreamServerManager: UpstreamServerManager,
  _initializedMcpServer: Promise<McpServer>
) {
  TRACE("Registering install tool");
  mcpServer.registerTool(
    "install",
    {
      title: "Install MCP Server",
      description:
        "Add a new MCP server to the configuration. For stdio servers, provide command and args. For HTTP servers, provide url.",
      inputSchema: {
        name: z.string().describe("Server name (letters, numbers, hyphens, underscores only)"),
        transport: z
          .enum(["stdio", "http"])
          .describe("Transport type: 'stdio' for local processes, 'http' for HTTP servers"),
        command: z
          .string()
          .optional()
          .describe("Command to run for stdio transport (e.g., 'npx', 'node', 'python')"),
        args: z.array(z.string()).optional().describe("Arguments for the stdio command"),
        url: z.string().optional().describe("URL for HTTP transport"),
        env: z.record(z.string()).optional().describe("Environment variables for stdio transport"),
        headers: z.record(z.string()).optional().describe("HTTP headers for HTTP transport"),
        disabled: z.boolean().optional().default(false).describe("Add server as disabled"),
      },
    },
    async ({ name, transport, command, args, url, env, headers, disabled }) => {
      return await handleInstall(upstreamServerManager, {
        name,
        transport,
        command,
        args,
        url,
        env,
        headers,
        disabled,
      });
    }
  );
  TRACE("Install tool registered");
}

async function handleInstall(
  upstreamServerManager: UpstreamServerManager,
  params: {
    name: string;
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    disabled?: boolean;
  }
) {
  try {
    const { name, transport, command, args, url, env, headers, disabled } = params;

    // Validate server name
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: Server name must contain only letters, numbers, hyphens, and underscores",
          },
        ],
        isError: true,
      };
    }

    // Build server config based on transport
    let serverConfig: ServerConfig;

    if (transport === "stdio") {
      if (!command) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: 'command' is required for stdio transport",
            },
          ],
          isError: true,
        };
      }

      serverConfig = {
        transport: "stdio",
        command,
        args: args || [],
        env: env || {},
        disabled: disabled || false,
        timeout: 30000,
      };
    } else if (transport === "http") {
      if (!url) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: 'url' is required for HTTP transport",
            },
          ],
          isError: true,
        };
      }

      serverConfig = {
        transport: "http",
        url,
        headers: headers || {},
        disabled: disabled || false,
        timeout: 30000,
      };
    } else {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Unsupported transport: ${transport}`,
          },
        ],
        isError: true,
      };
    }

    // Load or create config
    let config: Awaited<ReturnType<typeof loadConfig>>;
    try {
      config = await loadConfig();
    } catch (error) {
      if (error instanceof ConfigError && error.message.includes("not found")) {
        await ensureConfigDir();
        config = createDefaultConfig();
      } else {
        throw error;
      }
    }

    // Check if server already exists
    if (config.servers[name]) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Server '${name}' already exists in configuration`,
          },
        ],
        isError: true,
      };
    }

    // Add new server
    config.servers[name] = serverConfig;

    // Save config
    const configPath = getConfigPath();
    await Bun.write(configPath, JSON.stringify(config, null, 2));

    // Add and connect the server immediately
    await upstreamServerManager.addServer(name, serverConfig);

    // Build success message
    let message = `✅ Added server '${name}' to configuration\n`;
    message += `Config saved to: ${configPath}\n\n`;
    message += "Server configuration:\n";
    message += `  Name: ${name}\n`;
    message += `  Transport: ${serverConfig.transport}\n`;

    if (serverConfig.transport === "stdio") {
      message += `  Command: ${serverConfig.command} ${serverConfig.args.join(" ")}\n`;
      if (Object.keys(serverConfig.env).length > 0) {
        message += `  Environment: ${Object.entries(serverConfig.env)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}\n`;
      }
    } else if (serverConfig.transport === "http") {
      message += `  URL: ${serverConfig.url}\n`;
      if (Object.keys(serverConfig.headers).length > 0) {
        message += `  Headers: ${Object.entries(serverConfig.headers)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}\n`;
      }
    }

    message += `  Status: ${serverConfig.disabled ? "disabled" : "enabled"}\n`;

    if (!serverConfig.disabled) {
      // Check if server connected successfully
      const connectedServers = upstreamServerManager.getConnectedServers();
      if (connectedServers.includes(name)) {
        message += `\n✅ Server '${name}' is now connected and ready to use`;
      } else {
        message += `\n⚠️  Server '${name}' was added but failed to connect. Check logs for details.`;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: message,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
