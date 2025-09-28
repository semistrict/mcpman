import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createTestClient } from './test-setup.js';

describe('Eval Persistence Integration Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const testSetup = await createTestClient('mcpman-test-client');
    client = testSetup.client;
    transport = testSetup.transport;
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it('should persist variables across multiple eval calls', async () => {
    // First eval: set a variable
    const result1 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => { globalThis.x = 42; return x; }',
      },
    });

    const content1 = result1.content as Array<{type: string, text: string}>;
    expect(content1[0]?.text).toBe('Result: 42');

    // Second eval: use the variable (should persist)
    const result2 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => x + 8',
      },
    });

    const content2 = result2.content as Array<{type: string, text: string}>;
    expect(content2[0]?.text).toBe('Result: 50');

    // Third eval: modify the variable
    const result3 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => { x = x + 8; return x; }',
      },
    });

    const content3 = result3.content as Array<{type: string, text: string}>;
    expect(content3[0]?.text).toBe('Result: 50');

    // Fourth eval: multiply and verify persistence
    const result4 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => { x = x * 2; return x; }',
      },
    });

    const content4 = result4.content as Array<{type: string, text: string}>;
    expect(content4[0]?.text).toBe('Result: 100');
  });

  it('should persist function definitions', async () => {
    // Define a function
    const result1 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => { globalThis.add = function(a, b) { return a + b; }; }',
      },
    });

    // Call the function
    const result2 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => add(10, 20)',
      },
    });

    const content2 = result2.content as Array<{type: string, text: string}>;
    expect(content2[0]?.text).toBe('Result: 30');

    // Redefine the function
    const result3 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => { globalThis.add = function(a, b) { return a * b; }; }',
      },
    });

    // Call the redefined function
    const result4 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => add(10, 20)',
      },
    });

    const content4 = result4.content as Array<{type: string, text: string}>;
    expect(content4[0]?.text).toBe('Result: 200');
  });

  it('should persist objects and complex data structures', async () => {
    // Create an object
    const result1 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => { globalThis.data = { count: 0, items: [] }; return data.count; }',
      },
    });

    const content1 = result1.content as Array<{type: string, text: string}>;
    expect(content1[0]?.text).toBe('Result: 0');

    // Modify the object
    const result2 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => { data.count++; data.items.push("hello"); return data; }',
      },
    });

    const content2 = result2.content as Array<{type: string, text: string}>;
    const resultText = content2[0]?.text || '';
    const dataStr = resultText.replace('Result: ', '');
    const data = JSON.parse(dataStr);
    expect(data.count).toBe(1);
    expect(data.items).toEqual(['hello']);

    // Verify persistence
    const result3 = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => data.items.length',
      },
    });

    const content3 = result3.content as Array<{type: string, text: string}>;
    expect(content3[0]?.text).toBe('Result: 1');
  });
});