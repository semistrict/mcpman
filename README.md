# MCPMan

A Model Context Protocol (MCP) server manager that acts as a proxy/multiplexer for multiple MCP servers.

## Overview

MCPMan allows you to:
- Connect to multiple MCP servers simultaneously (stdio and HTTP transports)
- Execute JavaScript code with access to all connected MCP tools
- Manage server configurations with OAuth 2.1 support
- Provide unified access to tools from different MCP servers

## Quick Start

### Installation

```bash
bun install
```

### Initialize Configuration

```bash
bun cli init
```

### Add MCP Servers

```bash
# Add stdio server
bun cli add filesystem --command npx --args @modelcontextprotocol/server-filesystem

# Add HTTP server with OAuth
bun cli add api-server --url https://api.example.com/mcp
```

### Evaluate JavaScript with MCP Tools

```bash
# Use default root directory (current directory)
bun cli eval "filesystem.listFiles({ path: '.' })"

# Specify custom root directories
bun cli eval "filesystem.listFiles({ path: '/tmp' })" --roots /tmp --roots /var

# Access multiple servers
bun cli eval "const files = filesystem.listFiles({ path: '.' }); console.log(files);"
```

### Run as MCP Server

```bash
bun cli serve
```

## Architecture

MCPMan operates in two modes:

### Server Mode
- Acts as an MCP server exposing `eval` and `list_servers` tools
- Connects to multiple upstream MCP servers
- Transparently forwards root directory information from clients to upstream servers
- Provides unified JavaScript execution environment

### CLI Mode
- Direct command-line interface for server management
- Execute JavaScript code with MCP tool access
- Configure and test server connections

## Configuration

Configuration is stored in `~/.mcpman/settings.json`:

```json
{
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem"],
      "env": {},
      "disabled": false,
      "timeout": 30000
    },
    "api-server": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "headers": {},
      "oauth": {
        "clientName": "mcpman",
        "redirectUrl": "http://localhost:3000/callback",
        "scopes": ["mcp:tools"],
        "clientId": "optional-client-id",
        "clientSecret": "optional-client-secret"
      },
      "disabled": false,
      "timeout": 30000
    }
  }
}
```

## CLI Commands

```bash
# Server management
bun cli init                          # Initialize configuration
bun cli add <name>                    # Add new server
bun cli list                          # List configured servers
bun cli validate                      # Validate configuration
bun cli test                          # Test server connections

# Execution
bun cli eval "code" [--roots /path]   # Execute JavaScript with MCP tools
bun cli serve                         # Run as MCP server

# Authentication
bun cli auth <server-name>            # Authenticate with OAuth server
```

## JavaScript Execution Environment

In the eval environment, each configured server is available as a global object:

```javascript
// List files using filesystem server
const files = await filesystem.listFiles({ path: "." });

// Use multiple servers
const servers = listServers();
console.log("Available servers:", servers);

// Access tools dynamically
const result = await someServer.someTool({ param: "value" });
```

## Development

### Setup

```bash
bun install
pre-commit install  # Install git hooks
```

### Available Scripts

```bash
bun dev              # Development server with hot reload
bun run build        # Build compiled binary
bun run lint         # Lint code
bun run format       # Format code
bun run typecheck    # Type check
bun test             # Run tests
```

### Code Style

- TypeScript with strict type checking
- Biome for linting and formatting (100 char line width, 2-space indents)
- Zod schemas for configuration validation
- Pre-commit hooks ensure code quality

## MCP Protocol Support

MCPMan fully supports the MCP protocol including:
- Tool discovery and execution
- Root directory management (transparent proxy)
- Request/response handling
- Error propagation
- OAuth 2.1 authentication for HTTP transports

## License

MIT