import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, type Client } from 'discord.js';

/**
 * Het instellingenscherm laat zien waar deze installatie op staat. Precies daar
 * is het verleidelijk om "even alles" mee te sturen — en dan staat de bot-token
 * in de broncode van een pagina die iedereen met een sessie kan openen.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-inst-'));
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

const TOKEN = 'dit-is-de-geheime-token';
const SECRET = 'dit-is-het-geheime-secret';

process.env.DISCORD_TOKEN = TOKEN;
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
process.env.GUILD_IDS = '111,222';

const { createDashboard } = await import('../src/dashboard/server.js');

const client = {
  user: { username: 'Setup Bot', id: '123456789', displayAvatarURL: () => '' },
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

const ruweStaat = async () => await (await fetch(base + '/api/state')).text();
const staat = async () => JSON.parse(await ruweStaat()) as any;

describe('het instellingenscherm', () => {
  it('stuurt de token en het client secret niet mee', async () => {
    const ruw = await ruweStaat();

    expect(ruw).not.toContain(TOKEN);
    expect(ruw).not.toContain(SECRET);
    expect(JSON.stringify((await staat()).instellingen)).not.toMatch(/token|secret/i);
  });

  it('zegt waar hij luistert en met welk adres', async () => {
    const { instellingen } = await staat();

    expect(instellingen.host).toBe('127.0.0.1');
    expect(instellingen.dashboardUrl).toMatch(/^http/);
    expect(instellingen.clientId).toBe('123456789');
  });

  it('laat de lijst met toegestane servers zien', async () => {
    const { instellingen } = await staat();
    expect(instellingen.toegestaneServers).toEqual(['111', '222']);
  });

  it('noemt de mappen waar hij in schrijft', async () => {
    const { instellingen } = await staat();

    expect(instellingen.mappen.templates).toBe(werkmap);
    expect(instellingen.mappen.backups).toContain('backups');
    expect(instellingen.mappen.history).toContain('history');
  });

  it('laat het inlogadres weg zolang inloggen uitstaat', async () => {
    const { instellingen } = await staat();

    expect(instellingen.inloggen).toBe(false);
    expect(instellingen.redirectUri).toBeNull();
  });
});
