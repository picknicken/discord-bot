import { describe, expect, it } from 'vitest';
import { Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import { voerClanPlanUit, rolInfoVan, verzamelLeden } from '../src/clan/synchroniseren.js';
import type { ClanPlan, Rangwissel } from '../src/clan/rangen.js';

/**
 * Het uitvoeren zelf: wat er gebeurt als Discord niet meewerkt. Een clan van
 * tweehonderd man hoort niet stil te vallen op één lid dat de bot niet mag
 * aanraken.
 */

const wissel = (extra: Partial<Rangwissel> = {}): Rangwissel => ({
  discordId: '1',
  rsn: 'Tess',
  weergavenaam: 'Tessa',
  gevonden: [{ groupId: 139, clan: 'Mijn Clan', rang: 'captain' }],
  erbij: ['role-captain'],
  eraf: [],
  bijnaamNaar: null,
  staat: 'Captain in Mijn Clan',
  wijziging: 'krijgt @Captain',
  reden: 'Captain in Mijn Clan — krijgt @Captain',
  problemen: [],
  ...extra,
});

const plan = (wissels: Rangwissel[]): ClanPlan => ({
  wissels,
  ongewijzigd: 0,
  ongekoppeld: [],
  vertrokken: [],
  waarschuwingen: [],
});

function stubGuild(opties: {
  rechten?: bigint;
  leden?: Record<string, unknown>;
}): Guild {
  return {
    id: '987654321',
    name: 'Clanserver',
    roles: { cache: new Collection() },
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(opties.rechten ?? PermissionFlagsBits.ManageRoles),
        roles: { highest: { position: 9 } },
      }),
      fetch: async (id: string) => {
        const lid = opties.leden?.[id];
        if (!lid) throw new Error('Unknown Member');
        return lid;
      },
    },
  } as unknown as Guild;
}

const stubLid = (extra: Record<string, unknown> = {}) => ({
  manageable: true,
  roles: { add: async () => undefined, remove: async () => undefined },
  setNickname: async () => undefined,
  ...extra,
});

describe('rollen uitdelen', () => {
  it('doet niets zonder het recht "Rollen beheren"', async () => {
    const uitkomst = await voerClanPlanUit(
      stubGuild({ rechten: PermissionFlagsBits.ManageGuild }),
      plan([wissel()]),
      'test',
    );

    expect(uitkomst.aangepast).toBe(0);
    expect(uitkomst.mislukt).toBe(1);
    expect(uitkomst.fouten[0]).toMatch(/Rollen beheren/);
  });

  it('gaat door na een lid dat niet meer bestaat', async () => {
    const uitkomst = await voerClanPlanUit(
      stubGuild({ leden: { '2': stubLid() } }),
      plan([wissel({ discordId: '1' }), wissel({ discordId: '2', weergavenaam: 'Noa' })]),
      'test',
    );

    expect(uitkomst.aangepast).toBe(1);
    expect(uitkomst.mislukt).toBe(1);
    expect(uitkomst.fouten[0]).toMatch(/Tessa: Unknown Member/);
  });

  it('deelt de rollen wel uit maar meldt de bijnaam zonder het juiste recht', async () => {
    let bijnaamGezet = false;
    const guild = stubGuild({
      leden: { '1': stubLid({ setNickname: async () => void (bijnaamGezet = true) }) },
    });

    const uitkomst = await voerClanPlanUit(guild, plan([wissel({ bijnaamNaar: 'Tess' })]), 'test');

    expect(uitkomst.aangepast).toBe(1);
    expect(bijnaamGezet).toBe(false);
    expect(uitkomst.fouten[0]).toMatch(/Bijnamen beheren/);
  });

  it('laat de bijnaam met rust bij een lid dat boven de bot staat', async () => {
    const guild = stubGuild({
      rechten: PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageNicknames,
      leden: { '1': stubLid({ manageable: false }) },
    });

    const uitkomst = await voerClanPlanUit(guild, plan([wissel({ bijnaamNaar: 'Tess' })]), 'test');

    expect(uitkomst.aangepast).toBe(1);
    expect(uitkomst.fouten[0]).toMatch(/staat boven de bot/);
  });
});

describe('de server uitlezen', () => {
  it('laat @everyone en botrollen buiten de keuze', async () => {
    const guild = {
      id: 'g',
      roles: {
        cache: new Collection([
          ['g', { id: 'g', name: '@everyone', position: 0, managed: false }],
          ['b', { id: 'b', name: 'Een andere bot', position: 1, managed: true }],
          ['r', { id: 'r', name: 'Captain', position: 2, managed: false }],
        ]),
      },
    } as unknown as Guild;

    const me = {
      permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
      roles: { highest: { position: 9 } },
    } as never;

    const rollen = rolInfoVan(guild, me);
    expect([...rollen.keys()]).toEqual(['b', 'r']);
    expect(rollen.get('b')?.beheerbaar).toBe(false);
    expect(rollen.get('r')?.beheerbaar).toBe(true);
  });

  it('haalt leden per blok op en valt terug op één voor één', async () => {
    const lid = (id: string) => ({
      id,
      user: { username: 'lid' + id, globalName: null },
      nickname: null,
      manageable: true,
      roles: { cache: new Collection() },
    });

    const guild = {
      name: 'Clanserver',
      members: {
        fetch: async (wat: string | { user: string[] }) => {
          if (typeof wat !== 'string') throw new Error('gateway doet niet mee');
          if (wat === '2') throw new Error('Unknown Member');
          return lid(wat);
        },
      },
    } as unknown as Guild;

    const leden = await verzamelLeden(guild, ['1', '2']);
    expect([...leden.keys()]).toEqual(['1']);
  });

  it('vraagt niets op zonder leden', async () => {
    const guild = {
      members: {
        fetch: async () => {
          throw new Error('had niet gemogen');
        },
      },
    } as unknown as Guild;

    expect(await verzamelLeden(guild, [])).toEqual(new Map());
  });
});
