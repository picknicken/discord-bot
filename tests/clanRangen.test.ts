import { describe, expect, it } from 'vitest';
import {
  clanInstellingenSchema,
  parseClanInstellingen,
  planClanRangen,
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
    clans: [{ groupId: 139, naam: 'Mijn Clan', lidRol: 'r-lid' }],
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

  it('houdt per clan maar één ding bij: de rol', () => {
    // Rangen deelt de bot met opzet niet uit; die blijven mensenwerk.
    const uitkomst = parseClanInstellingen({ clans: [{ groupId: 1, naam: 'Mijn Clan', lidRol: 'r-lid' }] });

    expect(uitkomst.clans[0]).toEqual({ groupId: 1, naam: 'Mijn Clan', lidRol: 'r-lid' });
  });

  it('vergeet een rangkoppeling uit een oude versie van het bestand', () => {
    const uitkomst = parseClanInstellingen({
      clans: [{ groupId: 1, naam: 'Mijn Clan', lidRol: 'r-lid', rangRollen: { owner: 'r-owner' } }],
    });

    expect(uitkomst.clans[0]).not.toHaveProperty('rangRollen');
  });
});

describe('het plan', () => {
  it('geeft de rol van de clan aan wie erin staat', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', [])] });

    expect(uitkomst.wissels).toHaveLength(1);
    expect(uitkomst.wissels[0]).toMatchObject({ erbij: ['r-lid'], eraf: [] });
    // De rang staat er wel bij — om te tonen, niet om een rol aan te hangen.
    expect(uitkomst.wissels[0]?.gevonden).toEqual([{ groupId: 139, clan: 'Mijn Clan', rang: 'captain' }]);
  });

  it('laat een promotie in het spel de rollen met rust', () => {
    // Sparc Mac is owner, Tess is captain: allebei krijgen ze dezelfde clanrol.
    const owner = plan({ koppelingen: [{ discordId: '1', rsn: 'Sparc Mac' }], leden: [lid('1', [])] });
    const captain = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', [])] });

    expect(owner.wissels[0]?.erbij).toEqual(['r-lid']);
    expect(captain.wissels[0]?.erbij).toEqual(['r-lid']);
  });

  it('laat rollen met rust die niets met de clan te maken hebben', () => {
    const uitkomst = plan({
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-event', 'r-captain'])],
    });

    // Ook een rol die toevallig naar een rang heet: die heeft iemand met de
    // hand gegeven, en daar blijft de bot vanaf.
    expect(uitkomst.wissels[0]?.eraf).toEqual([]);
  });

  it('laat alles staan als opruimen uitstaat', () => {
    const uitkomst = plan({
      instellingen: instellingen({ opruimen: false, gastRol: 'r-gast' }),
      koppelingen: [{ discordId: '1', rsn: 'Weg Hier' }],
      leden: [lid('1', ['r-lid'])],
    });

    expect(uitkomst.wissels[0]?.eraf).toEqual([]);
  });

  it('geeft de clanrol ongeacht welke rang iemand heeft', () => {
    // Noa is "member", Sparc Mac is "owner": dezelfde rol.
    const uitkomst = plan({
      koppelingen: [
        { discordId: '1', rsn: 'Noa' },
        { discordId: '2', rsn: 'Sparc Mac' },
      ],
      leden: [lid('1', []), lid('2', [])],
    });

    expect(uitkomst.wissels.map((wissel) => wissel.erbij)).toEqual([['r-lid'], ['r-lid']]);
  });

  it('neemt de clanrol af bij wie eruit ligt', () => {
    const uitkomst = plan({
      koppelingen: [{ discordId: '1', rsn: 'Weg Hier' }],
      leden: [lid('1', ['r-lid'])],
    });

    expect(uitkomst.wissels[0]?.gevonden).toEqual([]);
    expect(uitkomst.wissels[0]?.erbij).toEqual([]);
    expect(uitkomst.wissels[0]?.eraf).toEqual(['r-lid']);
  });

  it('geeft de gastrol aan wie in geen enkele gekozen clan zit', () => {
    const uitkomst = plan({
      instellingen: instellingen({ gastRol: 'r-gast' }),
      koppelingen: [{ discordId: '1', rsn: 'Weg Hier' }],
      leden: [lid('1', ['r-lid'])],
    });

    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-gast']);
    expect(uitkomst.wissels[0]?.eraf).toEqual(['r-lid']);
  });

  it('geeft bij twee gekozen clans de rollen van allebei', () => {
    const tweede: Ledenlijst = { groupId: 200, naam: 'Tweede Clan', leden: [{ naam: 'Tess', rang: 'member' }] };

    const uitkomst = plan({
      instellingen: parseClanInstellingen({
        clans: [
          { groupId: 139, naam: 'Mijn Clan', lidRol: 'r-lid' },
          { groupId: 200, naam: 'Tweede Clan', lidRol: 'r-tweede' },
        ],
      }),
      ledenlijsten: [LIJST, tweede],
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', [])],
    });

    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-lid', 'r-tweede']);
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
      leden: [lid('1', ['r-lid'])],
    });

    expect(uitkomst.wissels).toHaveLength(0);
    expect(uitkomst.ongewijzigd).toBe(1);
  });

  it('trekt de bijnaam gelijk, maar alleen als dat aanstaat', () => {
    const uit = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', ['r-lid'])] });
    expect(uit.wissels).toHaveLength(0);

    const aan = plan({
      instellingen: instellingen({ bijnaam: true }),
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-lid'], { bijnaam: 'iets anders' })],
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
    rollen.set('r-lid', rol('r-lid', 'Clanlid', false));

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

  it('zegt het als er nog geen clan gekozen is', () => {
    const uitkomst = plan({ instellingen: parseClanInstellingen({}), koppelingen: [], leden: [] });
    expect(uitkomst.waarschuwingen).toEqual(['Er is nog geen clan gekozen.']);
  });

  it('zegt het als aan een gekozen clan geen rol hangt', () => {
    const uitkomst = plan({
      instellingen: parseClanInstellingen({ clans: [{ groupId: 139, naam: 'Mijn Clan' }] }),
      koppelingen: [],
      leden: [],
    });

    expect(uitkomst.waarschuwingen.join(' ')).toMatch(/"Mijn Clan" hangt nog geen rol/);
  });

  it('schrijft in gewone taal op wat er gebeurt', () => {
    const uitkomst = plan({
      instellingen: instellingen({ gastRol: 'r-gast' }),
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-gast'])],
    });

    expect(uitkomst.wissels[0]?.reden).toBe('Captain in Mijn Clan — krijgt @Clanlid, verliest @Gast');
  });
});
