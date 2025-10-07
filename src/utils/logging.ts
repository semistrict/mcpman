import { closeSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { getConfigDir } from "../config/loader.js";

let logFd: number | null = null;
let traceFd: number | null = null;
let originalConsole: {
  log: typeof console.log;
  error: typeof console.error;
  warn: typeof console.warn;
  info: typeof console.info;
} | null = null;

export function redirectConsole(): void {
  if (originalConsole) {
    // Already redirected
    return;
  }

  // Get log path using config directory
  const configDir = getConfigDir();
  const logPath = `${configDir}/mcpman.log`;

  // Ensure directory exists
  try {
    const logDir = dirname(logPath);
    require("node:fs").mkdirSync(logDir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create log directory: ${error}`);
    return;
  }

  // Open log file descriptor once for synchronous writes
  try {
    logFd = openSync(logPath, "a");
  } catch (error) {
    console.error(`Failed to open log file: ${error}`);
    return;
  }

  // Store original console methods
  originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };

  // Helper function to write only to log file
  const writeToLog = (level: string, args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        if (arg instanceof Error) {
          let errorStr = `${arg.name}: ${arg.message}`;
          if (arg.stack) {
            errorStr += `\n${arg.stack}`;
          }
          if (arg.cause) {
            errorStr += `\nCaused by: ${arg.cause instanceof Error ? arg.cause.message : String(arg.cause)}`;
          }
          return errorStr;
        }
        return JSON.stringify(arg);
      })
      .join(" ");

    if (logFd !== null) {
      // Use synchronous write to ensure logs are written even if process crashes
      try {
        writeSync(logFd, `[${timestamp}] ${level}: ${message}\n`);
      } catch (_error) {
        // Can't log this error since console is redirected
      }
    }
  };

  // Override console methods to only log to file
  console.log = (...args: unknown[]) => {
    writeToLog("LOG", args);
  };

  console.error = (...args: unknown[]) => {
    writeToLog("ERROR", args);
  };

  console.warn = (...args: unknown[]) => {
    writeToLog("WARN", args);
  };

  console.info = (...args: unknown[]) => {
    writeToLog("INFO", args);
  };
}

export function TRACE(...args: unknown[]): void {
  if (!process.env.MCPMAN_TRACE) {
    return;
  }

  if (traceFd === null) {
    const tracePath = `${homedir()}/.mcpman/trace.log`;

    // Ensure directory exists
    try {
      const traceDir = dirname(tracePath);
      require("node:fs").mkdirSync(traceDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create trace directory: ${error}`);
      return;
    }

    try {
      traceFd = openSync(tracePath, "a");
    } catch (error) {
      console.error(`Failed to open trace file: ${error}`);
      return;
    }
  }

  // Get caller file and line number
  const stack = new Error().stack;
  let location = "unknown";
  if (stack) {
    const lines = stack.split("\n");
    // Skip the first line (Error:) and second line (this function)
    const callerLine = lines[2];
    if (callerLine) {
      // Extract file:line from something like "at functionName (/path/to/file.ts:123:45)"
      const match = callerLine.match(/\(([^)]+)\)$/) || callerLine.match(/at (.+)$/);
      if (match?.[1]) {
        const fullPath = match[1];
        // Extract just filename:line from full path
        const fileMatch = fullPath.match(/([^/]+):(\d+):\d+$/);
        if (fileMatch) {
          location = `${fileMatch[1]}:${fileMatch[2]}`;
        }
      }
    }
  }

  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");

  if (traceFd !== null) {
    try {
      writeSync(traceFd, `[${timestamp}] TRACE [${location}]: ${message}\n`);
    } catch (_error) {
      // Can't log this error since console is redirected
    }
  }
}

// Cleanup function to restore original console
export function restoreConsole(): void {
  if (originalConsole) {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    originalConsole = null;
  }

  if (logFd !== null) {
    try {
      closeSync(logFd);
    } catch (_error) {
      // Ignore errors when closing
    }
    logFd = null;
  }

  if (traceFd !== null) {
    try {
      closeSync(traceFd);
    } catch (_error) {
      // Ignore errors when closing
    }
    traceFd = null;
  }
}

// Cleanup on process exit
process.on("exit", restoreConsole);
process.on("SIGINT", restoreConsole);
process.on("SIGTERM", restoreConsole);
