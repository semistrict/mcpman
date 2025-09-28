import { createWriteStream, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { getConfigDir } from "../config/loader.js";

let logStream: WriteStream | null = null;
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
}

// Cleanup on process exit
process.on("exit", restoreConsole);
process.on("SIGINT", restoreConsole);
process.on("SIGTERM", restoreConsole);
