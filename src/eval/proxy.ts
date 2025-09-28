import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ClientManager } from "../mcp/client-manager.js";

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

export async function createServerProxies(clientManager: ClientManager): Promise<ServerProxies> {
  const proxies: ServerProxies = {};
  const toolMap = await clientManager.getAllTools();

  for (const [serverName, tools] of toolMap) {
    proxies[serverName] = createToolProxy(serverName, tools, clientManager);
  }

  return proxies;
}

function createToolProxy(
  serverName: string,
  tools: Tool[],
  clientManager: ClientManager
): ToolProxy {
  const proxy: ToolProxy = {};

  for (const tool of tools) {
    // Create function that returns a custom promise with helper methods
    proxy[tool.name] = (args?: unknown) => {
      const basePromise = (async () => {
        const result = await clientManager.callTool(serverName, tool.name, args);

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

  return proxy;
}

export function createGlobalContext(proxies: ServerProxies): Record<string, unknown> {
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

  return context;
}
