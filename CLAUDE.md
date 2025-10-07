# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCPMan is a Model Context Protocol (MCP) server manager that acts as a proxy/multiplexer for multiple MCP servers. It provides:

- **Upstream Server Management**: Connects to multiple MCP servers via stdio or HTTP transports with OAuth 2.1 support
- **Eval Runtime**: JavaScript execution environment with access to all connected MCP tools and $results array
- **MCP Server**: Exposes tools for evaluation, tool invocation, server management, and help
- **CLI Commands**: Management commands for configuration, testing, and serving

## Architecture

### Core Components

- **UpstreamServerManager** (`src/mcp/upstream-server-manager.ts`): Manages connections to upstream MCP servers
- **MCPServer** (`src/mcp/server.ts`): Exposes MCPMan as an MCP server with tools in `src/mcp/tools/`
- **EvalRuntime** (`src/eval/runtime.ts`): Sandboxed JavaScript execution with MCP tool access and $results array
- **Configuration** (`src/config/`): Zod-based schema validation for server configs
- **OAuth Provider** (`src/auth/`): OAuth 2.1 implementation for HTTP MCP servers
- **Logging** (`src/utils/logging.ts`): Synchronous file logging with error stack trace support

### Key Files

- `index.ts`: Main entry point - CLI mode or server mode based on arguments
- `src/config/schema.ts`: Configuration schema for stdio/HTTP servers with OAuth
- `src/eval/proxy.ts`: Creates server proxies for eval environment
- `src/eval/runtime.ts`: VM context with $results array for storing tool outputs
- `src/cli/commands/`: CLI command implementations
- `src/mcp/tools/`: Individual MCP tool implementations (eval, invoke, list_servers, help, install)

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

## MCP Tools Exposed

MCPMan exposes the following tools when running as an MCP server:

1. **eval** - Execute JavaScript function expressions with access to all connected MCP tools. Results stored in $results array.
2. **invoke** - Invoke tools from upstream servers with schema validation. Supports parallel and sequential batch invocations. Results stored in $results array.
3. **list_servers** - List all connected MCP servers and their available tools
4. **help** - Get help information about specific MCP tools from connected servers
5. **install** - Add new MCP servers to configuration dynamically

### Tool Examples

```javascript
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