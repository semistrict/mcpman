import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TRACE } from "../../utils/logging.js";
import type { UpstreamServerManager } from "../upstream-server-manager.js";
import type { ToolManager } from "../tool-manager.js";

// Convert kebab-case/snake_case to PascalCase for type names
function toPascalCase(str: string): string {
  return str
    .replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

// Convert kebab-case/snake_case to camelCase for tool names
function toCamelCase(str: string): string {
  return str
    .replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toLowerCase());
}

export function registerHelpTool(
  mcpServer: McpServer,
  upstreamServerManager: UpstreamServerManager,
  toolManager: ToolManager,
  initializedMcpServer: Promise<McpServer>
) {
  TRACE("Registering help tool");
  mcpServer.registerTool(
    "help",
    {
      title: "Help",
      description: "Get help information about MCP tools with TypeScript type definitions",
      inputSchema: {
        server: z.string().describe("Name of the MCP server to get help for"),
        tool: z.string().optional().describe("Optional specific tool name to get help for"),
      },
    },
    async ({ server, tool }) => {
      await initializedMcpServer; // Wait for upstream servers to be connected
      return await handleHelp(upstreamServerManager, toolManager, server, tool);
    }
  );
  TRACE("Help tool registered");
}

async function handleHelp(
  upstreamServerManager: UpstreamServerManager,
  toolManager: ToolManager,
  serverName: string,
  toolName?: string
) {
  const client = upstreamServerManager.getClient(serverName);
  if (!client) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Server '${serverName}' not found. Available servers: ${upstreamServerManager.getConnectedServers().join(", ")}`,
        },
      ],
    };
  }

  try {
    const result = await client.listTools();
    const tools = result.tools || [];

    // Get TypeScript declarations for this server
    const typeDefinitions = await toolManager.getTypeDefinitions([serverName]);

    if (toolName) {
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Tool '${toolName}' not found in server '${serverName}'. Available tools: ${tools.map((t) => t.name).join(", ")}`,
            },
          ],
        };
      }

      // Extract TypeScript declarations for this specific tool
      const inputTypeName = toPascalCase(`${serverName}_${toolName}`) + "Input";
      const outputTypeName = toPascalCase(`${serverName}_${toolName}`) + "Output";
      const toolMethodName = toCamelCase(toolName);
      const serverVarName = toCamelCase(serverName);

      const lines = typeDefinitions.split("\n");
      const relevantLines: string[] = [];

      // Extract input interface
      let inInterface = false;
      for (const line of lines) {
        if (line.includes(`declare interface ${inputTypeName}`)) {
          inInterface = true;
        }
        if (inInterface) {
          relevantLines.push(line);
          if (line === "}") {
            inInterface = false;
          }
        }
      }

      // Extract output interface
      for (const line of lines) {
        if (line.includes(`declare interface ${outputTypeName}`)) {
          relevantLines.push(line);
        }
      }

      // Extract server method signature
      const serverDeclStart = lines.findIndex((l) => l.includes(`declare const ${serverVarName}:`));
      if (serverDeclStart !== -1) {
        for (let i = serverDeclStart; i < lines.length; i++) {
          const line = lines[i];
          if (line && line.includes(`${toolMethodName}:`)) {
            // Include comment if present
            if (i > 0 && lines[i - 1]?.trim().startsWith("/*")) {
              let commentStart = i - 1;
              while (commentStart > 0 && !lines[commentStart]?.trim().startsWith("/*")) {
                commentStart--;
              }
              for (let j = commentStart; j <= i; j++) {
                const l = lines[j];
                if (l !== undefined) {
                  relevantLines.push(l);
                }
              }
            } else {
              relevantLines.push(line);
            }
            break;
          }
        }
      }

      const helpText = `## ${serverName}.${toolName}

${tool.description || "No description"}

### TypeScript Types

\`\`\`typescript
${relevantLines.join("\n")}
\`\`\``;

      return {
        content: [
          {
            type: "text" as const,
            text: helpText,
          },
        ],
      };
    } else {
      // Show all tools for the server with TypeScript declarations
      const helpText = `## Server: ${serverName}

### TypeScript Declarations

\`\`\`typescript
${typeDefinitions}
\`\`\``;

      return {
        content: [
          {
            type: "text" as const,
            text: helpText,
          },
        ],
      };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error getting tools from server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
