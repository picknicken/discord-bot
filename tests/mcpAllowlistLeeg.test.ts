import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Client } from 'discord.js';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { demoGuilds } from '../src/demoServers.js';

/**
 * Het hart van de eis: een lege `MCP_ALLOWED_GUILD_IDS` betekent hier "geen
 * enkele server", niet "geen beperking" zoals bij GUILD_IDS. MCP staat aan,
 * de bot zit in servers, en Claude komt er via MCP toch bij geen enkele in.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'mcp-leeg-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = werkmap;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
process.env.MCP_ENABLED = 'true';
process.env.MCP_AUTH_TOKEN = 'geheim-token';
delete process.env.MCP_ALLOWED_GUILD_IDS;

const { createDashboard } = await import('../src/dashboard/server.js');

const client = { user: { username: 'Setup Bot', id: '1', displayAvatarURL: () => '' }, guilds: { cache: demoGuilds() } } as unknown as Client<true>;

let server: Server;
let base: string;

async function mcpClient() {
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { authorization: 'Bearer geheim-token' } },
  });
  const mcp = new McpClient({ name: 'test', version: '1.0.0' });
  await mcp.connect(transport);
  return mcp;
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createDashboard(client);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
        resolve();
      });
    }),
);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(werkmap, { recursive: true, force: true });
});

describe('lege MCP-allowlist geeft geen onbeperkte toegang', () => {
  it('list_allowed_servers geeft niets terug, ook al zit de bot in servers', async () => {
    const mcp = await mcpClient();
    const uitkomst = await mcp.callTool({ name: 'list_allowed_servers', arguments: {} });
    const tekst = (uitkomst.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(JSON.parse(tekst)).toEqual({ servers: [] });
    await mcp.close();
  });

  it('elke server wordt geweigerd, ook eentje die echt bestaat', async () => {
    const mcp = await mcpClient();
    const uitkomst = await mcp.callTool({ name: 'get_server', arguments: { guildId: '1' } });
    expect(uitkomst.isError).toBe(true);
    await mcp.close();
  });
});
