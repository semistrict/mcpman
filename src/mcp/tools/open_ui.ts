import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TRACE } from "../../utils/logging.js";

export function registerOpenUITool(
  mcpServer: McpServer,
  serverPort: number | undefined,
  _initializedMcpServer: Promise<McpServer>
) {
  TRACE("Registering open_ui tool");
  mcpServer.registerTool(
    "open_ui",
    {
      title: "Open UI",
      description: "Open the MCPMan web UI in the system browser",
      inputSchema: {},
    },
    async () => {
      return await handleOpenUI(serverPort);
    }
  );
  TRACE("Open_ui tool registered");
}

async function handleOpenUI(serverPort?: number) {
  const port = serverPort || process.env.MCPMAN_UI_PORT || 8726;
  const url = `http://localhost:${port}`;

  try {
    // Use system's default browser to open the URL
    const { spawn } = await import("node:child_process");
    const platform = process.platform;

    let command: string;
    let args: string[];

    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "start";
      args = ["", url];
    } else {
      // Linux and other Unix-like systems
      command = "xdg-open";
      args = [url];
    }

    spawn(command, args, { detached: true, stdio: "ignore" });

    return {
      content: [
        {
          type: "text" as const,
          text: `Opened MCPMan UI in browser: ${url}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to open browser: ${error instanceof Error ? error.message : String(error)}. Please manually open: ${url}`,
        },
      ],
    };
  }
}
