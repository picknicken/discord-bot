import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

/**
 * De andere kant op. Tot nu toe kon je de template alleen naar de server duwen;
 * is de afwijking juist bedoeld, dan moest je met de hand JSON bijwerken.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-overnemen-'));
mkdirSync(path.join(werkmap, 'history'), { recursive: true });

writeFileSync(
  path.join(werkmap, 'mijn.json'),
  JSON.stringify({
    name: 'Mijn template',
    description: 'Met de hand geschreven',
    roles: [],
    categories: [],
    uncategorizedChannels: [{ name: 'welkom', type: 'text' }],
  }),
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

describe('een server overnemen in zijn template', () => {
  it('laat eerst zien wat er zou veranderen, zonder iets te schrijven', async () => {
    const { status, data } = await overnemen({ guildId: 'g1' });

    expect(status).toBe(200);
    expect(data.samenvatting).toContain('kanaal');
    expect(data.saved).toBeUndefined();
    expect(opSchijf().uncategorizedChannels).toHaveLength(1);
  });

  it('houdt de naam, de uitleg en de variabelen van de template', async () => {
    const { data } = await overnemen({ guildId: 'g1' });
    const nieuw = JSON.parse(data.json);

    expect(nieuw.name).toBe('Mijn template');
    expect(nieuw.description).toBe('Met de hand geschreven');
    // En wat alleen uit de server komt gaat wél mee.
    expect(nieuw.guild.verificationLevel).toBe('medium');
    expect(nieuw.guild.afkTimeoutSeconds).toBe(900);
  });

  it('schrijft het pas met toepassen, en bewaart de oude versie', async () => {
    const { data } = await overnemen({ guildId: 'g1', toepassen: true });

    expect(data.saved).toBe(true);
    expect(opSchijf().uncategorizedChannels.map((k: { name: string }) => k.name)).toContain('memes');

    const versies = (await (await fetch(base + '/api/templates/mijn/versions')).json()) as {
      versions: { stamp: string }[];
    };
    expect(versies.versions.length).toBeGreaterThan(0);
  });

  it('weigert een server die niet bestaat', async () => {
    expect((await overnemen({ guildId: 'weg' })).status).toBe(404);
  });
});
