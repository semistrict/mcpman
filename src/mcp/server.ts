import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { EvalRuntime } from "../eval/runtime.js";
import { TRACE } from "../utils/logging.js";
import { registerCodeTool } from "./tools/code.js";
import { registerEvalTool } from "./tools/eval.js";
import { registerHelpTool } from "./tools/help.js";
import { registerInstallTool } from "./tools/install.js";
import { registerInvokeTool } from "./tools/invoke.js";
import { registerListServersTool } from "./tools/list_servers.js";
import { ToolManager } from "./tool-manager.js";
import type { UpstreamServerManager } from "./upstream-server-manager.js";

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
  upstreamServerManager: UpstreamServerManager
): Promise<McpServer> {
  TRACE("Creating MCP server with oninitialized callback");

  // Create ToolManager for type generation, caching, and tool execution
  const toolManager = new ToolManager(upstreamServerManager, evalRuntime);

  // Set the oninitialized callback on the underlying server
  mcpServer.server.oninitialized = async () => {
    // Client has connected and completed initialization
    TRACE("CLIENT INITIALIZED!");

    // Log client capabilities
    const clientCapabilities = mcpServer.server.getClientCapabilities();
    const clientVersion = mcpServer.server.getClientVersion();

    console.log("Client connected:");
    console.log("  Version:", JSON.stringify(clientVersion, null, 2));
    console.log("  Capabilities:", JSON.stringify(clientCapabilities, null, 2));

    // Now we can connect to upstream servers
    TRACE("Connecting to upstream servers...");
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
  registerTools(mcpServer, evalRuntime, upstreamServerManager, toolManager);

  connectMcpServer();

  TRACE("Server created and tools registered, ready for connections");
  return initializedMcpServer;
}

function registerTools(
  mcpServer: McpServer,
  evalRuntime: EvalRuntime,
  upstreamServerManager: UpstreamServerManager,
  toolManager: ToolManager
) {
  TRACE("Registering MCP server tools...");
  registerCodeTool(mcpServer, toolManager, initializedMcpServer);
  registerEvalTool(mcpServer, evalRuntime, toolManager, initializedMcpServer);
  registerListServersTool(mcpServer, upstreamServerManager, initializedMcpServer);
  registerHelpTool(mcpServer, upstreamServerManager, toolManager, initializedMcpServer);
  registerInvokeTool(mcpServer, toolManager, initializedMcpServer);
  registerInstallTool(mcpServer, upstreamServerManager, initializedMcpServer);
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
