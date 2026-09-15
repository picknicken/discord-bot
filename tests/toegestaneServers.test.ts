import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

/**
 * GUILD_IDS begrenst de hele installatie: ook zonder inloggen, ook op de eigen
 * computer. De bot zit in twee servers, maar er staat er maar een op de lijst.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-lijst-'));
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
process.env.GUILD_IDS = 'toegestaan-1';

const { createDashboard } = await import('../src/dashboard/server.js');
const { stubClient, stubGuild } = await import('./helpers/guild.js');

const client = stubClient([stubGuild('toegestaan-1', 'Mag wel'), stubGuild('elders-9', 'Mag niet')]);

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

type Json = Record<string, any>;
const json = async <T extends Json = Json>(response: Response): Promise<T> => (await response.json()) as T;
const post = (pad: string, body: unknown) =>
  fetch(base + pad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('alleen de servers uit GUILD_IDS', () => {
  it('toont alleen de server die op de lijst staat', async () => {
    const state = await json(await fetch(base + '/api/state'));
    expect(state.guilds.map((guild: { id: string }) => guild.id)).toEqual(['toegestaan-1']);
  });

  it('weigert een server die er niet op staat, met de reden erbij', async () => {
    const response = await post('/api/apply', { templateId: 'community', guildId: 'elders-9' });
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatch(/staat niet in de lijst/);
  });

  it('weigert ook het exporteren van zo een server', async () => {
    expect((await fetch(base + '/api/export/elders-9')).status).toBe(403);
  });

  it('laat de toegestane server gewoon door', async () => {
    const plan = await json(await post('/api/plan', { templateId: 'community', guildId: 'toegestaan-1' }));
    expect(plan.count).toBeGreaterThan(0);
  });
});
