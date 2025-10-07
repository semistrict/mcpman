import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTestClient } from "./test-setup.js";

describe("Invoke Before Eval Test", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const testSetup = await createTestClient("mcpman-invoke-before-eval-test");
    client = testSetup.client;
    transport = testSetup.transport;
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it("should handle invoke call before any eval calls", async () => {
    // Call invoke before any eval - this should initialize the VM context
    const invokeResult = await client.callTool({
      name: "invoke",
      arguments: {
        calls: [
          {
            server: "filesystem",
            tool: "list_allowed_directories",
            parameters: {},
          },
        ],
        parallel: false,
      },
    });

    expect(invokeResult.isError).toBeFalsy();
    expect(invokeResult.content).toBeDefined();
    expect(Array.isArray(invokeResult.content)).toBe(true);

    // Now call eval to access $results
    const evalResult = await client.callTool({
      name: "eval",
      arguments: {
        code: "() => $results.length",
      },
    });

    expect(evalResult.isError).toBeFalsy();
    expect(evalResult.content).toBeDefined();

    const content = evalResult.content as Array<{ type: string; text: string }>;
    const textContent = content.find((c) => c.type === "text");
    expect(textContent).toBeDefined();
    expect(textContent?.text).toBe("Result: 1");
  });

  it("should store invoke results in $results array accessible from eval", async () => {
    // Call invoke to store a result
    const invokeResult = await client.callTool({
      name: "invoke",
      arguments: {
        calls: [
          {
            server: "filesystem",
            tool: "list_allowed_directories",
            parameters: {},
          },
        ],
        parallel: false,
      },
    });

    expect(invokeResult.isError).toBeFalsy();

    // Access the stored result from eval - check it's an array
    const evalResult = await client.callTool({
      name: "eval",
      arguments: {
        code: "() => Array.isArray($results[$results.length - 1])",
      },
    });

    expect(evalResult.isError).toBeFalsy();
    expect(evalResult.content).toBeDefined();

    const content = evalResult.content as Array<{ type: string; text: string }>;
    const textContent = content.find((c) => c.type === "text");
    expect(textContent).toBeDefined();
    expect(textContent?.text).toBe("Result: true");
  });
});
