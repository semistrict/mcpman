import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTestClient } from './test-setup.js';

describe('Basic MCP Connection Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const testSetup = await createTestClient('mcpman-basic-test-client');
    client = testSetup.client;
    transport = testSetup.transport;
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it('should list tools', async () => {
    const result = await client.listTools();

    expect(result.tools).toBeDefined();
    expect(result.tools?.length).toBeGreaterThan(0);

    const evalTool = result.tools?.find(tool => tool.name === 'eval');
    expect(evalTool).toBeDefined();
    expect(evalTool?.name).toBe('eval');
  });
});