import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ListToolsResult, Root, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCPManOAuthProvider } from "../auth/oauth-provider.js";
import { TRACE } from "../utils/logging.js";
import type {
  HttpServerConfig,
  ServerConfig,
  Settings,
  StdioServerConfig,
} from "../config/schema.js";

type RootsProvider = () => Promise<Root[]>;

export class UpstreamServerManager {
  private clients = new Map<string, Client>();

  constructor(
    private settings: Settings,
    private rootsProvider?: RootsProvider
  ) {}

  async connectAll(): Promise<void> {
    const servers = Object.entries(this.settings.servers).filter(([_, config]) => !config.disabled);
    TRACE(`Starting to connect to ${servers.length} servers`);

    const promises = servers.map(([name, config]) => this.connectServer(name, config));

    await Promise.allSettled(promises);
    TRACE(`Finished connecting to all servers. Connected: ${this.clients.size}`);
  }

  private async connectServer(name: string, config: ServerConfig): Promise<void> {
    try {
      TRACE(`[${name}] Attempting to connect to ${config.transport} server`);
      if (config.transport === "stdio") {
        await this.connectStdioServer(name, config);
      } else if (config.transport === "http") {
        await this.connectHttpServer(name, config);
      }
      TRACE(`[${name}] Successfully connected to ${config.transport} server`);
    } catch (error) {
      TRACE(`[${name}] Failed to connect to server:`, error);
      console.error(`Failed to connect to server ${name}:`, error);
    }
  }

  private async connectStdioServer(name: string, config: StdioServerConfig): Promise<void> {
    TRACE(`[${name}] Creating transport for command: ${config.command} ${config.args?.join(" ")}`);
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...(Object.fromEntries(
          Object.entries(process.env).filter(([_key, value]) => value !== undefined)
        ) as Record<string, string>),
        ...config.env,
      },
    });

    TRACE(`[${name}] Creating client`);
    const client = new Client(
      {
        name: "mcpman",
        version: "1.0.0",
      },
      {
        capabilities: {
          roots: { listChanged: true },
        },
      }
    );

    // Set up roots handler - MCPMan will get roots FROM its client and provide TO upstream servers
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      TRACE(`[${name}] Roots requested by upstream server`);
      if (!this.rootsProvider) {
        TRACE(`[${name}] No roots provider available, returning empty roots`);
        return { roots: [] };
      }
      const roots = await this.rootsProvider();
      TRACE(`[${name}] Providing roots to upstream server:`, roots);
      return { roots };
    });

    TRACE(`[${name}] Attempting client.connect(transport)`);
    await client.connect(transport);
    this.clients.set(name, client);
    TRACE(`[${name}] Successfully connected to stdio server`);

    // Notify the newly connected server about roots if we have a provider
    if (this.rootsProvider) {
      try {
        TRACE(`[${name}] Notifying newly connected server about roots`);
        client.sendRootsListChanged();
      } catch (error) {
        console.error(`Failed to notify server ${name} about root changes:`, error);
      }
    } else {
      TRACE(`[${name}] No roots provider yet, skipping roots notification`);
    }
  }

  private async connectHttpServer(name: string, config: HttpServerConfig): Promise<void> {
    const serverUrl = new URL(config.url);

    // Create OAuth provider if OAuth is configured
    let authProvider: MCPManOAuthProvider | undefined;
    if (config.oauth) {
      authProvider = new MCPManOAuthProvider(name, config, (url) => {
        console.error(`\n🔐 OAuth authorization required for server '${name}'`);
        console.error(`Please open this URL in your browser:`);
        console.error(`${url.toString()}\n`);
      });
    }

    // Create transport with optional OAuth support
    const transport = new StreamableHTTPClientTransport(serverUrl, {
      authProvider,
      requestInit: {
        headers: config.headers,
      },
    });

    const client = new Client(
      {
        name: "mcpman",
        version: "1.0.0",
      },
      {
        capabilities: {
          roots: { listChanged: true },
        },
      }
    );

    // Set up roots handler - MCPMan will get roots FROM its client and provide TO upstream servers
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      TRACE(`[${name}] Roots requested by upstream server`);
      if (!this.rootsProvider) {
        TRACE(`[${name}] No roots provider available, returning empty roots`);
        return { roots: [] };
      }
      const roots = await this.rootsProvider();
      TRACE(`[${name}] Providing roots to upstream server:`, roots);
      return { roots };
    });

    try {
      await client.connect(transport);
      this.clients.set(name, client);
      TRACE(`[${name}] Connected to HTTP server`);

      // Notify the newly connected server about roots if we have a provider
      if (this.rootsProvider) {
        try {
          TRACE(`[${name}] Notifying newly connected HTTP server about roots`);
          client.sendRootsListChanged();
        } catch (error) {
          console.error(`Failed to notify server ${name} about root changes:`, error);
        }
      } else {
        TRACE(`[${name}] No roots provider yet, skipping roots notification`);
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.error(`\n❌ Authorization required for server '${name}'`);
        console.error(`Please complete the OAuth flow and restart mcpman.\n`);
        throw error;
      } else {
        throw error;
      }
    }
  }

  async getAllTools(): Promise<Map<string, Tool[]>> {
    const toolMap = new Map<string, Tool[]>();

    for (const [serverName, client] of this.clients) {
      try {
        const result: ListToolsResult = await client.listTools();
        toolMap.set(serverName, result.tools || []);
      } catch (error) {
        console.error(`Failed to list tools for server ${serverName}:`, error);
        toolMap.set(serverName, []);
      }
    }

    return toolMap;
  }

  async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`Server ${serverName} not connected`);
    }

    console.log(`Calling tool ${serverName}.${toolName} with args:`, JSON.stringify(args, null, 2));

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: (args as Record<string, unknown>) || {},
      });

      console.log(
        `Tool call ${serverName}.${toolName} result:`,
        JSON.stringify(result.content, null, 2)
      );
      return result.content;
    } catch (error) {
      console.error(`Tool call failed for ${serverName}.${toolName}:`, error);
      throw error;
    }
  }

  getClient(serverName: string): Client | undefined {
    return this.clients.get(serverName);
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }

  getConfiguredServers(): string[] {
    return Object.keys(this.settings.servers).filter(
      (name) => !this.settings.servers[name]?.disabled
    );
  }

  // Notify all connected servers that roots have changed
  notifyRootsChanged(): void {
    TRACE(`Notifying ${this.clients.size} connected servers about roots changes`);
    for (const [name, client] of this.clients) {
      try {
        TRACE(`[${name}] Sending roots changed notification`);
        client.sendRootsListChanged();
      } catch (error) {
        console.error(`Failed to notify server ${name} about root changes:`, error);
      }
    }
  }

  // Set the roots provider and notify all connected servers
  setRootsProvider(provider: RootsProvider): void {
    TRACE("Setting roots provider and notifying all connected servers");
    this.rootsProvider = provider;
    this.notifyRootsChanged();
  }

  async addServer(name: string, config: ServerConfig): Promise<void> {
    TRACE(`Adding new server '${name}' to configuration`);
    // Add to settings
    this.settings.servers[name] = config;
    // Connect the new server if not disabled
    if (!config.disabled) {
      await this.connectServer(name, config);
    }
  }

  async disconnect(): Promise<void> {
    // Close all clients
    for (const [name, client] of this.clients) {
      try {
        await client.close();
      } catch (error) {
        console.error(`Error closing client ${name}:`, error);
      }
    }

    this.clients.clear();
  }
}
