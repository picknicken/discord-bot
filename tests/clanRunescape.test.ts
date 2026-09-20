import { describe, expect, it, beforeEach } from 'vitest';
import {
  geldigeNaam,
  haalLedenlijst,
  haalSpeler,
  leegClanCache,
  normaliseerNaam,
  parseLedenCsv,
  parseSpelerDetails,
  RuneScapeFout,
} from '../src/clan/runescape.js';

/**
 * De twee eindpunten van Jagex zijn oud en beloven niets. Deze tests leggen
 * vast wat hun antwoorden betekenen, zodat het meteen opvalt als ze ooit iets
 * anders gaan sturen.
 */

// Zo komt de ledenlijst er echt uit: harde spaties in de namen, een kopregel
// met spaties achter de komma's.
const CSV =
  'Clanmate, Clan Rank, Total XP, Kills\n' +
  'Sparc Mac, Owner, 1200000000, 42\n' +
  'Tess, Captain, 640000000, 12\n' +
  'Noa, Recruit, 14000000, 0\n';

const antwoord = (tekst: string, status = 200): typeof fetch =>
  (async () => new Response(tekst, { status })) as unknown as typeof fetch;

beforeEach(() => leegClanCache());

describe('ledenlijst lezen', () => {
  it('leest namen, rangen en getallen', () => {
    const leden = parseLedenCsv(CSV);

    expect(leden).toHaveLength(3);
    expect(leden[0]).toEqual({ naam: 'Sparc Mac', rang: 'Owner', totalXp: 1200000000, kills: 42 });
    expect(leden[2]?.rang).toBe('Recruit');
  });

  it('maakt van de harde spatie een gewone spatie', () => {
    expect(parseLedenCsv(CSV)[0]?.naam).not.toContain(' ');
  });

  it('noemt een onbekende clan bij naam in plaats van hem leeg terug te geven', () => {
    // Dit is het gevaarlijke geval: zou dit een lege lijst opleveren, dan haalt
    // de eerstvolgende synchronisatie iedereen zijn rol af.
    expect(() => parseLedenCsv('<html>No club was found with that name.</html>')).toThrow(RuneScapeFout);
    expect(() => parseLedenCsv('iets anders')).toThrow(/niet te lezen/);
  });

  it('slaat halve regels over', () => {
    expect(parseLedenCsv('Clanmate, Clan Rank, Total XP, Kills\nTess, Captain\nNoa, Recruit, 1, 0\n')).toHaveLength(1);
  });
});

describe('speler opzoeken', () => {
  it('leest de clan uit het JSONP-antwoord', () => {
    const tekst = 'jQuery([{"isSuffix":true,"recruiting":true,"name":"Sparc Mac","clan":"Bloody Mayhem","title":"the Wikian"}]);';
    expect(parseSpelerDetails(tekst)).toEqual({ naam: 'Sparc Mac', clan: 'Bloody Mayhem' });
  });

  it('geeft null bij een naam die niet bestaat', () => {
    expect(parseSpelerDetails('jQuery([]);')).toBeNull();
  });

  it('geeft clan null bij een speler zonder clan', () => {
    expect(parseSpelerDetails('jQuery([{"name":"Noa"}]);')?.clan).toBeNull();
  });

  it('weigert een naam die geen RuneScape-naam kan zijn', async () => {
    await expect(haalSpeler('een veel te lange naam')).rejects.toThrow(RuneScapeFout);
  });
});

describe('namen vergelijken', () => {
  it('ziet underscores, hoofdletters en harde spaties als hetzelfde', () => {
    expect(normaliseerNaam('Sparc_Mac')).toBe(normaliseerNaam('sparc mac'));
    expect(normaliseerNaam('  Tess  ')).toBe('tess');
  });

  it('kent de grenzen van een RuneScape-naam', () => {
    expect(geldigeNaam('Sparc Mac')).toBe(true);
    expect(geldigeNaam('dertien tekens')).toBe(false);
    expect(geldigeNaam('hoi!')).toBe(false);
  });
});

describe('ophalen', () => {
  it('haalt de lijst op en bewaart hem daarna in het geheugen', async () => {
    let keren = 0;
    const fetcher = (async () => {
      keren += 1;
      return new Response(CSV);
    }) as unknown as typeof fetch;

    const eerste = await haalLedenlijst('Bloody Mayhem', { fetcher });
    const tweede = await haalLedenlijst('bloody mayhem', { fetcher });

    expect(eerste.leden).toHaveLength(3);
    expect(eerste.uitCache).toBe(false);
    expect(tweede.uitCache).toBe(true);
    expect(keren).toBe(1);
  });

  it('haalt opnieuw op als daarom gevraagd wordt', async () => {
    let keren = 0;
    const fetcher = (async () => {
      keren += 1;
      return new Response(CSV);
    }) as unknown as typeof fetch;

    await haalLedenlijst('Bloody Mayhem', { fetcher });
    await haalLedenlijst('Bloody Mayhem', { fetcher, vers: true });
    expect(keren).toBe(2);
  });

  it('maakt van een foutcode een leesbare melding', async () => {
    await expect(haalLedenlijst('Bloody Mayhem', { fetcher: antwoord('', 503) })).rejects.toThrow(/HTTP 503/);
  });

  it('zegt het als RuneScape onbereikbaar is', async () => {
    const stuk = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;

    await expect(haalLedenlijst('Bloody Mayhem', { fetcher: stuk })).rejects.toThrow(/niet bereikbaar/);
  });
});
