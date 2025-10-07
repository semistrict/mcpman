import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { EvalRuntime } from "../eval/runtime.js";
import type { UpstreamServerManager } from "./upstream-server-manager.js";
import { TRACE } from "../utils/logging.js";
import { registerEvalTool } from "./tools/eval.js";
import { registerListServersTool } from "./tools/list_servers.js";
import { registerHelpTool } from "./tools/help.js";
import { registerInvokeTool } from "./tools/invoke.js";
import { registerInstallTool } from "./tools/install.js";
import { registerOpenUITool } from "./tools/open_ui.js";

const mcpServer: McpServer = new McpServer({
  name: "mcpman",
  version: "1.0.0",
});

let resolveInitialized: (mcpServer: McpServer) => void = () => {
  // Placeholder - will be overridden
};
let rejectInitialized: (reason?: unknown) => void = () => {
  // Placeholder - will be overridden
};
const initializedMcpServer: Promise<McpServer> = new Promise<McpServer>((resolve, reject) => {
  resolveInitialized = () => resolve(mcpServer);
  rejectInitialized = (reason) => reject(reason);
});

export function createMcpServer(
  evalRuntime: EvalRuntime,
  upstreamServerManager: UpstreamServerManager,
  serverPort?: number
): Promise<McpServer> {
  TRACE("Creating MCP server with oninitialized callback");

  // Set the oninitialized callback on the underlying server
  mcpServer.server.oninitialized = async () => {
    // Client has connected and completed initialization
    // Now we can connect to upstream servers
    TRACE("CLIENT INITIALIZED! Now connecting to upstream servers...");
    try {
      await upstreamServerManager.connectAll();
      resolveInitialized(mcpServer);
      TRACE("SUCCESS: Connected to all upstream servers");
    } catch (error) {
      if (rejectInitialized) {
        rejectInitialized(error);
      }
      TRACE("ERROR connecting to upstream servers:", error);
    }
  };

  // Register tools immediately with static descriptions
  registerTools(mcpServer, evalRuntime, upstreamServerManager, serverPort);

  connectMcpServer();

  TRACE("Server created and tools registered, ready for connections");
  return initializedMcpServer;
}

function registerTools(
  mcpServer: McpServer,
  evalRuntime: EvalRuntime,
  upstreamServerManager: UpstreamServerManager,
  serverPort?: number
) {
  TRACE("Registering MCP server tools...");
  registerEvalTool(mcpServer, evalRuntime, initializedMcpServer);
  registerListServersTool(mcpServer, upstreamServerManager, initializedMcpServer);
  registerHelpTool(mcpServer, upstreamServerManager, initializedMcpServer);
  registerInvokeTool(mcpServer, upstreamServerManager, evalRuntime, initializedMcpServer);
  registerInstallTool(mcpServer, upstreamServerManager, initializedMcpServer);
  registerOpenUITool(mcpServer, serverPort, initializedMcpServer);
  TRACE("All tools registered successfully");
}

export function getMcpServer(): Promise<McpServer> {
  return initializedMcpServer;
}

async function connectMcpServer(): Promise<void> {
  TRACE("Connecting MCP server to stdio transport");
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  TRACE("MCP server connected to stdio transport");
}

export async function disconnectMcpServer(): Promise<void> {
  await mcpServer.close();
}
