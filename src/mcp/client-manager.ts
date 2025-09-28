import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ListToolsResult, Root, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCPManOAuthProvider } from "../auth/oauth-provider.js";
import type {
  HttpServerConfig,
  ServerConfig,
  Settings,
  StdioServerConfig,
} from "../config/schema.js";

type RootsProvider = () => Promise<Root[]>;

export class ClientManager {
  private clients = new Map<string, Client>();

  constructor(
    private settings: Settings,
    private rootsProvider?: RootsProvider
  ) {}

  async connectAll(): Promise<void> {
    const promises = Object.entries(this.settings.servers)
      .filter(([_, config]) => !config.disabled)
      .map(([name, config]) => this.connectServer(name, config));

    await Promise.allSettled(promises);
  }

  private async connectServer(name: string, config: ServerConfig): Promise<void> {
    try {
      if (config.transport === "stdio") {
        await this.connectStdioServer(name, config);
      } else if (config.transport === "http") {
        await this.connectHttpServer(name, config);
      }
    } catch (error) {
      console.error(`Failed to connect to server ${name}:`, error);
    }
  }

  private async connectStdioServer(name: string, config: StdioServerConfig): Promise<void> {
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
      if (!this.rootsProvider) {
        return { roots: [] };
      }
      const roots = await this.rootsProvider();
      return { roots };
    });

    await client.connect(transport);
    this.clients.set(name, client);
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
      if (!this.rootsProvider) {
        return { roots: [] };
      }
      const roots = await this.rootsProvider();
      return { roots };
    });

    try {
      await client.connect(transport);
      this.clients.set(name, client);
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

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: (args as Record<string, unknown>) || {},
      });

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

  // Notify all connected servers that roots have changed
  notifyRootsChanged(): void {
    for (const [name, client] of this.clients) {
      try {
        client.sendRootsListChanged();
      } catch (error) {
        console.error(`Failed to notify server ${name} about root changes:`, error);
      }
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
