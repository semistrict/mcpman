import { z } from "zod";

export const StdioServerConfigSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional().default({}),
  disabled: z.boolean().optional().default(false),
  timeout: z.number().optional().default(30000),
});

export const HttpServerConfigSchema = z.object({
  transport: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string()).optional().default({}),
  disabled: z.boolean().optional().default(false),
  timeout: z.number().optional().default(30000),
  // OAuth 2.1 configuration (per MCP spec)
  oauth: z
    .object({
      // Client metadata for dynamic registration
      clientName: z.string().default("mcpman"),
      redirectUrl: z.string().url().default("http://localhost:8080/oauth/callback"),
      scopes: z.array(z.string()).optional().default(["mcp:tools"]),
      // Pre-registered client credentials (optional)
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    })
    .optional(),
});

export const ServerConfigSchema = z.discriminatedUnion("transport", [
  StdioServerConfigSchema,
  HttpServerConfigSchema,
]);

export const SettingsSchema = z.object({
  version: z.string().optional().default("1.0"),
  servers: z.record(ServerConfigSchema),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
      file: z.string().optional(),
    })
    .optional()
    .default({}),
});

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
