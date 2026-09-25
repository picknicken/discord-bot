import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Client } from 'discord.js';
import { demoGuilds } from '../src/demoServers.js';

/**
 * MCP_ENABLED is standaard uit. Een bot die draait mag niet in één klap ook
 * een externe koppeling naar Claude openzetten zonder dat iemand dat expliciet
 * aanzet — dus dit bestand laat MCP_ENABLED bewust ongezet.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'mcp-uit-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = werkmap;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
delete process.env.MCP_ENABLED;
delete process.env.MCP_AUTH_TOKEN;
delete process.env.MCP_ALLOWED_GUILD_IDS;

const { createDashboard } = await import('../src/dashboard/server.js');

const client = { user: { username: 'Setup Bot', id: '1', displayAvatarURL: () => '' }, guilds: { cache: demoGuilds() } } as unknown as Client<true>;

let server: Server;
let base: string;

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

describe('MCP staat standaard uit', () => {
  it('geeft 404 op /mcp, ook met een verzonnen token', async () => {
    const response = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer wat-dan-ook',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(404);
  });
});
