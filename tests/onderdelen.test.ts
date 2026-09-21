import { describe, expect, it } from 'vitest';
import { beschrijfOnderdelen, filterPlan, leesOnderdelen, onderdeelVan, ONDERDELEN, UITLEG } from '../src/onderdelen.js';
import { planSetup } from '../src/planner.js';
import type { Plan } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import { standaardInstellingen } from './helpers/snapshot.js';

const leeg: GuildSnapshot = {
  id: 'g1', name: 'Leeg', roles: [], categories: [], channels: [], emojis: [], automod: [],
  settings: standaardInstellingen, onboarding: null,
} as unknown as GuildSnapshot;

const template = parseTemplate({
  name: 'Test',
  guild: { community: true, rulesChannel: 'regels', updatesChannel: 'updates' },
  roles: [{ key: 'mod', name: 'Mod' }, { key: 'lid', name: 'Lid' }],
  categories: [
    {
      name: 'Info',
      channels: [{ name: 'regels' }, { name: 'updates' }, { name: 'nieuws', type: 'announcement' }],
    },
  ],
  automod: [{ name: 'Spam', trigger: 'spam', action: 'block' }],
});

const plan = (): Plan => planSetup(leeg, template, { prune: false, update: true });

describe('onderdelen lezen', () => {
  it('leest een lijstje', () => {
    expect(leesOnderdelen('rollen,kanalen')).toEqual(['rollen', 'kanalen']);
  });

  it('trekt zich niets aan van spaties en hoofdletters', () => {
    expect(leesOnderdelen(' Rollen , KANALEN ')).toEqual(['rollen', 'kanalen']);
  });

  it('geeft alles terug bij leeg of "alles"', () => {
    expect(leesOnderdelen(undefined)).toEqual([...ONDERDELEN]);
    expect(leesOnderdelen('alles')).toEqual([...ONDERDELEN]);
    expect(leesOnderdelen('')).toEqual([...ONDERDELEN]);
  });

  it('weigert een naam die niet bestaat', () => {
    expect(leesOnderdelen('rollen,kleuren')).toBeNull();
  });

  it('ontdubbelt', () => {
    expect(leesOnderdelen('rollen,rollen')).toEqual(['rollen']);
  });

  it('heeft bij elk onderdeel uitleg staan', () => {
    for (const onderdeel of ONDERDELEN) expect(UITLEG[onderdeel]?.length).toBeGreaterThan(10);
  });
});

describe('acties bij een onderdeel indelen', () => {
  it('deelt elke actie uit een echt plan in', () => {
    for (const action of plan().actions) {
      expect(ONDERDELEN, action.kind).toContain(onderdeelVan(action));
    }
  });

  it('zet de rolvolgorde bij de rollen en de kanaalvolgorde bij de kanalen', () => {
    expect(onderdeelVan({ kind: 'order-roles', count: 2 })).toBe('rollen');
    expect(onderdeelVan({ kind: 'order-channels', count: 2 })).toBe('kanalen');
  });

  it('zet community-modus bij de instellingen', () => {
    expect(onderdeelVan({ kind: 'guild-community' })).toBe('instellingen');
  });
});

describe('een plan filteren', () => {
  it('houdt alleen de rollen over', () => {
    const gefilterd = filterPlan(plan(), ['rollen']);
    expect(gefilterd.actions.every((action) => onderdeelVan(action) === 'rollen')).toBe(true);
    expect(gefilterd.actions.some((action) => action.kind === 'create-role')).toBe(true);
    expect(gefilterd.actions.some((action) => action.kind === 'order-roles')).toBe(true);
  });

  it('laat het volledige plan met rust als alles aan staat', () => {
    const vol = plan();
    expect(filterPlan(vol, [...ONDERDELEN]).actions).toHaveLength(vol.actions.length);
  });

  it('slaat kanalen over waarvan de categorie nog niet bestaat', () => {
    const gefilterd = filterPlan(plan(), ['kanalen']);
    expect(gefilterd.actions.some((action) => action.kind === 'create-channel')).toBe(false);
    expect(gefilterd.warnings.join(' ')).toContain('hun categorie moet nog aangemaakt worden');
  });

  it('maakt de kanalen wel samen met hun categorie', () => {
    const gefilterd = filterPlan(plan(), ['kanalen', 'categorieen']);
    expect(gefilterd.actions.filter((action) => action.kind === 'create-channel').length).toBeGreaterThan(0);
  });

  it('zegt wat er niet meegenomen is', () => {
    expect(filterPlan(plan(), ['rollen']).warnings.join(' ')).toContain('Niet meegenomen:');
  });

  it('levert een leeg plan als je niets kiest', () => {
    expect(filterPlan(plan(), []).actions).toHaveLength(0);
  });
});

describe('uitleg bij de keuze', () => {
  it('zegt het als alles meedoet', () => {
    expect(beschrijfOnderdelen([...ONDERDELEN])).toBe('Alle onderdelen.');
  });

  it('noemt anders wat er meedoet', () => {
    expect(beschrijfOnderdelen(['rollen'])).toBe('Alleen: rollen.');
  });

  it('zegt het als er niets gekozen is', () => {
    expect(beschrijfOnderdelen([])).toMatch(/Niets gekozen/);
  });
});
