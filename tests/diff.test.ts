import { describe, expect, it } from 'vitest';
import { describeDiff, diffTemplates, summarizeDiff } from '../src/diff.js';
import { parseTemplate } from '../src/types.js';

const basis = {
  name: 'T',
  roles: [{ key: 'lid', name: 'Lid', permissions: ['ViewChannel'] }],
  categories: [{ name: 'Cat', channels: [{ name: 'chat' }] }],
};

const eerder = parseTemplate(basis);

describe('verschil tussen twee versies', () => {
  it('ziet niets als er niets veranderde', () => {
    expect(summarizeDiff(diffTemplates(eerder, parseTemplate(basis)))).toBe('');
  });

  it('ziet een rol erbij', () => {
    const later = parseTemplate({ ...basis, roles: [...basis.roles, { key: 'mod', name: 'Mod' }] });
    expect(summarizeDiff(diffTemplates(eerder, later))).toBe('1 rol erbij');
  });

  it('ziet een kanaal weg en een categorie erbij', () => {
    const later = parseTemplate({
      ...basis,
      categories: [{ name: 'Cat', channels: [] }, { name: 'Nieuw', channels: [] }],
    });
    expect(summarizeDiff(diffTemplates(eerder, later))).toBe('1 categorie erbij · 1 kanaal weg');
  });

  it('ziet een rol die is aangepast', () => {
    const later = parseTemplate({
      ...basis,
      roles: [{ key: 'lid', name: 'Lid', permissions: ['ViewChannel', 'SendMessages'] }],
    });
    const diff = diffTemplates(eerder, later);
    expect(diff.rolesChanged).toEqual(['Lid']);
    expect(summarizeDiff(diff)).toBe('1 rol aangepast');
  });

  it('ziet gewijzigde serverinstellingen', () => {
    const later = parseTemplate({ ...basis, guild: { systemChannel: 'chat' } });
    expect(summarizeDiff(diffTemplates(eerder, later))).toContain('serverinstellingen');
  });

  it('schrijft de regels uit', () => {
    const later = parseTemplate({ ...basis, roles: [...basis.roles, { key: 'mod', name: 'Mod' }] });
    expect(describeDiff(diffTemplates(eerder, later))).toEqual(['+ rol @Mod']);
  });
});
