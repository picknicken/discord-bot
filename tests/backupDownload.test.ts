import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, type Client } from 'discord.js';

/**
 * Een back-up die je niet kunt ophalen is geen back-up. Op een hostingpartij
 * zonder volume staat hij op een schijf die bij de volgende deploy leeg is, dus
 * downloaden is het verschil tussen een veiligheidsnet en de illusie ervan.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-dl-'));
const backupsDir = path.join(werkmap, 'backups');
mkdirSync(backupsDir, { recursive: true });
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

const payload = (guildId: string, guildName: string) =>
  JSON.stringify({
    guildId,
    guildName,
    createdAt: '2026-09-20T10:00:00.000Z',
    template: { name: guildName, roles: [], categories: [], uncategorizedChannels: [] },
  });

writeFileSync(path.join(backupsDir, 'mijn.json'), payload('1', 'Picknicken Community'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
process.env.BACKUPS_DIR = backupsDir;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.DEMO = '1';
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

describe('een back-up ophalen', () => {
  it('geeft het bestand terug als download', async () => {
    const response = await fetch(base + '/api/backups/mijn.json');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain('mijn.json');
    expect(JSON.parse(await response.text()).guildName).toBe('Picknicken Community');
  });

  it('kent een back-up die er niet is niet', async () => {
    expect((await fetch(base + '/api/backups/bestaatniet.json')).status).toBe(404);
  });

  it('laat niemand buiten de map grasduinen', async () => {
    // Node normaliseert ../ in het pad, dus dit komt als een ander pad binnen —
    // maar het mag hoe dan ook geen bestand van buiten de back-upmap opleveren.
    for (const pad of ['/api/backups/..%2F..%2Fpackage.json', '/api/backups/%2Fetc%2Fpasswd']) {
      const response = await fetch(base + pad);
      expect(response.status, pad).not.toBe(200);
    }
  });
});

describe('een back-up uit een bestand terugzetten', () => {
  it('leest de meegestuurde inhoud in plaats van een bestand op schijf', async () => {
    const response = await fetch(base + '/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inhoud: payload('1', 'Picknicken Community'), guildId: '1' }),
    });

    expect(response.status).toBe(200);
    // Demo-modus: hij rekent het wel uit, maar verandert niets.
    expect((await response.json() as { note?: string }).note).toMatch(/demo|niets/i);
  });

  it('zegt het als het bestand geen back-up is', async () => {
    for (const inhoud of ['dit is geen json', '{"zomaar":"iets"}']) {
      const response = await fetch(base + '/api/backups/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inhoud, guildId: '1' }),
      });

      expect(response.status, inhoud).toBe(400);
      expect((await response.json() as { error: string }).error).toMatch(/JSON|back-up/i);
    }
  });
});
