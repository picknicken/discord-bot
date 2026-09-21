import { describe, expect, it } from 'vitest';
import { planRegels, planSetup } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import { standaardInstellingen } from './helpers/snapshot.js';

/**
 * De diff in het dashboard tekent zich uit deze regels. Een blok tekst laat je
 * zoeken naar wat er verdwijnt; deze regels zeggen het: plus, tilde of min, met
 * de reden erbij.
 */
const template = parseTemplate({
  name: 'Test',
  roles: [{ key: 'mod', name: 'Mod', permissions: ['KickMembers'] }],
  categories: [{ name: 'Info', channels: [{ name: 'welkom', topic: 'Hallo' }] }],
});

const leeg = {
  id: 'g1', name: 'Server', roles: [], categories: [], channels: [], emojis: [], automod: [],
  settings: standaardInstellingen, onboarding: null,
} as unknown as GuildSnapshot;

/** Een server met een kanaal dat niet in de template staat. */
const metRommel = {
  ...leeg,
  categories: [{ id: 'c1', name: 'Info', position: 0, overwrites: [] }],
  channels: [
    { id: 'c2', name: 'welkom', type: 'text', parentId: 'c1', position: 0, overwrites: [], topic: null },
    { id: 'c3', name: 'oude-troep', type: 'text', parentId: 'c1', position: 1, overwrites: [], topic: null },
  ],
} as unknown as GuildSnapshot;

describe('het plan als losse regels', () => {
  it('zet een plus bij alles wat nieuw is', () => {
    const regels = planRegels(planSetup(leeg, template, { prune: false, update: true }));

    expect(regels.find((regel) => regel.soort === 'rol')).toMatchObject({ teken: '+', naam: '@Mod' });
    expect(regels.find((regel) => regel.soort === 'categorie')).toMatchObject({ teken: '+', naam: 'Info' });
    expect(regels.find((regel) => regel.soort === 'kanaal')).toMatchObject({
      teken: '+',
      naam: 'welkom',
      type: 'text',
      onder: 'Info',
    });
  });

  it('markeert verwijderen apart, want dat krijg je niet terug', () => {
    const regels = planRegels(planSetup(metRommel, template, { prune: true, update: true }));
    const weg = regels.filter((regel) => regel.teken === '-');

    expect(weg).toHaveLength(1);
    expect(weg[0]).toMatchObject({ naam: 'oude-troep', prune: true, soort: 'kanaal' });
  });

  it('gooit zonder prune niets weg', () => {
    const regels = planRegels(planSetup(metRommel, template, { prune: false, update: true }));
    expect(regels.filter((regel) => regel.teken === '-')).toHaveLength(0);
  });

  it('zegt bij een wijziging wát er verandert', () => {
    const regels = planRegels(planSetup(metRommel, template, { prune: false, update: true }));
    const bijwerking = regels.find((regel) => regel.teken === '~' && regel.soort === 'kanaal');

    expect(bijwerking?.detail).toBeTruthy();
    expect(bijwerking?.detail).toMatch(/topic/i);
  });
});
