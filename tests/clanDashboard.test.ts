import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

// config.ts leest de omgeving bij het importeren, dus die moet eerst staan.
const werkmap = mkdtempSync(path.join(tmpdir(), 'clan-dashboard-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = path.join(werkmap, 'templates');
process.env.HISTORY_DIR = path.join(werkmap, 'history');
process.env.BACKUPS_DIR = path.join(werkmap, 'backups');
process.env.CLAN_DIR = path.join(werkmap, 'clan');

const { createDashboard } = await import('../src/dashboard/server.js');
const { haalLedenlijst, leegClanCache } = await import('../src/clan/runescape.js');

const GUILD_ID = '987654321';

/** De ledenlijst die "Jagex" teruggeeft; komt via de cache binnen, niet via het net. */
const CSV =
  'Clanmate, Clan Rank, Total XP, Kills\n' +
  'Sparc Mac, Owner, 1200000000, 42\n' +
  'Tess, Captain, 640000000, 12\n';

const rol = (id: string, name: string, position: number, managed = false) => ({
  id,
  name,
  position,
  managed,
});

/** Onthoudt wat de bot met de rollen van dit lid zou doen. */
const gedaan: Array<{ wat: string; rollen: string[] }> = [];

function stubMember(id: string, rollen: string[]) {
  return {
    id,
    user: { username: 'lid' + id, globalName: null },
    nickname: null,
    manageable: true,
    roles: {
      cache: new Collection(rollen.map((each) => [each, { id: each }])),
      add: async (ids: string[]) => gedaan.push({ wat: 'erbij', rollen: ids }),
      remove: async (ids: string[]) => gedaan.push({ wat: 'eraf', rollen: ids }),
    },
    setNickname: async () => undefined,
  };
}

const leden = new Collection<string, ReturnType<typeof stubMember>>([
  ['111111111', stubMember('111111111', ['role-corporal'])],
]);

function stubGuild() {
  return {
    id: GUILD_ID,
    name: 'Clanserver',
    memberCount: 40,
    iconURL: () => null,
    features: [] as string[],
    roles: {
      cache: new Collection([
        [GUILD_ID, rol(GUILD_ID, '@everyone', 0)],
        ['role-owner', rol('role-owner', 'Owner', 12)],
        ['role-captain', rol('role-captain', 'Captain', 3)],
        ['role-corporal', rol('role-corporal', 'Corporal', 2)],
      ]),
    },
    channels: { cache: new Collection() },
    emojis: { cache: new Collection() },
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageGuild),
        roles: { highest: { position: 9 } },
      }),
      fetch: async (wat: string | { user: string[] }) => {
        if (typeof wat === 'string') {
          const lid = leden.get(wat);
          if (!lid) throw new Error('Unknown Member');
          return lid;
        }
        return leden.filter((_, id) => wat.user.includes(id));
      },
    },
  };
}

const guild = stubGuild();

const client = {
  user: { username: 'Setup Bot', id: '123456789', displayAvatarURL: () => 'https://example.invalid/a.png' },
  guilds: { cache: new Collection([[guild.id, guild]]) },
} as unknown as Client<true>;

let server: Server;
let base: string;

beforeAll(async () => {
  server = createDashboard(client);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(werkmap, { recursive: true, force: true });
});

beforeEach(() => {
  gedaan.length = 0;
});

type Json = Record<string, any>;
const json = async (response: Response): Promise<Json> => (await response.json()) as Json;

const get = (pad: string) => fetch(base + pad);
const stuur = (pad: string, methode: string, body: unknown) =>
  fetch(base + pad, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('clan-api van het dashboard', () => {
  it('geeft de rangen, de rollen en een leeg begin terug', async () => {
    const data = await json(await get(`/api/clan/${GUILD_ID}`));

    expect(data.rangen).toContain('Corporal');
    expect(data.instellingen).toMatchObject({ clan: '', rangRollen: {} });
    expect(data.rollen.map((each: Json) => each.naam)).toEqual(['Captain', 'Corporal', 'Owner']);
    expect(data.magRollen).toBe(true);
  });

  it('laat zien welke rol de bot niet kan uitdelen', async () => {
    const data = await json(await get(`/api/clan/${GUILD_ID}`));
    // Owner staat op 12, de bot zelf op 9.
    expect(data.rollen.find((each: Json) => each.naam === 'Owner').beheerbaar).toBe(false);
    expect(data.rollen.find((each: Json) => each.naam === 'Captain').beheerbaar).toBe(true);
  });

  it('stelt op naam een rol per rang voor', async () => {
    const data = await json(await get(`/api/clan/${GUILD_ID}`));
    expect(data.voorstel).toMatchObject({ Captain: 'role-captain', Corporal: 'role-corporal' });
  });

  it('bewaart de instellingen', async () => {
    const opgeslagen = await json(
      await stuur(`/api/clan/${GUILD_ID}`, 'PUT', {
        instellingen: {
          clan: 'Bloody Mayhem',
          rangRollen: { Owner: 'role-owner', Captain: 'role-captain', Corporal: 'role-corporal' },
        },
      }),
    );

    expect(opgeslagen.saved).toBe(true);
    expect((await json(await get(`/api/clan/${GUILD_ID}`))).instellingen.clan).toBe('Bloody Mayhem');
  });

  it('weigert een rang die niet bestaat', async () => {
    const antwoord = await stuur(`/api/clan/${GUILD_ID}`, 'PUT', {
      instellingen: { clan: 'Bloody Mayhem', rangRollen: { Zeemeermin: 'role-captain' } },
    });

    expect(antwoord.status).toBe(400);
    expect((await json(antwoord)).error).toMatch(/Zeemeermin/);
  });

  it('koppelt een lid en weigert dezelfde naam twee keer', async () => {
    const eerste = await json(
      await stuur(`/api/clan/${GUILD_ID}/koppel`, 'POST', { discordId: '111111111', rsn: 'Tess' }),
    );
    expect(eerste.koppelingen).toHaveLength(1);
    expect(eerste.koppelingen[0]).toMatchObject({ rsn: 'Tess', inServer: true });

    const tweede = await stuur(`/api/clan/${GUILD_ID}/koppel`, 'POST', { discordId: '222222222', rsn: 'tess' });
    expect(tweede.status).toBe(400);
  });

  it('weigert een gebruikers-id dat geen id is', async () => {
    const antwoord = await stuur(`/api/clan/${GUILD_ID}/koppel`, 'POST', { discordId: '../oeps', rsn: 'Noa' });
    expect(antwoord.status).toBe(400);
  });

  it('maakt een plan van wie welke rol krijgt', async () => {
    leegClanCache();
    // De ledenlijst komt uit de cache; de route zelf praat dus niet met Jagex.
    await haalLedenlijst('Bloody Mayhem', {
      fetcher: (async () => new Response(CSV)) as unknown as typeof fetch,
    });

    const data = await json(await stuur(`/api/clan/${GUILD_ID}/plan`, 'POST', {}));

    expect(data.ledenlijst).toMatchObject({ clan: 'Bloody Mayhem', aantal: 2 });
    expect(data.plan.wissels[0]).toMatchObject({
      rsn: 'Tess',
      rang: 'Captain',
      erbij: ['role-captain'],
      eraf: ['role-corporal'],
    });
    expect(data.plan.ongekoppeld.map((each: Json) => each.naam)).toEqual(['Sparc Mac']);
    // Een plan verandert nog niets.
    expect(gedaan).toEqual([]);
  });

  it('deelt de rollen pas uit bij het bijwerken', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/sync`, 'POST', {}));

    expect(data.aangepast).toBe(1);
    expect(data.mislukt).toBe(0);
    expect(gedaan).toEqual([
      { wat: 'erbij', rollen: ['role-captain'] },
      { wat: 'eraf', rollen: ['role-corporal'] },
    ]);

    // En onthoudt wat er bij Jagex stond, zodat het scherm dat kan tonen.
    const na = await json(await get(`/api/clan/${GUILD_ID}`));
    expect(na.koppelingen[0]).toMatchObject({ rsn: 'Tess', rang: 'Captain' });
    expect(na.laatsteSync).not.toBeNull();
  });

  it('ontkoppelt weer', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/ontkoppel`, 'POST', { discordId: '111111111' }));
    expect(data.koppelingen).toEqual([]);
  });

  it('zegt het als er nog geen clan is ingesteld', async () => {
    await stuur(`/api/clan/${GUILD_ID}`, 'PUT', { instellingen: {} });

    const antwoord = await stuur(`/api/clan/${GUILD_ID}/plan`, 'POST', {});
    expect(antwoord.status).toBe(400);
    expect((await json(antwoord)).error).toMatch(/nog geen clan/);
  });

  it('kent een server niet die er niet is', async () => {
    expect((await get('/api/clan/555555555')).status).toBe(404);
  });
});
