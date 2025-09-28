import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { UpstreamServerManager } from "../mcp/upstream-server-manager.js";

export interface ToolProxy {
  [toolName: string]: (args?: unknown) => Promise<unknown>;
}

interface ToolResultWithHelpers {
  json(): unknown;
  text(): string;
}

interface EnhancedPromise extends Promise<unknown> {
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface ServerProxies {
  [serverName: string]: ToolProxy;
}

export async function createServerProxies(
  upstreamServerManager: UpstreamServerManager
): Promise<ServerProxies> {
  const proxies: ServerProxies = {};
  const toolMap = await upstreamServerManager.getAllTools();

  for (const [serverName, tools] of toolMap) {
    proxies[serverName] = createToolProxy(serverName, tools, upstreamServerManager);
  }

  return proxies;
}

function createToolProxy(
  serverName: string,
  tools: Tool[],
  upstreamServerManager: UpstreamServerManager
): ToolProxy {
  const toolFunctions: ToolProxy = {};

  for (const tool of tools) {
    // Create function that returns a custom promise with helper methods
    toolFunctions[tool.name] = (args?: unknown) => {
      const basePromise = (async () => {
        const result = await upstreamServerManager.callTool(serverName, tool.name, args);

        // Add helper methods to the result array
        if (Array.isArray(result)) {
          const resultWithHelpers = result as unknown as ToolResultWithHelpers;
          resultWithHelpers.json = () => {
            if (result[0]?.text) {
              return JSON.parse(result[0].text);
            }
            throw new Error("No text content to parse as JSON");
          };

          resultWithHelpers.text = () => {
            if (result[0]?.text) {
              return result[0].text;
            }
            throw new Error("No text content available");
          };
        }

        return result;
      })();

      // Add helper methods to the promise itself for chaining
      const enhancedPromise = basePromise as EnhancedPromise;

      enhancedPromise.json = async () => {
        const result = await basePromise;
        return (result as ToolResultWithHelpers).json();
      };

      enhancedPromise.text = async () => {
        const result = await basePromise;
        return (result as ToolResultWithHelpers).text();
      };

      return enhancedPromise;
    };
  }

  // Create a proxy that intercepts property access and provides helpful error messages
  return new Proxy(toolFunctions, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !(prop in target)) {
        const availableTools = Object.keys(target);
        throw new Error(
          `Tool '${prop}' not found in server '${serverName}'. Available tools: ${availableTools.join(", ")}`
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function createGlobalContext(
  proxies: ServerProxies,
  upstreamServerManager: UpstreamServerManager
): Record<string, unknown> {
  // Create the global context that will be available in eval'd code
  const context: Record<string, unknown> = {};

  // Add each server as a global variable
  for (const [serverName, toolProxy] of Object.entries(proxies)) {
    context[serverName] = toolProxy;
  }

  // Add utility functions
  context.listServers = () => Object.keys(proxies);

  context.listTools = (serverName?: string) => {
    if (serverName) {
      const server = proxies[serverName];
      return server ? Object.keys(server) : [];
    }

    const allTools: Record<string, string[]> = {};
    for (const [name, proxy] of Object.entries(proxies)) {
      allTools[name] = Object.keys(proxy);
    }
    return allTools;
  };

  context.help = async (serverName: string, toolName?: string) => {
    // Get client for the server
    const client = upstreamServerManager.getClient(serverName);
    if (!client) {
      throw new Error(
        `Server '${serverName}' not found. Available servers: ${Object.keys(proxies).join(", ")}`
      );
    }

    try {
      // Get all tools for the server
      const result = await client.listTools();
      const tools = result.tools || [];

      if (toolName) {
        // Show help for specific tool
        const tool = tools.find((t) => t.name === toolName);
        if (!tool) {
          throw new Error(
            `Tool '${toolName}' not found in server '${serverName}'. Available tools: ${tools.map((t) => t.name).join(", ")}`
          );
        }

        return {
          server: serverName,
          tool: {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema || {},
          },
        };
      } else {
        // Show help for all tools in server
        return {
          server: serverName,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema || {},
          })),
        };
      }
    } catch (error) {
      throw new Error(
        `Error getting tools from server '${serverName}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  return context;
}
