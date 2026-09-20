import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';

const werkmap = mkdtempSync(path.join(tmpdir(), 'clan-koppel-'));
const clanDir = path.join(werkmap, 'clan');

const { koppelEnMeld } = await import('../src/clan/koppelen.js');
const { koppel, leesDossier, zetInstellingen } = await import('../src/clan/opslag.js');
const { parseClanInstellingen } = await import('../src/clan/rangen.js');
const { leegClanCache } = await import('../src/clan/wiseoldman.js');

const GUILD_ID = '987654321';

/** WiseOldMan, nagemaakt: Tess zit in de clan, de rest niet. */
vi.stubGlobal('fetch', (async (invoer: Parameters<typeof fetch>[0]) => {
  const url = String(invoer);
  const json = (waarde: unknown) =>
    new Response(JSON.stringify(waarde), { headers: { 'content-type': 'application/json' } });

  if (url.includes('/groups/139')) {
    return json({
      id: 139,
      name: 'Mijn Clan',
      memberships: [{ role: 'captain', player: { username: 'tess', displayName: 'Tess' } }],
    });
  }
  if (url.includes('/players/')) return json([{ role: 'member', group: { id: 900, name: 'Andere Clan' } }]);
  return new Response('{}', { status: 404 });
}) as typeof fetch);

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(werkmap, { recursive: true, force: true });
});

/** Onthoudt welke rollen dit lid kreeg of kwijtraakte. */
const gedaan: string[] = [];

/**
 * Eén lid dat zijn rollen onthoudt. Een nagemaakt lid dat na `roles.add` nog
 * steeds niets heeft, zou de tweede keer weer dezelfde wijziging opleveren —
 * en dan test je iets wat in Discord niet gebeurt.
 */
const rollenVanLid = new Collection<string, unknown>();

function stubGuild(): Guild {
  const lid = {
    id: '111111111',
    user: { username: 'tessa', globalName: null },
    nickname: null,
    manageable: true,
    roles: {
      cache: rollenVanLid,
      add: async (ids: string[]) => {
        gedaan.push('erbij:' + ids.join(','));
        for (const id of ids) rollenVanLid.set(id, { id });
      },
      remove: async (ids: string[]) => {
        gedaan.push('eraf:' + ids.join(','));
        for (const id of ids) rollenVanLid.delete(id);
      },
    },
    setNickname: async () => undefined,
  };

  return {
    id: GUILD_ID,
    name: 'Clanserver',
    roles: {
      cache: new Collection([
        [GUILD_ID, { id: GUILD_ID, name: '@everyone', position: 0, managed: false }],
        ['role-captain', { id: 'role-captain', name: 'Captain', position: 2, managed: false }],
      ]),
    },
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
        roles: { highest: { position: 9 } },
      }),
      fetch: async (wat: string | { user: string[] }) =>
        typeof wat === 'string' ? lid : new Collection([[lid.id, lid]]),
    },
  } as unknown as Guild;
}

async function kiesClan() {
  leegClanCache();
  gedaan.length = 0;
  rollenVanLid.clear();
  // Schoon beginnen: een koppeling uit een vorige test is hier geen "die naam
  // is al bezet" maar ruis.
  rmSync(path.join(clanDir, `${GUILD_ID}.json`), { force: true });
  await zetInstellingen(
    clanDir,
    GUILD_ID,
    parseClanInstellingen({
      clans: [{ groupId: 139, naam: 'Mijn Clan', lidRol: null, rangRollen: { captain: 'role-captain' } }],
    }),
  );
}

const vraag = (rsn: string, discordId = '111111111') =>
  koppelEnMeld({ clanDir, guild: stubGuild(), discordId, rsn, door: 'zelf' });

describe('koppelen', () => {
  it('geeft de rol die bij de rang hoort', async () => {
    await kiesClan();
    const uitkomst = await vraag('Tess');

    expect(uitkomst.inClan).toBe(true);
    expect(uitkomst.bericht).toMatch(/staat in \*\*Mijn Clan\*\* als \*\*Captain\*\*/);
    expect(gedaan).toEqual(['erbij:role-captain']);
  });

  it('noemt de rang ook als er niets te veranderen valt', async () => {
    await kiesClan();
    await vraag('Tess');

    // Tweede keer: de rol staat er al, dus er verandert niets. Je rang hoort
    // dan nog steeds in het antwoord te staan.
    const nogmaals = await vraag('Tess');
    expect(nogmaals.bericht).toMatch(/staat in \*\*Mijn Clan\*\* als \*\*Captain\*\*/);
    expect(nogmaals.bericht).toMatch(/klopten al/);
  });

  it('zegt eerlijk dat er nog geen rol aan die rang hangt', async () => {
    // Niets gekoppeld aan "captain": dan is "je rollen klopten al" een leugen.
    leegClanCache();
    rollenVanLid.clear();
    rmSync(path.join(clanDir, `${GUILD_ID}.json`), { force: true });
    await zetInstellingen(
      clanDir,
      GUILD_ID,
      parseClanInstellingen({ clans: [{ groupId: 139, naam: 'Mijn Clan', lidRol: null, rangRollen: {} }] }),
    );

    const uitkomst = await vraag('Tess');

    expect(uitkomst.inClan).toBe(true);
    expect(uitkomst.bericht).toMatch(/als \*\*Captain\*\*/);
    expect(uitkomst.bericht).toMatch(/nog geen Discord-rol/);
    expect(uitkomst.bericht).not.toMatch(/klopten al/);
  });

  it('bewaart de naam ook als iemand niet in de clan zit, en geeft geen rol', async () => {
    // Precies de bedoeling: het onderscheid zit in de rol, maar je wilt wel
    // weten wie wie is in het spel.
    await kiesClan();
    const uitkomst = await vraag('Noa', '222222222');

    expect(uitkomst.gekoppeld).toBe(true);
    expect(uitkomst.inClan).toBe(false);
    expect(gedaan).toEqual([]);

    const dossier = await leesDossier(clanDir, GUILD_ID);
    expect(dossier.koppelingen['222222222']?.rsn).toBe('Noa');
  });

  it('zegt erbij in welke clan iemand dan wél zit', async () => {
    await kiesClan();
    const uitkomst = await vraag('Noa', '333333333');

    expect(uitkomst.bericht).toMatch(/Andere Clan/);
    expect(uitkomst.bericht).toMatch(/telt hier niet mee/);
    expect(uitkomst.bericht).toMatch(/blijft gekoppeld/);
  });

  it('weigert een naam die geen OSRS-naam kan zijn', async () => {
    await kiesClan();
    const uitkomst = await vraag('veel te lange naam', '444444444');

    expect(uitkomst.gekoppeld).toBe(false);
    expect(uitkomst.bericht).toMatch(/kan geen OSRS-naam zijn/);
  });

  it('weigert een naam die al van iemand anders is', async () => {
    await kiesClan();
    await koppel(clanDir, GUILD_ID, '555555555', 'Tess', 'zelf');

    const uitkomst = await vraag('tess', '666666666');
    expect(uitkomst.gekoppeld).toBe(false);
    expect(uitkomst.bericht).toMatch(/staat al gekoppeld aan <@555555555>/);
  });

  it('noteert de naam ook als er nog geen clan gekozen is', async () => {
    leegClanCache();
    await zetInstellingen(clanDir, '111222333', parseClanInstellingen({}));

    const uitkomst = await koppelEnMeld({
      clanDir,
      guild: { ...stubGuild(), id: '111222333' } as Guild,
      discordId: '777777777',
      rsn: 'Bram',
      door: 'zelf',
    });

    expect(uitkomst.gekoppeld).toBe(true);
    expect(uitkomst.bericht).toMatch(/nog geen clan gekozen/);
  });
});
