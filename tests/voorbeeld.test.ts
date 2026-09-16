import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, type Client } from 'discord.js';

/**
 * Het voorbeeld naast de editor tekent zichzelf uit deze uitkomst. Verandert de
 * vorm ervan, dan blijft het scherm het gewoon doen maar klopt er niets meer van
 * — kanalen die verborgen zouden moeten zijn staan er dan gewoon tussen. Vandaar
 * dat de velden die het gebruikt hier vastliggen.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-vb-'));
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
delete process.env.GUILD_IDS;

const { createDashboard } = await import('../src/dashboard/server.js');

const client = {
  user: { username: 'Setup Bot', id: '1', displayAvatarURL: () => '' },
  guilds: { cache: new Collection() },
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

const json = readFileSync(path.join(werkmap, 'community.json'), 'utf8');

const analyse = async (role: string) =>
  (await (
    await fetch(base + '/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json, role }),
    })
  ).json()) as any;

describe('wat het voorbeeld van de server nodig heeft', () => {
  it('geeft de rollen om uit te kiezen', async () => {
    const data = await analyse('@everyone');
    expect(data.roles.map((rol: { key: string }) => rol.key)).toContain('@everyone');
  });

  it('geeft per categorie de kanalen met zichtbaarheid en een reden', async () => {
    const { simulation } = await analyse('@everyone');

    expect(simulation.categories.length).toBeGreaterThan(0);
    const kanaal = simulation.categories[0].channels[0];
    expect(kanaal).toHaveProperty('name');
    expect(kanaal).toHaveProperty('type');
    expect(typeof kanaal.visible).toBe('boolean');
    expect(typeof kanaal.reason).toBe('string');
    expect(Array.isArray(simulation.uncategorized)).toBe(true);
    expect(simulation.totalCount).toBeGreaterThan(0);
  });

  it('laat een rol met minder rechten ook echt minder zien', async () => {
    const iedereen = (await analyse('@everyone')).simulation;
    const bots = (await analyse('bots')).simulation;

    expect(bots.visibleCount).toBeLessThan(iedereen.totalCount);
    expect(bots.categories.some((c: any) => c.channels.some((k: any) => !k.visible))).toBe(true);
  });

  it('zegt het als een rol administrator heeft, want die ziet alles', async () => {
    const { simulation } = await analyse('admin');
    expect(simulation.administrator).toBe(true);
  });
});
