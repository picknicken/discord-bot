import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Client } from 'discord.js';

/**
 * Leeghalen vanuit het dashboard. Dit is het enige scherm dat dingen weggooit,
 * dus de vraag is niet alleen of het werkt maar vooral of het weigert wanneer
 * het hoort te weigeren.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-leeg-'));
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
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

type Json = Record<string, any>;
const reset = (body: unknown) =>
  fetch(base + '/api/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const json = async <T extends Json = Json>(response: Response): Promise<T> => (await response.json()) as T;

describe('leeghalen vanuit het dashboard', () => {
  it('laat zonder bevestiging alleen zien wat er weg zou gaan', async () => {
    const data = await json(await reset({ guildId: '1' }));

    expect(data.guildName).toBe('Picknicken Community');
    expect(data.totaal).toBeGreaterThan(0);
    expect(data.counts.kanalen).toBeGreaterThan(0);
    expect(data.acties.join(' ')).toMatch(/welkom/);
  });

  it('laat rollen staan die je wilt behouden', async () => {
    const alles = await json(await reset({ guildId: '1' }));
    const gespaard = await json(await reset({ guildId: '1', scope: { behoudRollen: ['Lid'] } }));

    expect(gespaard.counts.rollen).toBe(alles.counts.rollen - 1);
    expect(gespaard.overgeslagen.join(' ')).toMatch(/Lid/);
  });

  it('haalt alleen weg wat is aangevinkt', async () => {
    const data = await json(await reset({ guildId: '1', scope: { rollen: false, automod: false } }));

    expect(data.counts.rollen).toBe(0);
    expect(data.counts.automod).toBe(0);
    expect(data.counts.kanalen).toBeGreaterThan(0);
  });

  it('weigert een opdracht waarin niets is aangevinkt', async () => {
    const response = await reset({ guildId: '1', scope: { rollen: false, kanalen: false, automod: false } });

    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/niets aangevinkt/);
  });

  it('weigert een bevestiging die niet exact klopt', async () => {
    for (const bevestig of ['picknicken community', 'Picknicken', '']) {
      const response = await reset({ guildId: '1', bevestig });
      expect(response.status, bevestig).toBe(400);
      expect((await json(response)).error).toMatch(/bevestiging klopt niet/);
    }
  });

  it('verwijdert niets in demo-modus, ook niet met de juiste naam', async () => {
    const data = await json(await reset({ guildId: '1', bevestig: 'Picknicken Community' }));

    expect(data.deleted).toBe(0);
    expect(data.note).toMatch(/demo/);
  });

  it('weigert een server die niet bestaat', async () => {
    expect((await reset({ guildId: 'bestaat-niet' })).status).toBe(404);
    expect((await reset({})).status).toBe(400);
  });

  it('heeft niets te doen in een server die al leeg is', async () => {
    const data = await json(await reset({ guildId: '3', bevestig: 'Test Server' }));
    expect(data.note).toMatch(/niets te verwijderen/);
  });
});

describe('rollen vanuit het dashboard', () => {
  it('laat de rollen van een server zien, met wat vastzit', async () => {
    const data = await json(await fetch(base + '/api/rollen/2'));
    const namen = data.rollen.map((rol: Json) => rol.name);

    expect(namen).toContain('Lid');
    expect(data.rollen.find((rol: Json) => rol.name === 'Een andere bot').vast).toMatch(/integratie/);
  });

  it('stuurt in demo-modus niets naar Discord', async () => {
    const response = await fetch(base + '/api/rollen/2/r1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Leden' }),
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/demo/);
  });

  it('weigert een server die niet bestaat', async () => {
    expect((await fetch(base + '/api/rollen/bestaat-niet')).status).toBe(404);
  });
});

describe('botidentiteit vanuit het dashboard', () => {
  it('geeft de standaardwaarden zonder eigen instelling', async () => {
    const data = await json(await fetch(base + '/api/identiteit/2'));
    expect(data).toMatchObject({ naam: null, heeftAvatar: false });
    expect(data.standaardNaam).toBe('Setup Bot');
  });

  it('weigert opslaan in demo-modus', async () => {
    const response = await fetch(base + '/api/identiteit/2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ naam: 'Clanbot' }),
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/demo/);
  });

  it('weigert een ongeldig plaatje met een duidelijke reden', async () => {
    // Demo-modus stopt PUT altijd voordat Discord wordt aangeraakt, dus dit
    // toetst alleen de foutmelding van de server, niet dat er iets bewaard blijft.
    const response = await fetch(base + '/api/identiteit/2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarDataUrl: 'geen-data-url' }),
    });
    expect(response.status).toBe(400);
  });

  it('weigert een server die niet bestaat', async () => {
    expect((await fetch(base + '/api/identiteit/bestaat-niet')).status).toBe(404);
  });
});
