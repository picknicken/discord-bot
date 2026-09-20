import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { leegClanCache } = await import('../src/clan/wiseoldman.js');

const GUILD_ID = '987654321';
const GROUP_ID = 139;

/** Wat "WiseOldMan" hier teruggeeft; er gaat geen verzoek het internet op. */
const GROEP = {
  id: GROUP_ID,
  name: 'Mijn Clan',
  clanChat: 'mijnclan',
  memberships: [
    { role: 'captain', player: { username: 'tess', displayName: 'Tess' } },
    { role: 'owner', player: { username: 'sparc mac', displayName: 'Sparc Mac' } },
  ],
};

/**
 * Alleen verzoeken naar WiseOldMan worden onderschept; die naar het dashboard
 * zelf (waar deze test op klopt) gaan gewoon door.
 */
const echteFetch = globalThis.fetch;
let womVerzoeken: string[] = [];

vi.stubGlobal('fetch', (async (invoer: Parameters<typeof fetch>[0], opties?: Parameters<typeof fetch>[1]) => {
  const url = String(invoer);
  if (!url.startsWith('https://api.wiseoldman.net')) return echteFetch(invoer, opties);

  womVerzoeken.push(url);
  const antwoord = (waarde: unknown) =>
    new Response(JSON.stringify(waarde), { headers: { 'content-type': 'application/json' } });

  if (url.includes('/groups?')) return antwoord([{ id: GROUP_ID, name: 'Mijn Clan', memberCount: 2, clanChat: 'mijnclan' }]);
  if (url.includes(`/groups/${GROUP_ID}`)) return antwoord(GROEP);
  return new Response('{}', { status: 404 });
}) as typeof fetch);

const rol = (id: string, name: string, position: number, managed = false) => ({ id, name, position, managed });

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

// Dit lid heeft twee rollen die hij niet hoort te hebben: @Owner is aan een
// rang gekoppeld en moet er dus af, @Corporal is dat niet en moet blijven.
const leden = new Collection<string, ReturnType<typeof stubMember>>([
  ['111111111', stubMember('111111111', ['role-owner', 'role-corporal'])],
]);

const guild = {
  id: GUILD_ID,
  name: 'Clanserver',
  memberCount: 40,
  iconURL: () => null,
  features: [] as string[],
  roles: {
    cache: new Collection([
      [GUILD_ID, rol(GUILD_ID, '@everyone', 0)],
      ['role-owner', rol('role-owner', 'Owner', 5)],
      // Staat boven de bot (die zit op 9): die kan hij dus niet uitdelen.
      ['role-hoog', rol('role-hoog', 'Leiding', 12)],
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
  vi.unstubAllGlobals();
  rmSync(werkmap, { recursive: true, force: true });
});

beforeEach(() => {
  gedaan.length = 0;
  womVerzoeken = [];
});

type Json = Record<string, any>;
const json = async (response: Response): Promise<Json> => (await response.json()) as Json;

const get = (pad: string) => echteFetch(base + pad);
const stuur = (pad: string, methode: string, body: unknown) =>
  echteFetch(base + pad, {
    method: methode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('clan-api van het dashboard', () => {
  it('begint leeg, met de rollen van de server erbij', async () => {
    const data = await json(await get(`/api/clan/${GUILD_ID}`));

    expect(data.instellingen.clans).toEqual([]);
    expect(data.clans).toEqual([]);
    expect(data.rollen.map((each: Json) => each.naam)).toEqual(['Captain', 'Corporal', 'Leiding', 'Owner']);
    expect(data.magRollen).toBe(true);
    // Zonder gekozen clan hoeft er niets bij WiseOldMan opgehaald te worden.
    expect(womVerzoeken).toEqual([]);
  });

  it('laat zien welke rol de bot niet kan uitdelen', async () => {
    const data = await json(await get(`/api/clan/${GUILD_ID}`));
    // Leiding staat op 12, de bot zelf op 9.
    expect(data.rollen.find((each: Json) => each.naam === 'Leiding').beheerbaar).toBe(false);
    expect(data.rollen.find((each: Json) => each.naam === 'Captain').beheerbaar).toBe(true);
  });

  it('zoekt clans op naam bij WiseOldMan', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/zoek`, 'POST', { naam: 'mijn' }));

    expect(data.gevonden[0]).toMatchObject({ id: GROUP_ID, naam: 'Mijn Clan', aantal: 2 });
    expect(womVerzoeken[0]).toContain('/groups?name=mijn');
  });

  it('laat een clan meetellen en haalt zijn rangen op', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/toevoegen`, 'POST', { groupId: GROUP_ID }));

    expect(data.instellingen.clans).toHaveLength(1);
    expect(data.clans[0]).toMatchObject({ groupId: GROUP_ID, naam: 'Mijn Clan', aantal: 2 });
    // De rangen komen uit de ledenlijst zelf, niet uit een vaste lijst.
    expect(data.clans[0].rangen.map((each: Json) => each.rang).sort()).toEqual(['captain', 'owner']);
    expect(data.clans[0].rangen[0].naam).toMatch(/^[A-Z]/);
  });

  it('weigert dezelfde clan twee keer', async () => {
    const antwoord = await stuur(`/api/clan/${GUILD_ID}/toevoegen`, 'POST', { groupId: GROUP_ID });
    expect(antwoord.status).toBe(400);
    expect((await json(antwoord)).error).toMatch(/telt al mee/);
  });

  it('stelt op naam een rol per rang voor', async () => {
    const data = await json(await get(`/api/clan/${GUILD_ID}`));
    expect(data.clans[0].voorstel).toMatchObject({ captain: 'role-captain', owner: 'role-owner' });
  });

  it('bewaart per clan welke rol bij welke rang hoort', async () => {
    const opgeslagen = await json(
      await stuur(`/api/clan/${GUILD_ID}`, 'PUT', {
        instellingen: {
          clans: [
            {
              groupId: GROUP_ID,
              naam: 'Mijn Clan',
              lidRol: null,
              rangRollen: { captain: 'role-captain', owner: 'role-owner' },
            },
          ],
        },
      }),
    );

    expect(opgeslagen.saved).toBe(true);
    const na = await json(await get(`/api/clan/${GUILD_ID}`));
    expect(na.instellingen.clans[0].rangRollen).toEqual({ captain: 'role-captain', owner: 'role-owner' });
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

  it('weigert een naam die geen OSRS-naam kan zijn', async () => {
    const antwoord = await stuur(`/api/clan/${GUILD_ID}/koppel`, 'POST', {
      discordId: '222222222',
      rsn: 'veel te lange naam',
    });
    expect(antwoord.status).toBe(400);
  });

  it('maakt een plan van wie welke rol krijgt', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/plan`, 'POST', {}));

    expect(data.groepen[0]).toMatchObject({ groupId: GROUP_ID, naam: 'Mijn Clan', aantal: 2 });
    expect(data.plan.wissels[0]).toMatchObject({
      rsn: 'Tess',
      erbij: ['role-captain'],
      // @Owner hoort bij een rang en klopt niet meer; @Corporal is aan niets
      // gekoppeld en blijft daarom staan.
      eraf: ['role-owner'],
    });
    expect(data.plan.ongekoppeld[0]).toMatchObject({ clan: 'Mijn Clan', leden: ['Sparc Mac'] });
    // Een plan verandert nog niets.
    expect(gedaan).toEqual([]);
  });

  it('deelt de rollen pas uit bij het bijwerken', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/sync`, 'POST', {}));

    expect(data.aangepast).toBe(1);
    expect(data.mislukt).toBe(0);
    expect(gedaan).toEqual([
      { wat: 'erbij', rollen: ['role-captain'] },
      { wat: 'eraf', rollen: ['role-owner'] },
    ]);

    // En onthoudt waar dit lid stond, zodat het scherm dat kan tonen.
    const na = await json(await get(`/api/clan/${GUILD_ID}`));
    expect(na.koppelingen[0].gezien[0]).toMatchObject({ clan: 'Mijn Clan', rang: 'captain', rangNaam: 'Captain' });
    expect(na.laatsteSync).not.toBeNull();
  });

  it('ontkoppelt weer', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/ontkoppel`, 'POST', { discordId: '111111111' }));
    expect(data.koppelingen).toEqual([]);
  });

  it('haalt een clan weer weg', async () => {
    const data = await json(await stuur(`/api/clan/${GUILD_ID}/verwijderen`, 'POST', { groupId: GROUP_ID }));
    expect(data.instellingen.clans).toEqual([]);
  });

  it('zegt het als er nog geen clan gekozen is', async () => {
    const antwoord = await stuur(`/api/clan/${GUILD_ID}/plan`, 'POST', {});
    expect(antwoord.status).toBe(400);
    expect((await json(antwoord)).error).toMatch(/nog geen clan/);
  });

  it('laat het scherm niet vallen als WiseOldMan een clan niet kent', async () => {
    leegClanCache();
    await stuur(`/api/clan/${GUILD_ID}`, 'PUT', {
      instellingen: { clans: [{ groupId: 999, naam: 'Weg', lidRol: null, rangRollen: {} }] },
    });

    const data = await json(await get(`/api/clan/${GUILD_ID}`));
    expect(data.clans[0].fout).toMatch(/kent die clan of naam niet/);
    expect(data.rollen).toHaveLength(4);
  });

  it('kent een server niet die er niet is', async () => {
    expect((await get('/api/clan/555555555')).status).toBe(404);
  });
});
