import { createWriteStream, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { getConfigDir } from "../config/loader.js";

let logStream: WriteStream | null = null;
let traceStream: WriteStream | null = null;
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

  // Create log stream
  logStream = createWriteStream(logPath, { flags: "a" });

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
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");

    if (logStream) {
      logStream.write(`[${timestamp}] ${level}: ${message}\n`);
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

  if (!traceStream) {
    const tracePath = `${homedir()}/.mcpman/trace.log`;

    // Ensure directory exists
    try {
      const traceDir = dirname(tracePath);
      require("node:fs").mkdirSync(traceDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create trace directory: ${error}`);
      return;
    }

    traceStream = createWriteStream(tracePath, { flags: "a" });
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

  if (traceStream) {
    traceStream.write(`[${timestamp}] TRACE [${location}]: ${message}\n`);
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

  if (logStream) {
    logStream.end();
    logStream = null;
  }

  if (traceStream) {
    traceStream.end();
    traceStream = null;
  }
}

// Cleanup on process exit
process.on("exit", restoreConsole);
process.on("SIGINT", restoreConsole);
process.on("SIGTERM", restoreConsole);
