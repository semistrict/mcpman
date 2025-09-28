import { z } from "zod";
import { type Settings, SettingsSchema } from "./schema.js";

export class ConfigError extends Error {
  constructor(
    message: string,
    public override cause?: unknown
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

export function getConfigDir(): string {
  // Check for environment variable first
  if (process.env.MCP_CONFIG_DIR) {
    return process.env.MCP_CONFIG_DIR;
  }

  // Fall back to default home directory location
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    throw new ConfigError("Unable to determine home directory");
  }
  return `${home}/.mcpman`;
}

export function getConfigPath(): string {
  return `${getConfigDir()}/settings.json`;
}

export async function loadConfig(): Promise<Settings> {
  const configPath = getConfigPath();

  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();

    if (!exists) {
      throw new ConfigError(`Config file not found: ${configPath}`);
    }

    const text = await file.text();
    const json = JSON.parse(text);

    return SettingsSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
      throw new ConfigError(`Invalid config: ${messages.join(", ")}`, error);
    }

    if (error instanceof SyntaxError) {
      throw new ConfigError(`Invalid JSON in config file: ${error.message}`, error);
    }

    throw error;
  }
}

export function createDefaultConfig(): Settings {
  return {
    version: "1.0",
    servers: {
      filesystem: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: {},
        disabled: false,
        timeout: 30000,
      },
    },
    logging: {
      level: "info",
    },
  };
}

export async function ensureConfigDir(): Promise<void> {
  const configDir = getConfigDir();

  try {
    await Bun.$`mkdir -p ${configDir}`;
  } catch (error) {
    throw new ConfigError(`Failed to create config directory: ${configDir}`, error);
  }
}
