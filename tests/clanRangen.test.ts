import { describe, expect, it } from 'vitest';
import {
  clanInstellingenSchema,
  parseClanInstellingen,
  planClanRangen,
  raadRangRollen,
  type ClanInstellingen,
  type DiscordLid,
  type Ledenlijst,
  type RolInfo,
} from '../src/clan/rangen.js';

/**
 * Het rekenwerk achter de clanrollen. Geen Discord, geen internet: erin gaan de
 * ledenlijsten van de gekozen clans, eruit komt wie welke rol krijgt.
 */

const rol = (id: string, naam: string, beheerbaar = true): RolInfo => ({ id, naam, beheerbaar });

const ROLLEN = new Map(
  [
    rol('r-owner', 'Owner'),
    rol('r-captain', 'Captain'),
    rol('r-corporal', 'Corporal'),
    rol('r-lid', 'Clanlid'),
    rol('r-gast', 'Gast'),
    rol('r-event', 'Eventteam'),
    rol('r-tweede', 'Tweede clan'),
  ].map((info) => [info.id, info]),
);

const lid = (id: string, rollen: string[], extra: Partial<DiscordLid> = {}): DiscordLid => ({
  id,
  naam: 'Lid ' + id,
  bijnaam: null,
  rollen,
  beheerbaar: true,
  ...extra,
});

/** Eén clan met drie leden; genoeg om alle gevallen mee te bouwen. */
const LIJST: Ledenlijst = {
  groupId: 139,
  naam: 'Mijn Clan',
  leden: [
    { naam: 'Tess', rang: 'captain' },
    { naam: 'Noa', rang: 'member' },
    { naam: 'Sparc Mac', rang: 'owner' },
  ],
};

const instellingen = (extra: Partial<ClanInstellingen> = {}): ClanInstellingen =>
  parseClanInstellingen({
    clans: [
      {
        groupId: 139,
        naam: 'Mijn Clan',
        lidRol: null,
        rangRollen: { owner: 'r-owner', captain: 'r-captain' },
      },
    ],
    ...extra,
  });

const plan = (opties: {
  instellingen?: ClanInstellingen;
  koppelingen: Array<{ discordId: string; rsn: string }>;
  ledenlijsten?: Ledenlijst[];
  leden: DiscordLid[];
}) =>
  planClanRangen({
    instellingen: opties.instellingen ?? instellingen(),
    koppelingen: opties.koppelingen,
    ledenlijsten: opties.ledenlijsten ?? [LIJST],
    leden: new Map(opties.leden.map((each) => [each.id, each])),
    rollen: ROLLEN,
  });

describe('instellingen nakijken', () => {
  it('vult standaardwaarden aan', () => {
    expect(clanInstellingenSchema.parse({})).toMatchObject({ clans: [], opruimen: true, automatisch: false });
  });

  it('weigert dezelfde clan twee keer', () => {
    expect(() =>
      parseClanInstellingen({ clans: [{ groupId: 139 }, { groupId: 139 }] }),
    ).toThrow(/twee keer/);
  });

  it('weigert een clan-nummer dat geen nummer is', () => {
    expect(() => parseClanInstellingen({ clans: [{ groupId: 'honderd' }] })).toThrow();
  });

  it('laat elke rang toe die WiseOldMan gebruikt', () => {
    // Elke OSRS-clan bepaalt zelf zijn rangen; een vaste lijst zou
    // voor de helft van de clans niet kloppen.
    const uitkomst = parseClanInstellingen({
      clans: [{ groupId: 1, rangRollen: { short_green_guy: 'r-lid', gnome_child: 'r-gast' } }],
    });

    expect(uitkomst.clans[0]?.rangRollen).toEqual({ short_green_guy: 'r-lid', gnome_child: 'r-gast' });
  });
});

describe('het plan', () => {
  it('geeft de rol die bij de clanrang hoort', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', [])] });

    expect(uitkomst.wissels).toHaveLength(1);
    expect(uitkomst.wissels[0]).toMatchObject({ erbij: ['r-captain'], eraf: [] });
    expect(uitkomst.wissels[0]?.gevonden).toEqual([{ groupId: 139, clan: 'Mijn Clan', rang: 'captain' }]);
  });

  it('neemt de oude rangrol af bij een promotie', () => {
    const uitkomst = plan({
      koppelingen: [{ discordId: '1', rsn: 'Sparc Mac' }],
      leden: [lid('1', ['r-captain'])],
    });

    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-owner']);
    expect(uitkomst.wissels[0]?.eraf).toEqual(['r-captain']);
  });

  it('laat rollen met rust die niets met de clan te maken hebben', () => {
    const uitkomst = plan({
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-event'])],
    });

    expect(uitkomst.wissels[0]?.eraf).not.toContain('r-event');
  });

  it('laat alles staan als opruimen uitstaat', () => {
    const uitkomst = plan({
      instellingen: instellingen({ opruimen: false }),
      koppelingen: [{ discordId: '1', rsn: 'Sparc Mac' }],
      leden: [lid('1', ['r-captain'])],
    });

    expect(uitkomst.wissels[0]?.eraf).toEqual([]);
  });

  it('geeft de clanrol aan iedereen in de clan, ook zonder rangrol', () => {
    // Noa is "member", en daar hangt geen rol aan. De clanrol hoort hij wel te
    // krijgen: hij staat immers gewoon in de ledenlijst.
    const uitkomst = plan({
      instellingen: parseClanInstellingen({
        clans: [{ groupId: 139, naam: 'Mijn Clan', lidRol: 'r-lid', rangRollen: { captain: 'r-captain' } }],
      }),
      koppelingen: [{ discordId: '1', rsn: 'Noa' }],
      leden: [lid('1', [])],
    });

    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-lid']);
  });

  it('zet wie in geen enkele gekozen clan zit op de gastrol', () => {
    const uitkomst = plan({
      instellingen: instellingen({ gastRol: 'r-gast' }),
      koppelingen: [{ discordId: '1', rsn: 'Weg Hier' }],
      leden: [lid('1', ['r-captain'])],
    });

    expect(uitkomst.wissels[0]?.gevonden).toEqual([]);
    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-gast']);
    expect(uitkomst.wissels[0]?.eraf).toEqual(['r-captain']);
  });

  it('geeft bij twee gekozen clans de rollen van allebei', () => {
    const tweede: Ledenlijst = { groupId: 200, naam: 'Tweede Clan', leden: [{ naam: 'Tess', rang: 'member' }] };

    const uitkomst = plan({
      instellingen: parseClanInstellingen({
        clans: [
          { groupId: 139, naam: 'Mijn Clan', rangRollen: { captain: 'r-captain' } },
          { groupId: 200, naam: 'Tweede Clan', lidRol: 'r-tweede' },
        ],
      }),
      ledenlijsten: [LIJST, tweede],
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', [])],
    });

    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-captain', 'r-tweede']);
    expect(uitkomst.wissels[0]?.gevonden.map((plek) => plek.clan)).toEqual(['Mijn Clan', 'Tweede Clan']);
  });

  it('vindt een lid ondanks underscores en hoofdletters', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '1', rsn: 'sparc_mac' }], leden: [lid('1', [])] });

    expect(uitkomst.wissels[0]?.gevonden).toHaveLength(1);
    // En neemt de schrijfwijze van WiseOldMan over.
    expect(uitkomst.wissels[0]?.rsn).toBe('Sparc Mac');
  });

  it('telt wie al goed stond apart', () => {
    const uitkomst = plan({
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-captain'])],
    });

    expect(uitkomst.wissels).toHaveLength(0);
    expect(uitkomst.ongewijzigd).toBe(1);
  });

  it('trekt de bijnaam gelijk, maar alleen als dat aanstaat', () => {
    const uit = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', ['r-captain'])] });
    expect(uit.wissels).toHaveLength(0);

    const aan = plan({
      instellingen: instellingen({ bijnaam: true }),
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-captain'], { bijnaam: 'iets anders' })],
    });
    expect(aan.wissels[0]?.bijnaamNaar).toBe('Tess');
  });

  it('zet per clan de leden zonder koppeling apart', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', [])] });

    expect(uitkomst.ongekoppeld).toEqual([
      { groupId: 139, clan: 'Mijn Clan', leden: ['Noa', 'Sparc Mac'] },
    ]);
  });

  it('zet koppelingen van vertrokken leden apart', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '9', rsn: 'Tess' }], leden: [] });

    expect(uitkomst.vertrokken).toEqual([{ discordId: '9', rsn: 'Tess' }]);
    expect(uitkomst.wissels).toHaveLength(0);
  });

  it('waarschuwt als een ledenlijst ontbreekt in plaats van iedereen leeg te halen', () => {
    const uitkomst = plan({ ledenlijsten: [], koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', [])] });

    expect(uitkomst.waarschuwingen.join(' ')).toMatch(/niet opgehaald/);
    expect(uitkomst.ongekoppeld).toEqual([]);
  });

  it('waarschuwt over een rol die boven de bot staat', () => {
    const rollen = new Map(ROLLEN);
    rollen.set('r-captain', rol('r-captain', 'Captain', false));

    const uitkomst = planClanRangen({
      instellingen: instellingen(),
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      ledenlijsten: [LIJST],
      leden: new Map([['1', lid('1', [])]]),
      rollen,
    });

    expect(uitkomst.waarschuwingen.join(' ')).toMatch(/boven zijn eigen rol/);
    expect(uitkomst.wissels[0]?.problemen.join(' ')).toMatch(/staat boven de bot/);
  });

  it('meldt een lid dat de bot niet mag aanpassen', () => {
    const uitkomst = plan({
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', [], { beheerbaar: false })],
    });

    expect(uitkomst.wissels[0]?.problemen.join(' ')).toMatch(/kan dit lid niet aanpassen/);
  });

  it('zegt het als er nog niets is ingesteld', () => {
    const uitkomst = plan({ instellingen: parseClanInstellingen({}), koppelingen: [], leden: [] });
    expect(uitkomst.waarschuwingen).toHaveLength(2);
  });

  it('schrijft in gewone taal op wat er gebeurt', () => {
    const uitkomst = plan({
      instellingen: instellingen({ gastRol: 'r-gast' }),
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-gast'])],
    });

    expect(uitkomst.wissels[0]?.reden).toBe(
      'Captain in Mijn Clan — krijgt @Captain, verliest @Gast',
    );
  });
});

describe('rollen raden op naam', () => {
  it('koppelt rollen die net zo heten als de rang', () => {
    const geraden = raadRangRollen([...ROLLEN.values()], ['owner', 'captain', 'deputy_owner']);
    expect(geraden).toEqual({ owner: 'r-owner', captain: 'r-captain' });
  });

  it('herkent ook de nette schrijfwijze', () => {
    const geraden = raadRangRollen([rol('r-dep', 'Deputy owner')], ['deputy_owner']);
    expect(geraden).toEqual({ deputy_owner: 'r-dep' });
  });
});
