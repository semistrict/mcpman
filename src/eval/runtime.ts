import vm from "node:vm";
import type { UpstreamServerManager } from "../mcp/upstream-server-manager.js";
import { createGlobalContext, createServerProxies } from "./proxy.js";

export class EvalRuntime {
  private vmContext: vm.Context | null = null;

  constructor(private upstreamServerManager: UpstreamServerManager) {}

  async eval(code: string, arg: unknown = {}): Promise<{ result: unknown; output: string }> {
    // Initialize VM context if not already created
    if (!this.vmContext) {
      await this.initializeContext();
    }

    // Create output buffer for this eval call
    const output: string[] = [];

    // Update console methods to use this call's output buffer
    if (!this.vmContext) {
      throw new Error("VM context not initialized");
    }
    this.vmContext.console = {
      log: (...args: unknown[]) => {
        output.push(`[LOG] ${args.map((arg) => String(arg)).join(" ")}`);
      },
      error: (...args: unknown[]) => {
        output.push(`[ERROR] ${args.map((arg) => String(arg)).join(" ")}`);
      },
      warn: (...args: unknown[]) => {
        output.push(`[WARN] ${args.map((arg) => String(arg)).join(" ")}`);
      },
      info: (...args: unknown[]) => {
        output.push(`[INFO] ${args.map((arg) => String(arg)).join(" ")}`);
      },
    };

    // Run the code and capture the result
    // Treat code as a function expression and call it with the arg
    this.vmContext.__evalArg = arg;
    let result = await vm.runInContext(
      `(async () => {
      const fn = ${code};
      return await fn(__evalArg);
    })()`,
      this.vmContext,
      {
        timeout: 30000,
      }
    );
    // Clean up
    delete this.vmContext.__evalArg;

    // Auto-await if result is a promise
    if (result && typeof result === "object" && result !== null && "then" in result) {
      result = await (result as Promise<unknown>);
    }

    return {
      result,
      output: output.join("\n"),
    };
  }

  appendResult(result: unknown): number {
    if (!this.vmContext) {
      throw new Error("VM context not initialized");
    }
    // Access $results from vmContext and push the new result
    const results = this.vmContext.$results as unknown[];
    results.push(result);
    return results.length - 1;
  }

  private async initializeContext(): Promise<void> {
    // Create proxies for all connected servers
    const proxies = await createServerProxies(this.upstreamServerManager);
    const context = createGlobalContext(proxies, this.upstreamServerManager);

    // Create VM context with initial setup
    const vmContextData = {
      ...context,
      console: {
        // These will be overridden per eval call
        log: () => {
          // Placeholder - overridden per eval call
        },
        error: () => {
          // Placeholder - overridden per eval call
        },
        warn: () => {
          // Placeholder - overridden per eval call
        },
        info: () => {
          // Placeholder - overridden per eval call
        },
      },
      // Add other globals that might be needed
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      process: { env: process.env },
      // Results array for invoke tool
      $results: [],
    };

    this.vmContext = vm.createContext(vmContextData);
  }
}

// AsyncFunction constructor (available in modern JS environments)
const _AsyncFunction = (async () => {
  // Intentionally empty async function for constructor access
}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;
