import vm from "node:vm";
import type { ClientManager } from "../mcp/client-manager.js";
import { createGlobalContext, createServerProxies } from "./proxy.js";

export class EvalRuntime {
  private vmContext: vm.Context | null = null;

  constructor(private clientManager: ClientManager) {}

  async eval(code: string): Promise<{ result: unknown; output: string }> {
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
    let result: unknown;
    // For simple expressions, try evaluating directly
    if (
      !code.includes(";") &&
      !code.includes("\n") &&
      !code.match(/^\s*(let|const|var|function|class|if|for|while)\s/)
    ) {
      result = await vm.runInContext(`(async () => { return ${code}; })()`, this.vmContext, {
        timeout: 30000,
      });
    } else {
      // For statements, try to return the last expression if possible
      // Split by both newlines and semicolons to find statements
      const statements = code
        .trim()
        .split(/[;\n]/)
        .map((s) => s.trim())
        .filter((s) => s);
      const lastStatement = statements[statements.length - 1] || "";

      // If the last statement looks like an expression, try to return it
      if (
        lastStatement &&
        !lastStatement.match(/^\s*(let|const|var|function|class|if|for|while|return|{)\s/)
      ) {
        const precedingStatements = statements.slice(0, -1).join(";\n");
        const codeToRun = precedingStatements
          ? `${precedingStatements};\n return ${lastStatement};`
          : `return ${lastStatement};`;
        result = await vm.runInContext(`(async () => { ${codeToRun} })()`, this.vmContext, {
          timeout: 30000,
        });
      } else {
        // Run as statements only
        result = await vm.runInContext(`(async () => { ${code} })()`, this.vmContext, {
          timeout: 30000,
        });
      }
    }

    // Auto-await if result is a promise
    if (result && typeof result === "object" && result !== null && "then" in result) {
      result = await (result as Promise<unknown>);
    }

    return {
      result,
      output: output.join("\n"),
    };
  }

  private async initializeContext(): Promise<void> {
    // Create proxies for all connected servers
    const proxies = await createServerProxies(this.clientManager);
    const context = createGlobalContext(proxies);

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
