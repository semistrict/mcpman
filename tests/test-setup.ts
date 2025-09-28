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

  return { client, transport };
}