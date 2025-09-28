# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCPMan is a Model Context Protocol (MCP) server manager that acts as a proxy/multiplexer for multiple MCP servers. It provides:

- **Client Management**: Connects to multiple MCP servers via stdio or HTTP transports with OAuth 2.1 support
- **Eval Runtime**: JavaScript execution environment with access to all connected MCP tools
- **MCP Server**: Exposes `eval` and `list_servers` tools to clients
- **CLI Commands**: Management commands for configuration, testing, and serving

## Architecture

### Core Components

- **ClientManager** (`src/mcp/client-manager.ts`): Manages connections to upstream MCP servers
- **MCPServer** (`src/mcp/server.ts`): Exposes MCPMan as an MCP server with eval capabilities
- **EvalRuntime** (`src/eval/runtime.ts`): Sandboxed JavaScript execution with MCP tool access
- **Configuration** (`src/config/`): Zod-based schema validation for server configs
- **OAuth Provider** (`src/auth/`): OAuth 2.1 implementation for HTTP MCP servers

### Key Files

- `index.ts`: Main entry point - CLI mode or server mode based on arguments
- `src/config/schema.ts`: Configuration schema for stdio/HTTP servers with OAuth
- `src/eval/proxy.ts`: Creates server proxies for eval environment
- `src/cli/commands/`: CLI command implementations

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
bun cli eval "code" [--roots /path/to/dir]

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

## Tool Usage

When developing, remember that MCPMan's primary function is exposing an `eval` tool that provides access to all connected MCP servers through JavaScript execution.