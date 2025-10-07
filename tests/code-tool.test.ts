import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const TEST_LLM_RESPONSE_DIR = join(tmpdir(), 'mcpman-test-llm-responses');

async function createTestClientWithLLMMock(name: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['index.ts'],
    env: {
      ...process.env,
      MCP_CONFIG_DIR: 'tests/config',
      MCPMAN_TEST_LLM_RESPONSE_DIR: TEST_LLM_RESPONSE_DIR,
    },
  });

  const client = new Client(
    {
      name,
      version: '1.0.0',
    },
    {
      capabilities: {
        roots: { listChanged: true },
      },
    }
  );

  // Set up roots handler to provide test directory
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [
      {
        uri: `file://${process.cwd()}`,
        name: "Test Directory",
      },
    ],
  }));

  await client.connect(transport);

  // Wait for tools to be registered
  await waitForToolRegistration(client);

  return { client, transport };
}

async function waitForToolRegistration(client: Client, maxRetries = 50, delayMs = 100): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await client.listTools();
      const codeTool = result.tools?.find(tool => tool.name === 'code');
      if (codeTool) {
        return;
      }
    } catch (error) {
      // Ignore errors and keep retrying
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error('Timeout waiting for tool registration to complete');
}

async function setMockLLMResponse(functionDescription: string, code: string): Promise<void> {
  // Ensure directory exists
  await mkdir(TEST_LLM_RESPONSE_DIR, { recursive: true });

  // Compute SHA1 of function description
  const hash = createHash('sha1').update(functionDescription).digest('hex');
  const responseFile = join(TEST_LLM_RESPONSE_DIR, `response-${hash}.txt`);

  await writeFile(responseFile, code, 'utf-8');
}

async function clearMockLLMResponses(): Promise<void> {
  try {
    await rm(TEST_LLM_RESPONSE_DIR, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist, ignore
  }
}

describe('Code Tool Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    await clearMockLLMResponses();
    const testSetup = await createTestClientWithLLMMock('mcpman-code-test-client');
    client = testSetup.client;
    transport = testSetup.transport;
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    await clearMockLLMResponses();
  });

  it('should generate and execute code using mocked LLM response', async () => {
    await setMockLLMResponse('return 42', 'async () => { return 42; }');

    const result = await client.callTool({
      name: 'code',
      arguments: {
        functionDescription: 'return 42',
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    const text = content[0]?.text || '';

    expect(text).toContain('Generated code:');
    expect(text).toContain('async () => { return 42; }');
    expect(text).toContain('Execution result:');
    expect(text).toContain('$results[0] = // code');
    expect(text).toContain('42');
  });

  it('should store code results in $results array', async () => {
    await setMockLLMResponse('return 42', 'async () => { return 42; }');

    // First call to code tool
    await client.callTool({
      name: 'code',
      arguments: {
        functionDescription: 'return 42',
      },
    });

    // Use eval to access the result from the code tool
    const evalResult = await client.callTool({
      name: 'eval',
      arguments: {
        code: '() => $results[1]',
      },
    });

    const content = evalResult.content as Array<{type: string, text: string}>;
    expect(content[0]?.text).toContain('42');
  });

  it('should execute generated code that uses MCP context', async () => {
    await setMockLLMResponse(
      'check if there are any servers',
      'async () => { const servers = listServers(); return servers.length > 0; }'
    );

    const result = await client.callTool({
      name: 'code',
      arguments: {
        functionDescription: 'check if there are any servers',
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    const text = content[0]?.text || '';

    expect(text).toContain('Generated code:');
    expect(text).toContain('listServers()');
    expect(text).toContain('Execution result:');
    expect(text).toContain('$results[3] = // code');
    expect(text).toContain('true');
  });

  it('should execute generated code that calls upstream MCP tools', async () => {
    await setMockLLMResponse(
      'list files in current directory',
      'async () => { const result = await filesystem.list_directory({ path: "." }); return result.length > 0; }'
    );

    const result = await client.callTool({
      name: 'code',
      arguments: {
        functionDescription: 'list files in current directory',
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    const text = content[0]?.text || '';

    expect(text).toContain('Generated code:');
    expect(text).toContain('filesystem.list_directory');
    expect(text).toContain('Execution result:');
    expect(text).toContain('$results[4] = // code');
    expect(text).toContain('true');
  });
});

describe('Code Tool Test - TypeScript Validation (requires Claude CLI)', () => {
  let client: Client;
  let transport: StdioClientTransport;
  let hasClaudeCLI = false;

  beforeAll(async () => {
    // Check if Claude CLI is available
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFilePromise = promisify(execFile);
      await execFilePromise('which', ['claude']);
      hasClaudeCLI = true;
    } catch {
      hasClaudeCLI = false;
    }

    await clearMockLLMResponses();
    const testSetup = await createTestClientWithLLMMock('mcpman-code-validation-test-client');
    client = testSetup.client;
    transport = testSetup.transport;
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    await clearMockLLMResponses();
  });

  it.skip('should allow Agent SDK to retry when TypeScript compilation fails', async () => {
    // This test requires real Claude CLI and cannot run in test mode with mocked responses
    // To manually test TypeScript validation with retries:
    // 1. Remove MCPMAN_TEST_LLM_RESPONSE_DIR from environment
    // 2. Ensure Claude CLI is installed
    // 3. Run this test individually

    if (!hasClaudeCLI) {
      console.log('Skipping test: Claude CLI not found');
      return;
    }

    const result = await client.callTool({
      name: 'code',
      arguments: {
        functionDescription: 'return the number 42',
      },
    });

    const content = result.content as Array<{type: string, text: string}>;
    const text = content[0]?.text || '';

    expect(text).toContain('Generated code:');
    expect(text).toContain('42');
  });
});
