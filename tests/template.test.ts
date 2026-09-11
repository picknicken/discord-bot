import { describe, expect, it } from 'vitest';
import { parseTemplate } from '../src/types.js';
import { toBitfield, toNames, unknownPermissions } from '../src/permissions.js';
import { loadAllTemplates } from '../src/templates.js';

describe('templateschema', () => {
  it('vult standaardwaarden aan', () => {
    const template = parseTemplate({ name: 'Minimaal' });
    expect(template.roles).toEqual([]);
    expect(template.categories).toEqual([]);
    expect(template.description).toBe('');
  });

  it('weigert onbekende permissies', () => {
    expect(() =>
      parseTemplate({ name: 'X', roles: [{ key: 'a', name: 'A', permissions: ['SendMissiles'] }] }),
    ).toThrow(/Onbekende permissie/);
  });

  it('weigert overwrites naar niet-bestaande rollen', () => {
    expect(() =>
      parseTemplate({
        name: 'X',
        categories: [{ name: 'Cat', channels: [{ name: 'chan', overwrites: [{ role: 'spook' }] }] }],
      }),
    ).toThrow(/onbekende rol/);
  });

  it('accepteert @everyone zonder roldefinitie', () => {
    const template = parseTemplate({
      name: 'X',
      categories: [{ name: 'Cat', overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }] }],
    });
    expect(template.categories[0]?.overwrites[0]?.role).toBe('@everyone');
  });

  it('weigert dubbele rol-keys', () => {
    expect(() =>
      parseTemplate({ name: 'X', roles: [{ key: 'a', name: 'A' }, { key: 'a', name: 'B' }] }),
    ).toThrow(/dubbele rol-key/);
  });

  it('weigert een ongeldige kleur', () => {
    expect(() => parseTemplate({ name: 'X', roles: [{ key: 'a', name: 'A', color: 'rood' }] })).toThrow(/hexwaarde/);
  });
});

describe('permissies', () => {
  it('vertaalt heen en weer', () => {
    const names = ['ViewChannel', 'SendMessages'];
    expect(toNames(toBitfield(names)).sort()).toEqual([...names].sort());
  });

  it('herkent onbekende namen', () => {
    expect(unknownPermissions(['ViewChannel', 'Nonsense'])).toEqual(['Nonsense']);
  });
});

describe('meegeleverde templates', () => {
  it('zijn allemaal geldig', async () => {
    const templates = await loadAllTemplates('./templates');
    expect(templates.length).toBeGreaterThan(0);
    for (const { id, template } of templates) {
      expect(template.name, `${id} heeft een naam`).toBeTruthy();
      expect(template.roles.length, `${id} heeft rollen`).toBeGreaterThan(0);
    }
  });
});
