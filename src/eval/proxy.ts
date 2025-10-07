import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { UpstreamServerManager } from "../mcp/upstream-server-manager.js";

/**
 * Converts camelCase to the most likely original format with hyphens/underscores
 * Example: listTargets -> list-targets or list_targets
 */
function camelCaseToPossibleOriginals(camelCaseStr: string): string[] {
  // Convert camelCase to snake_case and kebab-case
  const withSeparators = camelCaseStr.replace(/([A-Z])/g, "-$1").toLowerCase();
  const dashVersion = withSeparators.startsWith("-") ? withSeparators.slice(1) : withSeparators;
  const underscoreVersion = dashVersion.replace(/-/g, "_");
  const spaceVersion = dashVersion.replace(/-/g, " ");

  return [camelCaseStr, dashVersion, underscoreVersion, spaceVersion];
}

/**
 * Converts dash-case or snake_case to camelCase
 * Example: agent-debugger -> agentDebugger, list_targets -> listTargets
 */
function toCamelCase(str: string): string {
  return str
    .replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toLowerCase());
}

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

  // Create a proxy that intercepts property access and supports name conversion
  return new Proxy(toolFunctions, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        // First try the exact property name
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }

        // Try camelCase variants (e.g., listTargets -> list-targets)
        const possibleOriginals = camelCaseToPossibleOriginals(prop);
        for (const possibleName of possibleOriginals) {
          if (possibleName in target) {
            return target[possibleName];
          }
        }

        // Try converting underscores to dashes and spaces to find a match
        const dashVersion = prop.replace(/_/g, "-");
        const spaceVersion = prop.replace(/_/g, " ");

        // Look for a tool that matches when converted to underscore format
        for (const toolName of Object.keys(target)) {
          const underscoreVersion = toolName.replace(/[-\s]/g, "_");
          if (underscoreVersion === prop) {
            return target[toolName];
          }
        }

        // Also try direct dash and space versions
        if (dashVersion in target) {
          return target[dashVersion];
        }
        if (spaceVersion in target) {
          return target[spaceVersion];
        }

        // Tool not found, provide helpful error message
        const availableTools = Object.keys(target);
        const underscoreVersions = availableTools.map((name) => name.replace(/[-\s]/g, "_"));
        throw new Error(
          `Tool '${prop}' not found in server '${serverName}'. Available tools: ${availableTools.join(", ")} (can also use underscore versions: ${underscoreVersions.join(", ")})`
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

  // Add each server as a global variable (with both original and camelCase names)
  for (const [serverName, toolProxy] of Object.entries(proxies)) {
    context[serverName] = toolProxy;

    // Also add camelCase version (e.g., agent-debugger -> agentDebugger)
    const camelCaseName = toCamelCase(serverName);
    if (camelCaseName !== serverName) {
      context[camelCaseName] = toolProxy;
    }
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
