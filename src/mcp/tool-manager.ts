import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { compile as compileJsonSchemaToTs } from "json-schema-to-typescript";
import type { EvalRuntime } from "../eval/runtime.js";
import type { UpstreamServerManager } from "./upstream-server-manager.js";
import { TRACE } from "../utils/logging.js";

// Convert to camelCase (lowercase first letter) - for tool property names
function toCamelCase(str: string): string {
  return str
    .replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toLowerCase());
}

// Convert to PascalCase (uppercase first letter) - for type names
function toPascalCase(str: string): string {
  return str
    .replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

export class ToolManager {
  private cachedTypes: string | null = null;
  private cachedToolDescriptions: string | null = null;
  private lastToolsSignature: string | null = null;

  constructor(
    private upstreamServerManager: UpstreamServerManager,
    private evalRuntime: EvalRuntime
  ) {}

  /**
   * Gets all available tools and generates a signature to detect changes
   */
  private async getToolsSignature(): Promise<string> {
    const toolMap = await this.upstreamServerManager.getAllTools();
    const signature: string[] = [];

    for (const [serverName, tools] of toolMap) {
      for (const tool of tools) {
        signature.push(`${serverName}.${tool.name}:${JSON.stringify(tool.inputSchema)}`);
      }
    }

    return signature.sort().join("|");
  }

  /**
   * Gets TypeScript type definitions for all available tools.
   * Uses caching - only regenerates when tools change.
   * @param servers Optional list of server names to filter. If provided, only these servers will be included.
   */
  async getTypeDefinitions(servers?: string[]): Promise<string> {
    const currentSignature = await this.getToolsSignature();

    // Only use cache if no server filter is specified
    if (!servers && this.cachedTypes && this.lastToolsSignature === currentSignature) {
      TRACE("Using cached TypeScript type definitions");
      return this.cachedTypes;
    }

    TRACE(
      servers
        ? `Generating TypeScript type definitions for servers: ${servers.join(", ")}`
        : "Generating fresh TypeScript type definitions"
    );
    if (!servers) {
      this.lastToolsSignature = currentSignature;
    }

    const allToolMap = await this.upstreamServerManager.getAllTools();

    // Filter by servers if specified
    const toolMap = servers
      ? new Map([...allToolMap].filter(([serverName]) => servers.includes(serverName)))
      : allToolMap;

    let interfaceDeclarations = "";
    let serverDeclarations = "";

    for (const [serverName, tools] of toolMap) {
      let availableTools = "";

      for (const tool of tools) {
        try {
          const inputType = await this.generateInputType(serverName, tool);
          const outputType = this.generateOutputType(serverName, tool.name);

          interfaceDeclarations += `\n${inputType}`;
          interfaceDeclarations += `\n${outputType}`;

          const toolComment = tool.description
            ? `\n\t/*\n\t * ${tool.description.trim()}\n\t */`
            : "";
          const toolPropertyName = toCamelCase(tool.name);
          availableTools += `${toolComment}\n\t${toolPropertyName}: (input: ${toPascalCase(`${serverName}_${tool.name}`)}Input) => Promise<${toPascalCase(`${serverName}_${tool.name}`)}Output>;`;
          availableTools += "\n";
        } catch (error) {
          console.error(`Failed to generate types for ${serverName}.${tool.name}:`, error);
        }
      }

      // Add server object with all its tools
      if (tools.length > 0) {
        const serverVarName = toCamelCase(serverName);
        serverDeclarations += `\ndeclare const ${serverVarName}: {${availableTools}};\n`;
      }
    }

    // Combine interfaces first, then server declarations
    let availableTypes = interfaceDeclarations + "\n" + serverDeclarations;

    // Add utility functions
    availableTypes += `\ndeclare function listServers(): string[];`;
    availableTypes += `\ndeclare function listTools(serverName?: string): string[] | Record<string, string[]>;`;
    availableTypes += `\ndeclare function help(serverName: string, toolName?: string): Promise<any>;`;
    availableTypes += `\ndeclare const $results: any[];`;

    // Only cache if no server filter was used
    if (!servers) {
      this.cachedTypes = availableTypes;
    }
    return availableTypes;
  }

  /**
   * Gets simple tool descriptions for LLM context
   */
  async getToolDescriptions(): Promise<string> {
    const currentSignature = await this.getToolsSignature();

    // Return cached descriptions if tools haven't changed
    if (this.cachedToolDescriptions && this.lastToolsSignature === currentSignature) {
      TRACE("Using cached tool descriptions");
      return this.cachedToolDescriptions;
    }

    TRACE("Generating fresh tool descriptions");

    const toolMap = await this.upstreamServerManager.getAllTools();
    const descriptions: string[] = [];

    for (const [serverName, tools] of toolMap) {
      for (const tool of tools) {
        const desc = tool.description ? tool.description.trim() : "No description";
        descriptions.push(`- ${serverName}.${tool.name}: ${desc}`);
      }
    }

    this.cachedToolDescriptions = descriptions.join("\n");
    return this.cachedToolDescriptions;
  }

  /**
   * Clears the type cache, forcing regeneration on next request
   */
  clearCache(): void {
    TRACE("Clearing tool type cache");
    this.cachedTypes = null;
    this.cachedToolDescriptions = null;
    this.lastToolsSignature = null;
  }

  private async generateInputType(serverName: string, tool: Tool): Promise<string> {
    const typeName = toPascalCase(`${serverName}_${tool.name}`) + "Input";

    if (!tool.inputSchema) {
      return `declare interface ${typeName} { [key: string]: any }`;
    }

    try {
      // Cast to any since MCP tool schemas are compatible but not exactly JSONSchema4
      const typeDefinition = await compileJsonSchemaToTs(tool.inputSchema as any, typeName, {
        format: false,
        bannerComment: "",
      });

      return typeDefinition.trim().replace("export interface", "declare interface");
    } catch (error) {
      console.error(`Failed to generate input type for ${serverName}.${tool.name}:`, error);
      return `declare interface ${typeName} { [key: string]: any }`;
    }
  }

  private generateOutputType(serverName: string, toolName: string): string {
    const typeName = toPascalCase(`${serverName}_${toolName}`) + "Output";
    // MCP tools return content arrays - we'll keep it generic
    return `declare interface ${typeName} { [key: string]: any }`;
  }

  /**
   * Execute a tool on an upstream server
   */
  async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    return await this.upstreamServerManager.callTool(serverName, toolName, args);
  }

  /**
   * Get a client for a specific server
   */
  getClient(serverName: string) {
    return this.upstreamServerManager.getClient(serverName);
  }

  /**
   * Get all connected servers
   */
  getConnectedServers(): string[] {
    return this.upstreamServerManager.getConnectedServers();
  }

  /**
   * Get all configured servers
   */
  getConfiguredServers(): string[] {
    return this.upstreamServerManager.getConfiguredServers();
  }

  /**
   * Execute JavaScript code in the eval runtime
   */
  async executeCode(code: string, arg: unknown = {}): Promise<{ result: unknown; output: string }> {
    return await this.evalRuntime.eval(code, arg);
  }

  /**
   * Append a result to the $results array
   */
  async appendResult(result: unknown): Promise<number> {
    return await this.evalRuntime.appendResult(result);
  }
}
