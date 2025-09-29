import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function createTestClient(name: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['index.ts'],
    env: {
      ...process.env,
      MCP_CONFIG_DIR: 'tests/config',
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

  // Wait for tools to be registered (poll until eval tool is available)
  await waitForToolRegistration(client);

  return { client, transport };
}

async function waitForToolRegistration(client: Client, maxRetries = 50, delayMs = 100): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await client.listTools();
      const evalTool = result.tools?.find(tool => tool.name === 'eval');
      if (evalTool) {
        // Real tools are available, registration is complete
        return;
      }
    } catch (error) {
      // Ignore errors and keep retrying
    }

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error('Timeout waiting for tool registration to complete');
}