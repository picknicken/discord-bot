import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { alleenVerschil, bouwOp, eersteVerschil, gelijk, past, type Ruw } from '../src/overerven.js';
import { loadTemplateMet, ruweTemplate, templateUitJson } from '../src/templates.js';

/**
 * Twee servers die op elkaar lijken hoor je niet twee keer te onderhouden. Een
 * template met een basis schrijft alleen nog op wat er anders is.
 */

const basis: Ruw = {
  name: 'basis',
  guild: { verificationLevel: 'low', description: 'Onze server' },
  roles: [
    { key: 'team', name: 'Team', color: '#5865F2', permissions: ['ManageMessages'] },
    { key: 'lid', name: 'Lid' },
  ],
  categories: [
    {
      name: 'Algemeen',
      channels: [
        { name: 'welkom', topic: 'Hallo' },
        { name: 'chat' },
      ],
    },
  ],
  uncategorizedChannels: [{ name: 'regels' }],
};

describe('een template die op een andere voortbouwt', () => {
  it('neemt alles over wat het kind niet noemt', () => {
    const uit = bouwOp(basis, { name: 'kind' });
    expect(uit['roles']).toEqual(basis['roles']);
    expect(uit['name']).toBe('kind');
  });

  it('past één rol aan zonder de rest over te schrijven', () => {
    const uit = bouwOp(basis, { roles: [{ key: 'team', color: '#ED4245' }] }) as Ruw;
    const rollen = uit['roles'] as Ruw[];
    expect(rollen).toHaveLength(2);
    expect(rollen[0]).toEqual({ key: 'team', name: 'Team', color: '#ED4245', permissions: ['ManageMessages'] });
  });

  it('vervangt een lijst met waarden in zijn geheel', () => {
    const uit = bouwOp(basis, { roles: [{ key: 'team', permissions: ['BanMembers'] }] }) as Ruw;
    expect((uit['roles'] as Ruw[])[0]?.['permissions']).toEqual(['BanMembers']);
  });

  it('zet nieuwe dingen achteraan en laat de volgorde van de basis staan', () => {
    const uit = bouwOp(basis, { roles: [{ key: 'gast', name: 'Gast' }] }) as Ruw;
    expect((uit['roles'] as Ruw[]).map((rol) => rol['key'])).toEqual(['team', 'lid', 'gast']);
  });

  it('voegt een kanaal toe aan een categorie die de basis al heeft', () => {
    const uit = bouwOp(basis, {
      categories: [{ name: 'Algemeen', channels: [{ name: 'memes' }] }],
    }) as Ruw;
    const categorieen = uit['categories'] as Ruw[];
    expect(categorieen).toHaveLength(1);
    expect((categorieen[0]?.['channels'] as Ruw[]).map((kanaal) => kanaal['name'])).toEqual([
      'welkom',
      'chat',
      'memes',
    ]);
  });

  it('houdt wat de basis in een kanaal zette', () => {
    const uit = bouwOp(basis, {
      categories: [{ name: 'Algemeen', channels: [{ name: 'welkom', nsfw: false, slowmodeSeconds: 5 }] }],
    }) as Ruw;
    const kanaal = ((uit['categories'] as Ruw[])[0]?.['channels'] as Ruw[])[0];
    expect(kanaal).toEqual({ name: 'welkom', topic: 'Hallo', nsfw: false, slowmodeSeconds: 5 });
  });

  it('vult de instellingen aan in plaats van ze te vervangen', () => {
    const uit = bouwOp(basis, { guild: { verificationLevel: 'high' } }) as Ruw;
    expect(uit['guild']).toEqual({ verificationLevel: 'high', description: 'Onze server' });
  });
});

describe('weghalen wat de basis wel heeft', () => {
  it('haalt een rol weg', () => {
    const uit = bouwOp(basis, { verwijder: { roles: ['lid'] } }) as Ruw;
    expect((uit['roles'] as Ruw[]).map((rol) => rol['key'])).toEqual(['team']);
  });

  it('haalt een kanaal weg, waar het ook staat', () => {
    const uit = bouwOp(basis, { verwijder: { channels: ['chat', 'regels'] } }) as Ruw;
    expect((uit['categories'] as Ruw[])[0]?.['channels']).toEqual([{ name: 'welkom', topic: 'Hallo' }]);
    expect(uit['uncategorizedChannels']).toEqual([]);
  });

  it('klaagt over een naam die de basis niet kent', () => {
    expect(() => bouwOp(basis, { verwijder: { roles: ['vip'] } })).toThrow(/staat niet in de basis/);
  });

  it('klaagt over een soort die niet bestaat', () => {
    expect(() => bouwOp(basis, { verwijder: { rollen: ['team'] } })).toThrow(/kent "rollen" niet/);
  });

  it('haalt weg voordat het kind erbij komt, zodat je iets kunt vervangen', () => {
    const uit = bouwOp(basis, {
      verwijder: { roles: ['team'] },
      roles: [{ key: 'team', name: 'Crew' }],
    }) as Ruw;
    expect(uit['roles']).toEqual([{ key: 'lid' , name: 'Lid' }, { key: 'team', name: 'Crew' }]);
  });
});

describe('de andere kant op: alleen het verschil opschrijven', () => {
  const rond = (volledig: Ruw): Ruw => {
    const kind = alleenVerschil(basis, volledig);
    expect(past(basis, kind, volledig)).toBe(true);
    return kind;
  };

  it('schrijft niets op als er niets anders is', () => {
    expect(rond(basis)).toEqual({});
  });

  it('schrijft alleen de rol op die veranderd is', () => {
    const volledig = JSON.parse(JSON.stringify(basis)) as Ruw;
    (volledig['roles'] as Ruw[])[0]!['color'] = '#ED4245';
    expect(rond(volledig)).toEqual({ roles: [{ key: 'team', color: '#ED4245' }] });
  });

  it('zet weggehaalde dingen onder verwijder', () => {
    const volledig = JSON.parse(JSON.stringify(basis)) as Ruw;
    volledig['roles'] = (volledig['roles'] as Ruw[]).filter((rol) => rol['key'] !== 'lid');
    expect(rond(volledig)).toEqual({ verwijder: { roles: ['lid'] } });
  });

  it('noemt de kanalen van een weggehaalde categorie niet apart', () => {
    const volledig = JSON.parse(JSON.stringify(basis)) as Ruw;
    volledig['categories'] = [];
    expect(rond(volledig)).toEqual({ verwijder: { categories: ['Algemeen'] } });
  });

  it('geeft aan dat een andere volgorde niet in een basis past', () => {
    const volledig = JSON.parse(JSON.stringify(basis)) as Ruw;
    volledig['roles'] = [(basis['roles'] as Ruw[])[1], (basis['roles'] as Ruw[])[0]];
    expect(past(basis, alleenVerschil(basis, volledig), volledig)).toBe(false);
  });
});

describe('vergelijken', () => {
  it('trekt zich niets aan van de volgorde van de sleutels', () => {
    expect(gelijk({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
  });

  it('ziet een lijst in een andere volgorde wel als verschil', () => {
    expect(gelijk([1, 2], [2, 1])).toBe(false);
  });
});

describe('van schijf', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overerven-'));
  const schrijf = (id: string, data: unknown): void =>
    writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2));

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  schrijf('standaard', {
    name: 'Standaard',
    variables: { clan: { standaard: 'Picknicken' } },
    roles: [{ key: 'team', name: '{{clan}} Team' }],
    categories: [{ name: 'Algemeen', channels: [{ name: 'chat' }] }],
  });
  schrijf('variant', { basis: 'standaard', name: 'Variant', roles: [{ key: 'gast', name: 'Gast' }] });
  schrijf('kleinkind', { basis: 'variant', verwijder: { channels: ['chat'] } });
  schrijf('rondje', { basis: 'rondje-terug', name: 'Rondje' });
  schrijf('rondje-terug', { basis: 'rondje', name: 'Terug' });
  schrijf('zonder-basis', { name: 'Los', verwijder: { roles: ['team'] } });

  it('laadt een template met een basis als één geheel', async () => {
    const { template } = await loadTemplateMet(dir, 'variant');
    expect(template.name).toBe('Variant');
    expect(template.roles.map((rol) => rol.key)).toEqual(['team', 'gast']);
  });

  it('vult de variabelen van de basis in', async () => {
    const { template, gebruikt } = await loadTemplateMet(dir, 'variant', { clan: 'Testclan' });
    expect(template.roles[0]?.name).toBe('Testclan Team');
    expect(gebruikt).toEqual({ clan: 'Testclan' });
  });

  it('volgt de rij tot bovenaan', async () => {
    const { template } = await loadTemplateMet(dir, 'kleinkind');
    expect(template.roles.map((rol) => rol.key)).toEqual(['team', 'gast']);
    expect(template.categories[0]?.channels).toEqual([]);
  });

  it('stopt als de basis rondloopt', async () => {
    await expect(ruweTemplate(dir, 'rondje')).rejects.toThrow(/loopt rond/);
  });

  it('zegt het als de basis niet bestaat', async () => {
    schrijf('kwijt', { basis: 'bestaat-niet', name: 'Kwijt' });
    await expect(loadTemplateMet(dir, 'kwijt')).rejects.toThrow(/bestaat niet/);
  });

  it('staat verwijder niet toe zonder basis', async () => {
    await expect(loadTemplateMet(dir, 'zonder-basis')).rejects.toThrow(/alleen in een template met een "basis"/);
  });

  it('controleert JSON uit de editor mét de basis erbij', async () => {
    const template = await templateUitJson(dir, JSON.stringify({ basis: 'standaard', name: 'Uit de editor' }));
    expect(template.name).toBe('Uit de editor');
    expect(template.roles.map((rol) => rol.key)).toEqual(['team']);
  });
});

describe('waar het misgaat', () => {
  it('wijst de eerste plek aan die niet klopt', () => {
    expect(eersteVerschil({ guild: { verificationLevel: 'low' } }, { guild: { verificationLevel: 'high' } })).toBe(
      'guild.verificationLevel',
    );
  });

  it('telt een sleutel zonder waarde niet mee', () => {
    expect(eersteVerschil({ naam: 'a', icoon: undefined }, { naam: 'a' })).toBeNull();
  });

  it('zegt het als een lijst een andere lengte heeft', () => {
    expect(eersteVerschil({ roles: [1] }, { roles: [1, 2] })).toContain('1 tegen 2');
  });
});
