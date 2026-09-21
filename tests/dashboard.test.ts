import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

// config.ts leest de omgeving bij het importeren, dus die moet eerst staan.
const templatesDir = mkdtempSync(path.join(tmpdir(), 'setup-bot-'));
copyFileSync('./templates/community.json', path.join(templatesDir, 'community.json'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = templatesDir;
process.env.HISTORY_DIR = path.join(templatesDir, 'history');
process.env.BACKUPS_DIR = path.join(templatesDir, 'backups');

const { createDashboard } = await import('../src/dashboard/server.js');

/** Minimale namaak van wat de dashboard-server van een guild gebruikt. */
function stubGuild(botPermissions: bigint) {
  const everyone = {
    id: 'guild-1',
    name: '@everyone',
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: new PermissionsBitField(0n),
    position: 0,
    managed: false,
  };

  return {
    id: 'guild-1',
    name: 'Testserver',
    memberCount: 12,
    iconURL: () => null,
    description: null,
    features: [] as string[],
    systemChannelId: null,
    afkChannelId: null,
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    roles: { cache: new Collection([['guild-1', everyone]]) },
    channels: { cache: new Collection() },
    emojis: { cache: new Collection() },
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection() },
    verificationLevel: 0,
    explicitContentFilter: 0,
    defaultMessageNotifications: 0,
    afkTimeout: 300,
    fetchOnboarding: async () => ({
      enabled: false,
      mode: 0,
      defaultChannels: new Collection(),
      prompts: new Collection(),
    }),
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(botPermissions),
        roles: { highest: { position: 9 } },
      }),
    },
  };
}

function stubClient(guild: ReturnType<typeof stubGuild>) {
  return {
    user: { username: 'Setup Bot', id: '123456789', displayAvatarURL: () => 'https://example.invalid/a.png' },
    guilds: { cache: new Collection([[guild.id, guild]]) },
  } as unknown as Client<true>;
}

const fullRights =
  PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageGuild;

let server: Server;
let base: string;

function listen(client: Client<true>): Promise<void> {
  server = createDashboard(client);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
}

beforeAll(() => listen(stubClient(stubGuild(fullRights))));

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(templatesDir, { recursive: true, force: true });
});

/** fetch geeft unknown terug; deze helper houdt de tests leesbaar. */
type Json = Record<string, any>;
const json = async <T extends Json = Json>(response: Response): Promise<T> => (await response.json()) as T;

const get = (path: string) => fetch(base + path);
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('dashboard-api', () => {
  it('serveert de pagina', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<title>Setup Bot');
  });

  it('serveert de scriptbestanden naast de pagina', async () => {
    for (const name of ['app.js', 'editor.js', 'ui.js']) {
      const response = await get('/' + name);
      expect(response.status, name).toBe(200);
      expect(response.headers.get('content-type')).toContain('javascript');
    }
    expect((await get('/../package.json')).status).not.toBe(200);
  });

  it('geeft de permissielijst mee voor de editor', async () => {
    const state = await json(await get('/api/state'));
    expect(state.permissions.length).toBeGreaterThan(40);
    expect(state.permissions.find((p: { name: string }) => p.name === 'ViewChannel')).toMatchObject({
      label: 'View Channel',
      group: 'Algemeen',
      common: true,
    });
  });

  it('geeft servers en templates terug', async () => {
    const state = await json(await get('/api/state'));
    expect(state.botName).toBe('Setup Bot');
    expect(state.guilds[0]).toMatchObject({ name: 'Testserver', missing: [], memberCount: 12 });
    expect(state.templates.map((template: { id: string }) => template.id)).toContain('community');
  });

  it('leest een template uit', async () => {
    const data = await json(await get('/api/templates/community'));
    expect(data.template.name).toBe('Community');
    expect(JSON.parse(data.json).roles.length).toBeGreaterThan(0);
  });

  it('weigert een template met een onbekende permissie', async () => {
    const broken = JSON.stringify({ name: 'Stuk', roles: [{ key: 'a', name: 'A', permissions: ['Nonsense'] }] });
    const response = await fetch(base + '/api/templates/community', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: broken }),
    });

    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/Onbekende permissie/);

    // het bestand op schijf mag niet aangeraakt zijn
    const unchanged = await json(await get('/api/templates/community'));
    expect(unchanged.template.name).toBe('Community');
  });

  it('maakt en verwijdert een template', async () => {
    const created = await json(await post('/api/templates', { id: 'Nieuwe Template' }));
    expect(created.id).toBe('nieuwe-template');
    expect(existsSync(path.join(templatesDir, 'nieuwe-template.json'))).toBe(true);

    const duplicate = await post('/api/templates', { id: 'nieuwe-template' });
    expect(duplicate.status).toBe(400);

    await fetch(base + '/api/templates/nieuwe-template', { method: 'DELETE' });
    expect(existsSync(path.join(templatesDir, 'nieuwe-template.json'))).toBe(false);
  });

  it('plant zonder iets te wijzigen', async () => {
    const plan = await json(await post('/api/plan', { templateId: 'community', guildId: 'guild-1' }));
    expect(plan.count).toBeGreaterThan(0);
    expect(plan.actions[0]).toMatch(/^\+ rol/);
    expect(plan.summary).toContain('aanmaken');
  });

  it('plant voor meerdere servers tegelijk', async () => {
    const data = await json(await post('/api/plan', { templateId: 'community', guildIds: ['guild-1', 'onbekend'] }));
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0].guildName).toBe('Testserver');
  });

  it('bewaart de vorige inhoud bij het opslaan', async () => {
    const before = await json(await get('/api/templates/community'));
    const edited = JSON.parse(before.json);
    edited.description = 'aangepast in een test';

    await fetch(base + '/api/templates/community', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: JSON.stringify(edited) }),
    });

    const versions = await json(await get('/api/templates/community/versions'));
    expect(versions.versions.length).toBeGreaterThan(0);

    const restored = await json(
      await post('/api/templates/community/restore', { stamp: versions.versions[0].stamp }),
    );
    expect(JSON.parse(restored.json).description).toBe(JSON.parse(before.json).description);
  });

  it('legt de template naast de server', async () => {
    const template = await json(await get('/api/templates/community'));
    const data = await json(await post('/api/compare', { json: template.json, guildId: 'guild-1' }));

    expect(data.guildName).toBe('Testserver');
    expect(data.counts.new).toBeGreaterThan(0);
    expect(data.counts.same).toBe(0);
    expect(data.categories[0].channels[0]).toMatchObject({ status: 'new' });
  });

  it('weigert vergelijken zonder server', async () => {
    const response = await post('/api/compare', { json: '{"name":"X"}' });
    expect(response.status).toBe(404);
  });

  it('exporteert een bestaande server', async () => {
    const exported = await json(await get('/api/export/guild-1'));
    expect(exported.id).toBe('testserver');
    expect(JSON.parse(exported.json).name).toBe('Testserver');
  });

  it('kent onbekende paden niet', async () => {
    expect((await get('/api/onzin')).status).toBe(404);
    expect((await post('/api/plan', { templateId: 'community' })).status).toBe(400);
  });
});

describe('dashboard-api zonder rechten', () => {
  it('weigert toepassen als de bot rechten mist', async () => {
    await new Promise((resolve) => server.close(resolve));
    await listen(stubClient(stubGuild(0n)));

    const response = await post('/api/apply', { templateId: 'community', guildId: 'guild-1' });
    expect(response.status).toBe(200);

    // Een server zonder rechten laat de rest van de rij niet klappen; hij komt
    // terug als mislukt met de reden erbij.
    const data = await json(response);
    expect(data.results[0].errors[0]).toMatch(/mist rechten/);
    expect(data.applied).toBe(0);
  });
});
