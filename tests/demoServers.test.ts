import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, type Client } from 'discord.js';

/**
 * De ontwikkelmodus is alleen wat waard als de nagemaakte servers ook echt de
 * problemen laten zien die ze horen te hebben. Anders bouw je het dashboard op
 * vier keer dezelfde brave server.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-demo-'));
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
delete process.env.GUILD_IDS;

const { createDashboard } = await import('../src/dashboard/server.js');
const { demoGuilds } = await import('../src/demoServers.js');

const client = {
  user: { username: 'Setup Bot', id: '1', displayAvatarURL: () => '' },
  guilds: { cache: demoGuilds() },
} as unknown as Client<true>;

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

type Guild = {
  id: string;
  name: string;
  missing: string[];
  rolesAbove: number;
  roleCount: number;
  channelCount: number;
};
const state = async () => (await (await fetch(base + '/api/state')).json()) as { guilds: Guild[] };

describe('de servers in de ontwikkelmodus', () => {
  it('geeft vier servers, elk met een eigen verhaal', async () => {
    const { guilds } = await state();
    expect(guilds.map((guild) => guild.name)).toEqual([
      'Picknicken Community',
      'Gaming Nederland',
      'Test Server',
      'Kapotte Rechten',
    ]);
  });

  it('heeft er een waar niets aan de hand is', async () => {
    const goed = (await state()).guilds.find((guild) => guild.name === 'Picknicken Community');
    expect(goed?.missing).toEqual([]);
    expect(goed?.rolesAbove).toBe(0);
  });

  it('heeft een lege server om vanaf nul op te bouwen', async () => {
    const leeg = (await state()).guilds.find((guild) => guild.name === 'Test Server');
    expect(leeg?.channelCount).toBe(0);
    expect(leeg?.roleCount).toBe(0);
    expect(leeg?.missing.length).toBeGreaterThan(0);
  });

  it('heeft er een waar de bot rechten mist en onder een rol staat', async () => {
    const kapot = (await state()).guilds.find((guild) => guild.name === 'Kapotte Rechten');
    expect(kapot?.missing).toContain('ManageRoles');
    expect(kapot?.rolesAbove).toBeGreaterThan(0);
  });

  it('laat de afgeweken server verschillen zien met de template', async () => {
    const template = await (await fetch(base + '/api/templates/community')).json();
    const vergelijking = await fetch(base + '/api/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: (template as { json: string }).json, guildId: '2' }),
    });

    const data = (await vergelijking.json()) as { counts: Record<string, number> };
    expect(data.counts.extra).toBeGreaterThan(0);
    expect(data.counts.new).toBeGreaterThan(0);
  });
});
