import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createTestClient } from './test-setup.js';

describe('Eval with Argument Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const testSetup = await createTestClient('mcpman-arg-test-client');
    client = testSetup.client;
    transport = testSetup.transport;
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it('should execute function with argument', async () => {
    const result = await client.callTool({
      name: 'eval',
      arguments: {
        code: '(arg) => arg.value * 2',
        arg: { value: 21 }
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toBe('Result: 42');
  });

  it('should execute function without argument', async () => {
    const result = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => "hello world"',
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toBe('Result: hello world');
  });

  it('should execute async function with argument', async () => {
    const result = await client.callTool({
      name: 'eval',
      arguments: {
        code: 'async (arg) => { await new Promise(resolve => setTimeout(resolve, 10)); return arg.name.toUpperCase(); }',
        arg: { name: 'test' }
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toBe('Result: TEST');
  });

  it('should execute function with complex argument object', async () => {
    const result = await client.callTool({
      name: 'eval',
      arguments: {
        code: '(arg) => { console.log("Processing:", arg.user.name); return arg.data.items.length; }',
        arg: {
          user: { name: 'alice' },
          data: { items: ['a', 'b', 'c'] }
        }
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toContain('Result: 3');
    expect(content[0]?.text).toContain('[LOG] Processing: alice');
  });

  it('should execute function that accesses global MCP context with argument', async () => {
    const result = await client.callTool({
      name: 'eval',
      arguments: {
        code: '(arg) => { console.log("Checking for MCP context"); return typeof listServers === "function" && arg.testValue === 42; }',
        arg: { testValue: 42 }
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toContain('Result: true');
    expect(content[0]?.text).toContain('[LOG] Checking for MCP context');
  });

  it('should use help function via MCP tool', async () => {
    const result = await client.callTool({
      name: 'help',
      arguments: {
        server: 'filesystem'
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    const helpText = content[0]?.text || '';
    const helpData = JSON.parse(helpText);

    expect(helpData.server).toBe('filesystem');
    expect(helpData.tools).toBeInstanceOf(Array);
    expect(helpData.tools.length).toBeGreaterThan(0);
  });

  it('should use help function via eval global context', async () => {
    const result = await client.callTool({
      name: 'eval',
      arguments: {
        code: 'async (arg) => { const helpInfo = await help(arg.server); return helpInfo.server === arg.server; }',
        arg: { server: 'filesystem' }
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toBe('Result: true');
  });

  it('should call filesystem server tools via eval', async () => {
    const result = await client.callTool({
      name: 'eval',
      arguments: {
        code: 'async () => { const files = await filesystem.list_directory({ path: "." }); return files.length > 0; }',
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toBe('Result: true');
  });
});