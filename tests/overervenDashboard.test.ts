import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

/**
 * Een template met een basis in het dashboard: wat je ziet is de basis plus het
 * verschil, maar wat er opgeslagen wordt blijft het verschil. Zou dat niet zo
 * zijn, dan schrijft de eerste keer opslaan de basis er stilletjes uit.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-overerven-'));
mkdirSync(path.join(werkmap, 'history'), { recursive: true });

writeFileSync(
  path.join(werkmap, 'basis.json'),
  JSON.stringify({
    name: 'Basis',
    description: 'De gedeelde opzet',
    roles: [{ key: 'team', name: 'Team' }],
    categories: [],
    uncategorizedChannels: [{ name: 'welkom', type: 'text' }],
  }),
);

writeFileSync(
  path.join(werkmap, 'variant.json'),
  JSON.stringify({ basis: 'basis', name: 'Variant', roles: [{ key: 'gast', name: 'Gast' }] }),
);

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.DEMO = '';
delete process.env.GUILD_IDS;

const { createDashboard } = await import('../src/dashboard/server.js');

function stubGuild() {
  const kanaal = (id: string, name: string) => ({
    id, name, type: ChannelType.GuildText, parentId: null, rawPosition: 0, topic: null,
    nsfw: false, rateLimitPerUser: 0, permissionOverwrites: { cache: new Collection() },
    isThread: () => false,
  });

  const everyone = {
    id: 'g1', name: '@everyone', color: 0, hoist: false, mentionable: false,
    permissions: new PermissionsBitField(0n), position: 0, rawPosition: 0, managed: false,
  };

  return {
    id: 'g1',
    name: 'Testserver',
    memberCount: 3,
    iconURL: () => null,
    description: null,
    features: [] as string[],
    systemChannelId: null,
    afkChannelId: null,
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    verificationLevel: 2,
    explicitContentFilter: 0,
    defaultMessageNotifications: 1,
    afkTimeout: 900,
    fetchOnboarding: async () => ({
      enabled: false, mode: 0, defaultChannels: new Collection(), prompts: new Collection(),
    }),
    roles: { cache: new Collection([['g1', everyone]]), fetch: async () => new Collection([['g1', everyone]]) },
    channels: {
      cache: new Collection([
        ['a', kanaal('a', 'welkom')],
        // Met de hand toegevoegd in Discord: precies wat je wil overnemen.
        ['b', kanaal('b', 'memes')],
      ]),
    },
    emojis: { cache: new Collection() },
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection() },
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
        roles: { highest: { position: 9 } },
      }),
    },
  };
}

const client = {
  user: { username: 'Setup Bot', id: '1', displayAvatarURL: () => '' },
  guilds: { cache: new Collection([['g1', stubGuild()]]) },
} as unknown as Client<true>;

let server: Server;
let base: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createDashboard(client);
      server.listen(0, '127.0.0.1', () => {
        const adres = server.address();
        base = `http://127.0.0.1:${typeof adres === 'object' && adres ? adres.port : 0}`;
        resolve();
      });
    }),
);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(werkmap, { recursive: true, force: true });
});

const overnemen = async (body: Record<string, unknown>) => {
  const response = await fetch(base + '/api/templates/mijn/overnemen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as Record<string, any> };
};

const opSchijf = () => JSON.parse(readFileSync(path.join(werkmap, 'mijn.json'), 'utf8'));

const lees = (id: string) => JSON.parse(readFileSync(path.join(werkmap, `${id}.json`), 'utf8'));

const haal = async (pad: string, opties?: RequestInit) => {
  const response = await fetch(base + '/api' + pad, opties);
  return { status: response.status, data: (await response.json()) as Record<string, any> };
};

describe('een template met een basis', () => {
  it('laat het bestand zien én waar het op uitkomt', async () => {
    const { data } = await haal('/templates/variant');

    expect(data.basis).toBe('basis');
    expect(JSON.parse(data.json).roles).toHaveLength(1);
    expect(data.template.roles.map((rol: { key: string }) => rol.key)).toEqual(['team', 'gast']);
    expect(data.template.name).toBe('Variant');
  });

  it('noemt de basis in het overzicht', async () => {
    const { data } = await haal('/templates');
    const variant = data.templates.find((template: { id: string }) => template.id === 'variant');
    expect(variant.basis).toBe('basis');
    expect(variant.roles).toBe(2);
  });

  it('bewaart de basis bij het opslaan', async () => {
    const json = JSON.stringify({ basis: 'basis', name: 'Variant', roles: [{ key: 'gast', name: 'Gast erbij' }] });
    const { status } = await haal('/templates/variant', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json }),
    });

    expect(status).toBe(200);
    expect(lees('variant').basis).toBe('basis');
    expect(lees('variant').roles).toHaveLength(1);
  });

  it('weigert JSON die alleen mét de basis klopt niet', async () => {
    // Een overwrite naar een rol die alleen in de basis staat, hoort gewoon te mogen.
    const json = JSON.stringify({
      basis: 'basis',
      name: 'Variant',
      uncategorizedChannels: [{ name: 'team-overleg', overwrites: [{ role: 'team', allow: ['ViewChannel'] }] }],
    });
    const { status, data } = await haal('/templates/variant', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json }),
    });

    expect(status).toBe(200);
    expect(data.template.uncategorizedChannels).toHaveLength(2);
  });

  it('maakt een variant op een bestaande template', async () => {
    const { status, data } = await haal('/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'nieuw', from: 'basis', variant: true }),
    });

    expect(status).toBe(200);
    expect(JSON.parse(data.json)).toEqual({ basis: 'basis', name: 'nieuw' });
  });

  it('haalt de basis niet weg zolang er iets op voortbouwt', async () => {
    const { status, data } = await haal('/templates/basis', { method: 'DELETE' });

    expect(status).toBe(400);
    expect(data.error).toContain('variant');
    expect(lees('basis').name).toBe('Basis');
  });

  it('neemt een server over zonder de basis eruit te schrijven', async () => {
    const { status, data } = await haal('/templates/variant/overnemen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guildId: 'g1', toepassen: true }),
    });

    expect(data.error).toBeUndefined();
    expect(status).toBe(200);
    expect(data.saved).toBe(true);

    const opSchijf = lees('variant');
    expect(opSchijf.basis).toBe('basis');
    // Het kanaal dat met de hand in Discord is aangemaakt staat er nu bij, en
    // wat uit de basis komt staat er juist niet nog een keer in.
    const namen = opSchijf.uncategorizedChannels.map((kanaal: { name: string }) => kanaal.name);
    expect(namen).toContain('memes');
    expect(namen).not.toContain('welkom');

    const { data: na } = await haal('/templates/variant');
    expect(na.template.uncategorizedChannels.map((kanaal: { name: string }) => kanaal.name)).toEqual([
      'welkom',
      'memes',
    ]);
  });
});
