import { beforeEach, describe, expect, it } from 'vitest';
import {
  geldigeNaam,
  haalGroep,
  haalSpelerClans,
  leegClanCache,
  netteRang,
  normaliseerNaam,
  parseGroep,
  parseSpelerClans,
  parseZoekresultaat,
  WomFout,
  zoekGroepen,
} from '../src/clan/wiseoldman.js';

/**
 * WiseOldMan is de enige plek waar de clanrangen van OSRS te halen zijn. Deze
 * tests leggen vast wat hun antwoorden betekenen, zodat het meteen opvalt als
 * ze ooit iets anders gaan sturen.
 */

const GROEP = {
  id: 139,
  name: 'Mijn Clan',
  clanChat: 'mijnclan',
  memberships: [
    { role: 'owner', player: { username: 'tess', displayName: 'Tess' } },
    { role: 'deputy_owner', player: { username: 'sparc mac', displayName: 'Sparc Mac' } },
    { role: null, player: { username: 'noa', displayName: 'Noa' } },
  ],
};

const antwoord = (waarde: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(waarde), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

beforeEach(() => leegClanCache());

describe('ledenlijst lezen', () => {
  it('leest namen en rangen', () => {
    const groep = parseGroep(GROEP);

    expect(groep).toMatchObject({ id: 139, naam: 'Mijn Clan' });
    expect(groep.leden).toEqual([
      { naam: 'Tess', rang: 'owner' },
      { naam: 'Sparc Mac', rang: 'deputy_owner' },
      { naam: 'Noa', rang: 'member' },
    ]);
  });

  it('noemt het als de ledenlijst niet meekomt', () => {
    // Zou dit een lege clan opleveren, dan haalt de eerstvolgende
    // synchronisatie iedereen zijn rol af.
    expect(() => parseGroep({ id: 1, name: 'Leeg' })).toThrow(/ledenlijst/);
    expect(() => parseGroep({ boodschap: 'nope' })).toThrow(WomFout);
  });

  it('slaat leden zonder naam over', () => {
    const groep = parseGroep({ ...GROEP, memberships: [{ role: 'owner', player: {} }] });
    expect(groep.leden).toEqual([]);
  });
});

describe('zoeken en opzoeken', () => {
  it('leest de zoeklijst', () => {
    const gevonden = parseZoekresultaat([
      { id: 139, name: 'Mijn Clan', memberCount: 42, clanChat: 'mijnclan' },
      { id: 140, name: 'Andere Clan', memberCount: 7, clanChat: null },
      { rommel: true },
    ]);

    expect(gevonden).toHaveLength(2);
    expect(gevonden[0]).toEqual({ id: 139, naam: 'Mijn Clan', aantal: 42, clanChat: 'mijnclan' });
  });

  it('leest in welke clans een speler zit', () => {
    const clans = parseSpelerClans([
      { role: 'captain', group: { id: 139, name: 'Mijn Clan' } },
      { role: null, group: { id: 140, name: 'Andere Clan' } },
    ]);

    expect(clans).toEqual([
      { groupId: 139, naam: 'Mijn Clan', rang: 'captain' },
      { groupId: 140, naam: 'Andere Clan', rang: 'member' },
    ]);
  });

  it('weigert een naam die geen OSRS-naam kan zijn', async () => {
    await expect(haalSpelerClans('een veel te lange naam')).rejects.toThrow(WomFout);
  });

  it('zoekt op naam', async () => {
    const gevonden = await zoekGroepen('mijn', {
      fetcher: antwoord([{ id: 139, name: 'Mijn Clan', memberCount: 42 }]),
    });

    expect(gevonden[0]?.naam).toBe('Mijn Clan');
  });
});

describe('namen en rangen tonen', () => {
  it('ziet underscores, hoofdletters en spaties als hetzelfde', () => {
    expect(normaliseerNaam('Sparc_Mac')).toBe(normaliseerNaam('sparc mac'));
    expect(normaliseerNaam('  Tess  ')).toBe('tess');
  });

  it('kent de grenzen van een OSRS-naam', () => {
    expect(geldigeNaam('Sparc Mac')).toBe(true);
    expect(geldigeNaam('dertien tekens')).toBe(false);
    expect(geldigeNaam('hoi!')).toBe(false);
  });

  it('schrijft een rang leesbaar op', () => {
    expect(netteRang('deputy_owner')).toBe('Deputy owner');
    expect(netteRang('owner')).toBe('Owner');
  });
});

describe('ophalen', () => {
  it('haalt de groep op en bewaart hem daarna in het geheugen', async () => {
    let keren = 0;
    const fetcher = (async () => {
      keren += 1;
      return new Response(JSON.stringify(GROEP));
    }) as unknown as typeof fetch;

    const eerste = await haalGroep(139, { fetcher });
    const tweede = await haalGroep(139, { fetcher });

    expect(eerste.leden).toHaveLength(3);
    expect(eerste.uitCache).toBe(false);
    expect(tweede.uitCache).toBe(true);
    expect(keren).toBe(1);
  });

  it('haalt opnieuw op als daarom gevraagd wordt', async () => {
    let keren = 0;
    const fetcher = (async () => {
      keren += 1;
      return new Response(JSON.stringify(GROEP));
    }) as unknown as typeof fetch;

    await haalGroep(139, { fetcher });
    await haalGroep(139, { fetcher, vers: true });
    expect(keren).toBe(2);
  });

  it('weigert een clan-nummer dat geen nummer is', async () => {
    await expect(haalGroep(Number('geen getal'))).rejects.toThrow(/clan-nummer/);
  });

  it('zegt het als de clan niet bestaat', async () => {
    await expect(haalGroep(139, { fetcher: antwoord({}, 404) })).rejects.toThrow(/kent die clan of naam niet/);
  });

  it('zegt het als WiseOldMan even niets meer toelaat', async () => {
    await expect(haalGroep(139, { fetcher: antwoord({}, 429) })).rejects.toThrow(/over een minuut/);
  });

  it('zegt het als WiseOldMan onbereikbaar is', async () => {
    const stuk = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;

    await expect(haalGroep(139, { fetcher: stuk })).rejects.toThrow(/niet bereikbaar/);
  });

  it('stuurt de sleutel mee als die er is', async () => {
    const gezien: Array<Record<string, string>> = [];
    const fetcher = (async (_url: string, opties: { headers: Record<string, string> }) => {
      gezien.push(opties.headers);
      return new Response(JSON.stringify(GROEP));
    }) as unknown as typeof fetch;

    process.env.WOM_API_KEY = 'geheim';
    await haalGroep(139, { fetcher });
    delete process.env.WOM_API_KEY;
    await haalGroep(139, { fetcher, vers: true });

    expect(gezien[0]?.['x-api-key']).toBe('geheim');
    expect(gezien[1]?.['x-api-key']).toBeUndefined();
  });
});
