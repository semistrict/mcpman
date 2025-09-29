async function main() {
  // If CLI args are provided, use CLI mode
  if (process.argv.length > 2) {
    const { run, subcommands } = await import("cmd-ts");

    // Import all commands
    const { addCommand } = await import("./src/cli/commands/add.js");
    const { removeCommand } = await import("./src/cli/commands/remove.js");
    const { initCommand } = await import("./src/cli/commands/init.js");
    const { listCommand } = await import("./src/cli/commands/list.js");
    const { validateCommand } = await import("./src/cli/commands/validate.js");
    const { testCommand } = await import("./src/cli/commands/test.js");
    const { serveCommand } = await import("./src/cli/commands/serve.js");
    const { authCommand } = await import("./src/cli/commands/auth.js");
    const { evalCommand } = await import("./src/cli/commands/eval.js");

    // Create main CLI app
    const app = subcommands({
      name: "mcpman",
      description: "Model Context Protocol (MCP) server manager",
      version: "1.0.0",
      cmds: {
        add: addCommand,
        remove: removeCommand,
        init: initCommand,
        list: listCommand,
        validate: validateCommand,
        test: testCommand,
        serve: serveCommand,
        auth: authCommand,
        eval: evalCommand,
      },
    });

    await run(app, process.argv.slice(2));
    return;
  }

  // Otherwise run server mode - redirect console to log file for stdio protocol
  const { redirectConsole } = await import("./src/utils/logging.js");
  redirectConsole();

  console.log("Starting MCPMan server mode...");

  const { loadConfig } = await import("./src/config/loader.js");
  const { UpstreamServerManager } = await import("./src/mcp/upstream-server-manager.js");
  const { EvalRuntime } = await import("./src/eval/runtime.js");
  const { createMcpServer, disconnectMcpServer, getMcpServer } = await import(
    "./src/mcp/server.js"
  );

  try {
    // Load configuration
    console.log("Loading configuration...");
    const config = await loadConfig();
    console.log(`Loaded config with ${Object.keys(config.servers).length} servers`);

    // Initialize client manager without roots provider initially
    console.log("Creating client manager...");
    const upstreamServerManager = new UpstreamServerManager(config);

    // Initialize eval runtime
    console.log("Creating eval runtime...");
    const evalRuntime = new EvalRuntime(upstreamServerManager);

    // Create MCP server with dependencies
    console.log("Creating MCP server...");
    await createMcpServer(evalRuntime, upstreamServerManager);
    console.log("Starting MCP server...");

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.error("Shutting down...");
      await disconnectMcpServer();
      await upstreamServerManager.disconnect();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.error("Shutting down...");
      await disconnectMcpServer();
      await upstreamServerManager.disconnect();
      process.exit(0);
    });

    // Set up roots provider now that MCP server is ready
    upstreamServerManager.setRootsProvider(async () => {
      const mcpServer = await getMcpServer();
      const result = await mcpServer.server.listRoots();
      return result.roots;
    });

    // Upstream servers will be connected when client initializes (see oninitialized callback)
  } catch (error) {
    console.error("Failed to start MCPMan:", error);
    process.exit(1);
  }
}

main();
