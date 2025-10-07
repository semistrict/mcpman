# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCPMan is a Model Context Protocol (MCP) server manager that acts as a proxy/multiplexer for multiple MCP servers. It provides:

- **Upstream Server Management**: Connects to multiple MCP servers via stdio or HTTP transports with OAuth 2.1 support
- **Code Generation**: LLM-powered code generation from natural language with TypeScript validation
- **Type System**: Automatic TypeScript type generation for all connected MCP tools
- **Eval Runtime**: JavaScript execution environment with access to all connected MCP tools and $results array
- **MCP Server**: Exposes tools for code generation, evaluation, tool invocation, server management, and help
- **CLI Commands**: Management commands for configuration, testing, code generation, and serving

## Architecture

### Core Components

- **UpstreamServerManager** (`src/mcp/upstream-server-manager.ts`): Manages connections to upstream MCP servers
- **MCPServer** (`src/mcp/server.ts`): Exposes MCPMan as an MCP server with tools in `src/mcp/tools/`
- **ToolManager** (`src/mcp/tool-manager.ts`): Generates TypeScript definitions for all MCP tools, caches them, and provides tool execution interface
- **EvalRuntime** (`src/eval/runtime.ts`): Sandboxed JavaScript execution with MCP tool access and $results array
- **Configuration** (`src/config/`): Zod-based schema validation for server configs
- **OAuth Provider** (`src/auth/`): OAuth 2.1 implementation for HTTP MCP servers
- **Logging** (`src/utils/logging.ts`): Synchronous file logging with error stack trace support

### Key Files

- `index.ts`: Main entry point - CLI mode or server mode based on arguments
- `src/config/schema.ts`: Configuration schema for stdio/HTTP servers with OAuth
- `src/mcp/tool-manager.ts`: TypeScript type generation from MCP tool schemas with caching
- `src/eval/proxy.ts`: Creates server proxies for eval environment with camelCase name mapping
- `src/eval/runtime.ts`: VM context with $results array for storing tool outputs
- `src/cli/commands/`: CLI command implementations (code, eval, serve, etc.)
- `src/mcp/tools/`: Individual MCP tool implementations (code, eval, invoke, list_servers, help, install)
- `src/mcp/tools/code.ts`: LLM-powered code generation with TypeScript validation (uses Claude Agent SDK)
- `src/utils/find-claude.ts`: Locates Claude Code CLI executable for Agent SDK

## Development Commands

```bash
# Install dependencies
bun install

# Development server with hot reload
bun dev

# Build compiled binary
bun run build

# CLI commands
bun cli add <server-name>
bun cli init
bun cli list
bun cli validate
bun cli test
bun cli serve
bun cli auth
bun cli code "natural language description" [--roots /path/to/dir]
bun cli eval "function-expression" [--arg '{"key": "value"}'] [--roots /path/to/dir]

# Linting and formatting
bun run lint
bun run format
bun run check
bun run typecheck

# Run tests
bun test

# Pre-commit hooks (install once)
pre-commit install
```

## Configuration

MCPMan uses a JSON config file defining servers with transport types:

```json
{
  "servers": {
    "my-server": {
      "transport": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-everything"]
    },
    "http-server": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "clientName": "mcpman",
        "scopes": ["mcp:tools"]
      }
    }
  }
}
```

## Code Style

- Uses Biome for linting/formatting with 100 char line width, 2-space indents
- TypeScript with Zod schemas for validation
- Bun APIs preferred over Node.js equivalents
- Error handling with proper context and user-friendly messages
- Pre-commit hooks run lint, typecheck, and format on commit; tests on push

## Roots Protocol

MCPMan acts as a transparent proxy for MCP roots:
- In server mode: Gets roots from connected client and forwards to upstream servers
- In CLI eval mode: Uses `--roots` option or defaults to current directory
- Upstream servers receive proper root directories for filesystem access

## TypeScript Type Generation

MCPMan automatically generates TypeScript type definitions for all connected MCP tools:

- **Type Generation**: Converts MCP tool JSON schemas to TypeScript interfaces using `json-schema-to-typescript`
- **Naming Convention**:
  - Server names: `agent-debugger` → `agentDebugger` (camelCase variable)
  - Tool names: `list-targets` → `listTargets` (camelCase method)
  - Type names: `agent-debugger_list-targets` → `AgentDebuggerListTargetsInput/Output` (PascalCase)
- **Caching**: Generated types are cached and only regenerated when tool schemas change
- **Server Filtering**: Optional `servers` parameter generates types for only specified servers to reduce context
- **Runtime Mapping**: Proxy layer maps camelCase names back to original kebab-case/snake_case tool names

Example generated types:
```typescript
declare interface PlaywrightBrowserNavigateInput {
  url: string;
}
declare interface PlaywrightBrowserNavigateOutput { [key: string]: any }

declare const playwright: {
  browserNavigate: (input: PlaywrightBrowserNavigateInput) => Promise<PlaywrightBrowserNavigateOutput>;
};
```

## MCP Tools Exposed

MCPMan exposes the following tools when running as an MCP server:

1. **code** - Generate and execute JavaScript code from natural language descriptions using LLMs. Code is generated by Claude Agent SDK (or MCP sampling) and validated with TypeScript compiler API before execution. Results stored in $results array.
2. **eval** - Execute JavaScript function expressions with access to all connected MCP tools. Results stored in $results array.
3. **invoke** - Invoke tools from upstream servers with schema validation. Supports parallel and sequential batch invocations. Results stored in $results array.
4. **list_servers** - List all connected MCP servers and their available tools
5. **help** - Get help information about specific MCP tools from connected servers
6. **install** - Add new MCP servers to configuration dynamically

### Tool Examples

```javascript
// code tool - generate and execute code from natural language
{
  functionDescription: "navigate to google.com and take a screenshot",
  servers: ["playwright"]  // STRONGLY RECOMMENDED to limit context
}

// eval tool - execute function with MCP access
{ code: "() => listServers()", arg: null }
{ code: "(arg) => filesystem.listFiles({path: arg.directory})", arg: {"directory": "."} }

// invoke tool - call upstream tools with validation
{ calls: [{ server: "filesystem", tool: "read_file", parameters: {path: "README.md"} }], parallel: false }

// $results array - access previous results
{ code: "() => $results[0]", arg: null }
```

## Testing

- Always run tests with `bun run test`, not `bun test`
- Do not use `bun test`, use `bun run test`
- do not use dynamic imports