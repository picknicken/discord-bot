import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Collection, PermissionFlagsBits, PermissionsBitField, type GuildMember } from 'discord.js';

const werkmap = mkdtempSync(path.join(tmpdir(), 'clan-knop-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = werkmap;
process.env.CLAN_DIR = path.join(werkmap, 'clan');

const clanDir = process.env.CLAN_DIR;

const {
  KOPPEL_KNOP,
  KOPPEL_VENSTER,
  koppelBericht,
  koppelKnopRij,
  toonKoppelVenster,
  verwerkKoppelVenster,
  welkomAan,
} = await import('../src/clan/knop.js');
const { handleGuildMemberAdd } = await import('../src/events/guildMemberAdd.js');
const { koppel, leesDossier, zetInstellingen } = await import('../src/clan/opslag.js');
const { parseClanInstellingen } = await import('../src/clan/rangen.js');
const { leegClanCache } = await import('../src/clan/wiseoldman.js');

const GUILD_ID = '987654321';

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
  return new Response('[]', { headers: { 'content-type': 'application/json' } });
}) as typeof fetch);

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(werkmap, { recursive: true, force: true });
});

async function kiesClan(extra: Record<string, unknown> = {}) {
  leegClanCache();
  rmSync(path.join(clanDir, `${GUILD_ID}.json`), { force: true });
  await zetInstellingen(
    clanDir,
    GUILD_ID,
    parseClanInstellingen({
      clans: [{ groupId: 139, naam: 'Mijn Clan', lidRol: 'role-captain' }],
      ...extra,
    }),
  );
}

describe('de knop zelf', () => {
  it('heeft een herkenbare id, zodat de bot hem terugkent', () => {
    const rij = koppelKnopRij().toJSON() as { components: Array<{ custom_id: string; label: string }> };
    expect(rij.components[0]?.custom_id).toBe(KOPPEL_KNOP);
    expect(rij.components[0]?.label).toBe('Koppel je OSRS-naam');
  });

  it('zet er een Engels label op voor een Engelse server', async () => {
    const rij = koppelKnopRij('en').toJSON() as { components: Array<{ label: string }> };
    expect(rij.components[0]?.label).toBe('Link your OSRS name');
  });

  it('noemt de clans bij naam in het bericht', async () => {
    await kiesClan();
    const bericht = koppelBericht(await leesDossier(clanDir, GUILD_ID), true) as {
      embeds: Array<{ data: { title: string; description: string } }>;
    };

    expect(bericht.embeds[0]?.data.title).toMatch(/Welkom/);
    expect(bericht.embeds[0]?.data.description).toMatch(/Mijn Clan/);
    // En zegt erbij wat er gebeurt als je er niet in zit.
    expect(bericht.embeds[0]?.data.description).toMatch(/geen rol/);
  });

  it('opent een venster met één veld', async () => {
    let getoond: { data: { custom_id: string } } | null = null;

    await toonKoppelVenster({
      locale: 'nl',
      showModal: async (venster: { data: { custom_id: string } }) => {
        getoond = venster;
      },
    } as never);

    expect(getoond).not.toBeNull();
    expect((getoond as unknown as { data: { custom_id: string } }).data.custom_id).toBe(KOPPEL_VENSTER);
  });
});

describe('het ingevulde venster', () => {
  /** Een lid dat de bot mag aanpassen, met een rol die hij mag uitdelen. */
  function stubInteractie(rsn: string, discordId = '111111111') {
    const antwoorden: string[] = [];
    const lid = {
      id: discordId,
      user: { username: 'tessa', globalName: null },
      nickname: null,
      manageable: true,
      roles: { cache: new Collection<string, unknown>(), add: async () => undefined, remove: async () => undefined },
      setNickname: async () => undefined,
    };

    return {
      antwoorden,
      interactie: {
        inGuild: () => true,
        locale: 'nl',
        user: { id: discordId },
        fields: { getTextInputValue: () => rsn },
        guild: {
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
        },
        deferReply: async () => undefined,
        reply: async (bericht: { content: string }) => void antwoorden.push(bericht.content),
        editReply: async (bericht: string) => void antwoorden.push(bericht),
      },
    };
  }

  it('koppelt de naam en vertelt wat er gebeurde', async () => {
    await kiesClan();
    const { interactie, antwoorden } = stubInteractie('Tess');

    await verwerkKoppelVenster(interactie as never, clanDir);

    expect(antwoorden[0]).toMatch(/staat in \*\*Mijn Clan\*\* als \*\*Captain\*\*/);
    expect((await leesDossier(clanDir, GUILD_ID)).koppelingen['111111111']?.rsn).toBe('Tess');
  });

  it('werkt alleen in een server', async () => {
    const antwoorden: string[] = [];
    await verwerkKoppelVenster(
      {
        inGuild: () => false,
        locale: 'nl',
        reply: async (bericht: { content: string }) => void antwoorden.push(bericht.content),
      } as never,
      clanDir,
    );

    expect(antwoorden[0]).toMatch(/alleen in een server/);
  });
});

describe('wie binnenkomt', () => {
  function stubLid(opties: { bot?: boolean; id?: string } = {}) {
    const verstuurd: Array<Record<string, unknown>> = [];
    const kanaal = {
      id: 'kanaal-1',
      name: 'welkom',
      type: 0,
      rawPosition: 0,
      send: async (bericht: Record<string, unknown>) => void verstuurd.push(bericht),
      permissionsFor: () => ({ has: () => true }),
    };

    const member = {
      id: opties.id ?? '111111111',
      user: { username: 'tessa', bot: opties.bot ?? false },
      send: async (bericht: Record<string, unknown>) => void verstuurd.push({ dm: true, ...bericht }),
      guild: {
        id: GUILD_ID,
        name: 'Clanserver',
        systemChannel: kanaal,
        members: { me: { id: 'bot' } },
        channels: { cache: new Collection([[kanaal.id, kanaal]]) },
      },
    };

    return { verstuurd, member: member as unknown as GuildMember };
  }

  it('stuurt het welkomstbericht met de knop erin', async () => {
    await kiesClan();
    const { member, verstuurd } = stubLid();

    await handleGuildMemberAdd(member);

    expect(verstuurd).toHaveLength(1);
    expect(verstuurd[0]?.content).toBe('<@111111111>');
    const rijen = verstuurd[0]?.components as Array<{ toJSON: () => { components: Array<{ custom_id: string }> } }>;
    expect(rijen[0]?.toJSON().components[0]?.custom_id).toBe(KOPPEL_KNOP);
  });

  it('laat bots met rust', async () => {
    await kiesClan();
    const { member, verstuurd } = stubLid({ bot: true });

    await handleGuildMemberAdd(member);
    expect(verstuurd).toHaveLength(0);
  });

  it('zwijgt als het welkom uitstaat', async () => {
    await kiesClan({ welkom: false });
    const { member, verstuurd } = stubLid();

    await handleGuildMemberAdd(member);
    expect(verstuurd).toHaveLength(0);
  });

  it('zwijgt zolang er geen clan gekozen is', async () => {
    leegClanCache();
    rmSync(path.join(clanDir, `${GUILD_ID}.json`), { force: true });
    const { member, verstuurd } = stubLid();

    await handleGuildMemberAdd(member);
    expect(verstuurd).toHaveLength(0);
  });

  it('valt niet lastig wie al gekoppeld is', async () => {
    await kiesClan();
    await koppel(clanDir, GUILD_ID, '111111111', 'Tess', 'zelf');

    const { member, verstuurd } = stubLid();
    await handleGuildMemberAdd(member);

    expect(verstuurd).toHaveLength(0);
  });

  it('zegt of deze server het welkom aan heeft staan', async () => {
    await kiesClan();
    expect(await welkomAan(clanDir, GUILD_ID)).not.toBeNull();

    await kiesClan({ welkom: false });
    expect(await welkomAan(clanDir, GUILD_ID)).toBeNull();
  });
});
