import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Collection,
  PermissionFlagsBits,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from 'discord.js';

const werkmap = mkdtempSync(path.join(tmpdir(), 'clan-cmd-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = werkmap;
process.env.CLAN_DIR = path.join(werkmap, 'clan');
process.env.GUILD_IDS = '987654321';

const { data, execute } = await import('../src/commands/clan.js');
const { koppel, leesDossier, zetInstellingen } = await import('../src/clan/opslag.js');
const { parseClanInstellingen } = await import('../src/clan/rangen.js');
const { leegClanCache } = await import('../src/clan/wiseoldman.js');
const { COMMANDS } = await import('../src/bot.js');

/** WiseOldMan, nagemaakt: er gaat geen verzoek het internet op. */
const GROEP = {
  id: 139,
  name: 'Mijn Clan',
  memberships: [{ role: 'captain', player: { username: 'tess', displayName: 'Tess' } }],
};

vi.stubGlobal('fetch', (async (invoer: Parameters<typeof fetch>[0]) => {
  const url = String(invoer);
  const json = (waarde: unknown) =>
    new Response(JSON.stringify(waarde), { headers: { 'content-type': 'application/json' } });

  if (url.includes('/groups/139')) return json(GROEP);
  // In welke clans zit deze speler volgens WiseOldMan?
  if (url.includes('/players/')) return json([{ role: 'member', group: { id: 900, name: 'Andere Clan' } }]);
  return new Response('{}', { status: 404 });
}) as typeof fetch);

/** Een server met één lid erin, genoeg om rollen op te kunnen zetten. */
function stubGuild(guildId: string) {
  const lid = {
    id: '111111111',
    user: { username: 'tessa', globalName: null },
    nickname: null,
    manageable: true,
    roles: { cache: new Collection<string, unknown>(), add: async () => undefined, remove: async () => undefined },
    setNickname: async () => undefined,
  };

  return {
    id: guildId,
    name: 'Clanserver',
    roles: {
      cache: new Collection([
        [guildId, { id: guildId, name: '@everyone', position: 0, managed: false }],
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
  };
}

/** Een nagebootst commando; we kijken naar wat er terugkomt en wat er op schijf staat. */
function interactie(opties: {
  guildId?: string;
  permissions?: bigint;
  subcommand: string;
  rsn?: string;
  userId?: string;
}) {
  const antwoorden: string[] = [];

  return {
    antwoorden,
    interaction: {
      inGuild: () => true,
      guild: stubGuild(opties.guildId ?? '987654321'),
      guildId: opties.guildId ?? '987654321',
      user: { id: opties.userId ?? '111111111', username: 'tessa' },
      memberPermissions: new PermissionsBitField(opties.permissions ?? PermissionFlagsBits.SendMessages),
      options: {
        getSubcommand: () => opties.subcommand,
        getString: () => opties.rsn ?? '',
        getUser: () => ({ id: '111111111' }),
      },
      reply: async (bericht: { content?: string }) => {
        antwoorden.push(bericht.content ?? '(embed)');
      },
      deferReply: async () => undefined,
      editReply: async (bericht: string | { content?: string }) => {
        antwoorden.push(typeof bericht === 'string' ? bericht : (bericht.content ?? '(embed)'));
      },
    } as unknown as ChatInputCommandInteraction,
  };
}

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(werkmap, { recursive: true, force: true });
});

/** De clan die voor deze server meetelt, met een rol aan de rang Captain. */
async function kiesClan() {
  leegClanCache();
  await zetInstellingen(
    process.env.CLAN_DIR as string,
    '987654321',
    parseClanInstellingen({
      clans: [{ groupId: 139, naam: 'Mijn Clan', lidRol: null, rangRollen: { captain: 'role-captain' } }],
    }),
  );
}

describe('/clan', () => {
  it('staat naast /setup geregistreerd', () => {
    expect(data.name).toBe('clan');
    expect(COMMANDS.map((command) => command.data.name).sort()).toEqual(['clan', 'setup']);
  });

  it('weigert een server die niet op de lijst staat', async () => {
    const { interaction, antwoorden } = interactie({ guildId: 'mag-niet', subcommand: 'status' });
    await execute(interaction);
    expect(antwoorden[0]).toMatch(/staat niet in de lijst/);
  });

  it('houdt /clan sync bij wie geen rollen mag beheren weg', async () => {
    const { interaction, antwoorden } = interactie({ subcommand: 'sync' });
    await execute(interaction);
    expect(antwoorden[0]).toMatch(/Rollen beheren/);
  });

  it('laat koppelen wel aan een gewoon lid', async () => {
    const { interaction, antwoorden } = interactie({ subcommand: 'koppel', rsn: 'een veel te lange naam' });
    await execute(interaction);
    // Struikelt op de naam, niet op de rechten: dat is precies het verschil.
    expect(antwoorden[0]).toMatch(/kan geen OSRS-naam zijn/);
  });

  it('vertelt bij /clan mij dat er nog niets gekoppeld is', async () => {
    const { interaction, antwoorden } = interactie({ subcommand: 'mij', userId: '222222222' });
    await execute(interaction);
    expect(antwoorden[0]).toMatch(/nog geen OSRS-naam gekoppeld/);
  });

  it('haalt de koppeling weg bij /clan ontkoppel', async () => {
    await koppel(process.env.CLAN_DIR as string, '987654321', '111111111', 'Tess', 'zelf');

    const { interaction, antwoorden } = interactie({ subcommand: 'ontkoppel' });
    await execute(interaction);

    expect(antwoorden[0]).toMatch(/Koppeling weg/);
    expect((await leesDossier(process.env.CLAN_DIR as string, '987654321')).koppelingen).toEqual({});
  });

  it('geeft de rol die bij je rang hoort', async () => {
    await kiesClan();

    const { interaction, antwoorden } = interactie({ subcommand: 'koppel', rsn: 'Tess' });
    await execute(interaction);

    expect(antwoorden[0]).toMatch(/staat in \*\*Mijn Clan\*\* als \*\*Captain\*\*/);
    expect(antwoorden[0]).toMatch(/Krijgt @Captain/);
  });

  it('zegt het als je clan hier niet meetelt', async () => {
    await kiesClan();

    const { interaction, antwoorden } = interactie({ subcommand: 'koppel', rsn: 'Noa', userId: '111111111' });
    await execute(interaction);

    // Het verschil tussen "je naam staat verkeerd" en "je zit in de verkeerde
    // clan" is precies wat iemand op dat moment wil weten.
    expect(antwoorden[0]).toMatch(/Andere Clan/);
    expect(antwoorden[0]).toMatch(/telt hier niet mee/);
  });

  it('zegt bij "wie" wat er over een lid bekend is', async () => {
    await koppel(process.env.CLAN_DIR as string, '987654321', '111111111', 'Tess', 'zelf');

    const { interaction, antwoorden } = interactie({
      subcommand: 'wie',
      permissions: PermissionFlagsBits.ManageRoles,
    });
    await execute(interaction);

    expect(antwoorden[0]).toMatch(/Tess/);
  });
});
