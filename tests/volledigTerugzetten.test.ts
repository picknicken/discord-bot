import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

/**
 * Terugzetten vulde alleen aan: wat er na de back-up bij kwam bleef staan, dus
 * "teruggezet" betekende niet "weer zoals toen". Nu kan het allebei, en dat
 * verschil moet ook echt in de server te zien zijn.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-terug-'));
const backupsDir = path.join(werkmap, 'backups');
mkdirSync(backupsDir, { recursive: true });

writeFileSync(
  path.join(backupsDir, 'toen.json'),
  JSON.stringify({
    guildId: 'g1',
    guildName: 'Testserver',
    createdAt: '2026-09-20T10:00:00.000Z',
    template: {
      name: 'Testserver',
      roles: [],
      categories: [],
      uncategorizedChannels: [{ name: 'blijft', type: 'text' }],
    },
  }),
);

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = werkmap;
process.env.BACKUPS_DIR = backupsDir;
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.DEMO = '';
delete process.env.GUILD_IDS;

const { createDashboard } = await import('../src/dashboard/server.js');

const verwijderd: string[] = [];

function stubGuild() {
  const kanaal = (id: string, name: string) => ({
    id,
    name,
    type: ChannelType.GuildText,
    parentId: null,
    rawPosition: 0,
    topic: null,
    nsfw: false,
    rateLimitPerUser: 0,
    permissionOverwrites: { cache: new Collection() },
    isThread: () => false,
  });

  const kanalen = new Collection([
    ['blijft', kanaal('blijft', 'blijft')],
    // Na de back-up bij gekomen.
    ['nieuw', kanaal('nieuw', 'erbij-gekomen')],
  ]);

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
    verificationLevel: 0,
    explicitContentFilter: 0,
    defaultMessageNotifications: 0,
    afkTimeout: 300,
    fetchOnboarding: async () => ({
      enabled: false, mode: 0, defaultChannels: new Collection(), prompts: new Collection(),
    }),
    roles: { cache: new Collection([['g1', everyone]]), fetch: async () => new Collection([['g1', everyone]]) },
    channels: {
      cache: kanalen,
      fetch: async (id?: string) => {
        if (!id) return kanalen;
        const gevonden = kanalen.get(id);
        if (!gevonden) return null;
        return { ...gevonden, delete: async () => { verwijderd.push(id); kanalen.delete(id); } };
      },
      create: async ({ name }: { name: string }) => kanaal('gemaakt-' + name, name),
      setPositions: async () => undefined,
    },
    emojis: { cache: new Collection() },
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection() },
    members: {
      fetchMe: async () => ({
        id: 'bot',
        roles: { botRole: { id: 'botrol' }, highest: { position: 9, rawPosition: 9 } },
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
      }),
    },
    edit: async () => stub,
  };
}

const stub = stubGuild();

const client = {
  user: { username: 'Setup Bot', id: '1', displayAvatarURL: () => '' },
  guilds: { cache: new Collection([['g1', stub]]) },
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

const terug = (body: Record<string, unknown>) =>
  fetch(base + '/api/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('een back-up volledig terugzetten', () => {
  it('laat zonder "volledig" staan wat erbij is gekomen', async () => {
    const response = await terug({ file: 'toen.json' });

    expect(response.status).toBe(200);
    expect(verwijderd).toEqual([]);
  });

  it('haalt met "volledig" weg wat niet in de back-up stond', async () => {
    const response = await terug({ file: 'toen.json', volledig: true });
    const uitkomst = (await response.json()) as { volledig: boolean; backup: string | null };

    expect(response.status).toBe(200);
    expect(uitkomst.volledig).toBe(true);
    expect(verwijderd).toEqual(['nieuw']);
    // Je gooit hier dingen weg, dus er hoort eerst een momentopname gemaakt te zijn.
    expect(uitkomst.backup).toBeTruthy();
  });
});
