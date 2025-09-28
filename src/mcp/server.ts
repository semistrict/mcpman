import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { EvalRuntime } from "../eval/runtime.js";
import type { ClientManager } from "./client-manager.js";

interface ServerInfo {
  connected: boolean;
  toolCount: number;
  tools: unknown[];
}

export class MCPServer {
  private _mcpServer: McpServer;
  private evalRuntime?: EvalRuntime;
  private clientManager?: ClientManager;

  constructor() {
    this._mcpServer = new McpServer({
      name: "mcpman",
      version: "1.0.0",
    });
  }

  get server() {
    return this._mcpServer;
  }

  setDependencies(evalRuntime: EvalRuntime, clientManager: ClientManager) {
    this.evalRuntime = evalRuntime;
    this.clientManager = clientManager;
    this.setupTools();
  }

  private setupTools(): void {
    if (!this.evalRuntime || !this.clientManager) {
      throw new Error("Dependencies not set");
    }

    const evalRuntime = this.evalRuntime;
    const clientManager = this.clientManager;

    // Register eval tool
    this._mcpServer.registerTool(
      "eval",
      {
        title: "JavaScript Evaluator",
        description: "Execute JavaScript code with access to all configured MCP tools",
        inputSchema: {
          code: z
            .string()
            .describe("JavaScript code to execute. Use serverName.toolName(args) to call tools."),
        },
      },
      async ({ code }) => {
        const result = await evalRuntime.eval(code);

        // Serialize result as JSON if it's an object, otherwise as string
        const serializedResult =
          typeof result.result === "object" && result.result !== null
            ? JSON.stringify(result.result)
            : String(result.result);

        return {
          content: [
            {
              type: "text" as const,
              text: `Result: ${serializedResult}${result.output ? `\nOutput:\n${result.output}` : ""}`,
            },
          ],
        };
      }
    );

    // Register list_servers tool
    this._mcpServer.registerTool(
      "list_servers",
      {
        title: "List MCP Servers",
        description: "List all connected MCP servers and their tools",
        inputSchema: {},
      },
      async () => {
        return await this.handleListServers(clientManager);
      }
    );
  }

  private async handleListServers(clientManager: ClientManager) {
    const connectedServers = clientManager.getConnectedServers();
    const toolMap = await clientManager.getAllTools();

    const servers: Record<string, ServerInfo> = {};

    for (const serverName of connectedServers) {
      const tools = toolMap.get(serverName) || [];
      servers[serverName] = {
        connected: true,
        toolCount: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ servers }, null, 2),
        },
      ],
    };
  }

  async listen(): Promise<void> {
    const transport = new StdioServerTransport();
    await this._mcpServer.connect(transport);
  }

  async close(): Promise<void> {
    await this._mcpServer.close();
  }
}
