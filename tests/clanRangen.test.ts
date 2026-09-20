import { describe, expect, it } from 'vitest';
import type { ClanLid } from '../src/clan/runescape.js';
import {
  CLAN_RANGEN,
  clanInstellingenSchema,
  parseClanInstellingen,
  planClanRangen,
  raadRangRollen,
  rangHoogte,
  type ClanInstellingen,
  type DiscordLid,
  type RolInfo,
} from '../src/clan/rangen.js';

/**
 * Het rekenwerk achter de clanrollen. Geen Discord, geen internet: erin gaat
 * een ledenlijst, eruit komt wie welke rol krijgt.
 */

const rol = (id: string, naam: string, beheerbaar = true): RolInfo => ({ id, naam, beheerbaar });

const ROLLEN = new Map(
  [
    rol('r-owner', 'Owner'),
    rol('r-captain', 'Captain'),
    rol('r-corporal', 'Corporal'),
    rol('r-recruit', 'Recruit'),
    rol('r-lid', 'Clanlid'),
    rol('r-gast', 'Gast'),
    rol('r-event', 'Eventteam'),
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

const clanLid = (naam: string, rang: string): ClanLid => ({ naam, rang, totalXp: 1, kills: 0 });

const instellingen = (extra: Partial<ClanInstellingen> = {}): ClanInstellingen =>
  parseClanInstellingen({
    clan: 'Bloody Mayhem',
    rangRollen: { Owner: 'r-owner', Captain: 'r-captain', Corporal: 'r-corporal', Recruit: 'r-recruit' },
    ...extra,
  });

const plan = (opties: {
  instellingen?: ClanInstellingen;
  koppelingen: Array<{ discordId: string; rsn: string }>;
  clanLeden?: ClanLid[];
  leden: DiscordLid[];
}) =>
  planClanRangen({
    instellingen: opties.instellingen ?? instellingen(),
    koppelingen: opties.koppelingen,
    clanLeden: opties.clanLeden ?? [clanLid('Tess', 'Captain'), clanLid('Noa', 'Recruit')],
    leden: new Map(opties.leden.map((each) => [each.id, each])),
    rollen: ROLLEN,
  });

describe('rangen kennen hun volgorde', () => {
  it('zet Owner boven Recruit en kent onbekende rangen niet', () => {
    expect(rangHoogte('Owner')).toBeGreaterThan(rangHoogte('Recruit'));
    expect(rangHoogte('owner')).toBe(rangHoogte('Owner'));
    expect(rangHoogte('Zeemeermin')).toBe(-1);
  });

  it('heeft alle twaalf rangen van een RuneScape-clan', () => {
    expect(CLAN_RANGEN).toHaveLength(12);
  });
});

describe('instellingen nakijken', () => {
  it('vult standaardwaarden aan', () => {
    expect(clanInstellingenSchema.parse({})).toMatchObject({ clan: '', opruimen: true, automatisch: false });
  });

  it('weigert een rang die niet bestaat', () => {
    expect(() => parseClanInstellingen({ rangRollen: { Zeemeermin: 'r-lid' } })).toThrow(/Zeemeermin/);
  });
});

describe('het plan', () => {
  it('geeft de rol die bij de clanrang hoort', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', [])] });

    expect(uitkomst.wissels).toHaveLength(1);
    expect(uitkomst.wissels[0]).toMatchObject({ rang: 'Captain', inClan: true, erbij: ['r-captain'], eraf: [] });
  });

  it('neemt de oude rangrol af bij een promotie', () => {
    const uitkomst = plan({
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-corporal'])],
    });

    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-captain']);
    expect(uitkomst.wissels[0]?.eraf).toEqual(['r-corporal']);
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
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', ['r-corporal'])],
    });

    expect(uitkomst.wissels[0]?.eraf).toEqual([]);
  });

  it('zakt naar een lagere rang als de eigen rang geen rol heeft', () => {
    // Alleen @Clanlid voor Recruit en @Captain hoger: een Corporal hoort dan de
    // rol van Recruit te krijgen en niet zonder rol te blijven staan.
    const uitkomst = plan({
      instellingen: instellingen({ rangRollen: { Captain: 'r-captain', Recruit: 'r-recruit' } }),
      clanLeden: [clanLid('Bram', 'Corporal')],
      koppelingen: [{ discordId: '1', rsn: 'Bram' }],
      leden: [lid('1', [])],
    });

    expect(uitkomst.wissels[0]).toMatchObject({ rang: 'Corporal', erbij: ['r-recruit'] });
  });

  it('geeft iedereen in de clan ook de lidrol', () => {
    const uitkomst = plan({
      instellingen: instellingen({ lidRol: 'r-lid' }),
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      leden: [lid('1', [])],
    });

    expect(uitkomst.wissels[0]?.erbij).toEqual(['r-captain', 'r-lid']);
  });

  it('zet wie de clan uit is op de gastrol', () => {
    const uitkomst = plan({
      instellingen: instellingen({ lidRol: 'r-lid', gastRol: 'r-gast' }),
      koppelingen: [{ discordId: '1', rsn: 'Weg Hier' }],
      leden: [lid('1', ['r-captain', 'r-lid'])],
    });

    expect(uitkomst.wissels[0]).toMatchObject({ inClan: false, rang: null, erbij: ['r-gast'] });
    expect(uitkomst.wissels[0]?.eraf).toEqual(['r-captain', 'r-lid']);
  });

  it('vindt een lid ondanks underscores en hoofdletters', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '1', rsn: 'tess' }], leden: [lid('1', [])] });
    expect(uitkomst.wissels[0]?.inClan).toBe(true);
  });

  it('neemt de schrijfwijze van Jagex over', () => {
    const uitkomst = plan({
      clanLeden: [clanLid('Sparc Mac', 'Owner')],
      koppelingen: [{ discordId: '1', rsn: 'sparc_mac' }],
      leden: [lid('1', [])],
    });

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

  it('zet clanleden zonder koppeling apart', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '1', rsn: 'Tess' }], leden: [lid('1', [])] });
    expect(uitkomst.ongekoppeld.map((each) => each.naam)).toEqual(['Noa']);
  });

  it('zet koppelingen van vertrokken leden apart', () => {
    const uitkomst = plan({ koppelingen: [{ discordId: '9', rsn: 'Tess' }], leden: [] });
    expect(uitkomst.vertrokken).toEqual([{ discordId: '9', rsn: 'Tess' }]);
    expect(uitkomst.wissels).toHaveLength(0);
  });

  it('waarschuwt over een rol die boven de bot staat', () => {
    const rollen = new Map(ROLLEN);
    rollen.set('r-captain', rol('r-captain', 'Captain', false));

    const uitkomst = planClanRangen({
      instellingen: instellingen(),
      koppelingen: [{ discordId: '1', rsn: 'Tess' }],
      clanLeden: [clanLid('Tess', 'Captain')],
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
    const uitkomst = plan({
      instellingen: parseClanInstellingen({}),
      koppelingen: [],
      leden: [],
    });

    expect(uitkomst.waarschuwingen).toHaveLength(2);
  });
});

describe('rollen raden op naam', () => {
  it('koppelt rollen die net zo heten als de rang', () => {
    const geraden = raadRangRollen([...ROLLEN.values()]);
    expect(geraden).toEqual({ Owner: 'r-owner', Captain: 'r-captain', Corporal: 'r-corporal', Recruit: 'r-recruit' });
  });
});
