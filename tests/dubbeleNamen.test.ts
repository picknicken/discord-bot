import { describe, expect, it } from 'vitest';
import { planSetup } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import { standaardInstellingen } from './helpers/snapshot.js';

/**
 * De template kent geen id's: alles gaat op naam. Staan er twee kanalen met
 * dezelfde naam, dan kiest de bot er willekeurig een, en blijft er een verschil
 * hangen dat je nergens terugvindt. Dat overkwam de testserver: de template
 * stond er twee keer op, dus ook twee keer "✅│regels", en de preview bleef
 * melden dat het regelskanaal anders was terwijl het er goed uitzag.
 */
const template = parseTemplate({
  name: 'Test',
  categories: [{ name: 'Welkom', channels: [{ name: 'regels' }] }],
});

const kanaal = (id: string, name: string, parentId: string, position: number) => ({
  id, name, type: 'text' as const, parentId, topic: null, nsfw: false,
  slowmodeSeconds: 0, userLimit: null, position, overwrites: [],
});

const server = (extra: Partial<GuildSnapshot> = {}): GuildSnapshot => ({
  id: 'g1',
  name: 'Server',
  roles: [],
  categories: [{ id: 'cat1', name: 'Welkom', position: 0, overwrites: [] }],
  channels: [kanaal('ch1', 'regels', 'cat1', 0)],
  emojis: [],
  automod: [],
  settings: standaardInstellingen,
  onboarding: null,
  rolmenus: [],
  rolmenusGelezen: true,
  ...extra,
});

const waarschuwingen = (snapshot: GuildSnapshot) =>
  planSetup(snapshot, template, { prune: false, update: true }).warnings.filter((regel) =>
    regel.startsWith('Er staan'),
  );

describe('twee keer dezelfde naam', () => {
  it('zegt niets als elke naam maar een keer voorkomt', () => {
    expect(waarschuwingen(server())).toEqual([]);
  });

  it('meldt twee kanalen met dezelfde naam', () => {
    const dubbel = server({
      categories: [
        { id: 'cat1', name: 'Welkom', position: 0, overwrites: [] },
        { id: 'cat2', name: 'Elders', position: 1, overwrites: [] },
      ],
      channels: [kanaal('ch1', 'regels', 'cat1', 0), kanaal('ch2', 'regels', 'cat2', 1)],
    });

    expect(waarschuwingen(dubbel)).toEqual([expect.stringContaining('2 kanalen met de naam "regels"')]);
  });

  it('meldt twee categorieen met dezelfde naam', () => {
    const dubbel = server({
      categories: [
        { id: 'cat1', name: 'Welkom', position: 0, overwrites: [] },
        { id: 'cat2', name: 'Welkom', position: 1, overwrites: [] },
      ],
    });

    expect(waarschuwingen(dubbel)).toEqual([expect.stringContaining('2 categorieen met de naam "Welkom"')]);
  });

  it('laat dubbele namen buiten de template met rust', () => {
    // Wat er verder in de server staat is niet onze zaak.
    const dubbel = server({
      channels: [
        kanaal('ch1', 'regels', 'cat1', 0),
        kanaal('ch2', 'memes', 'cat1', 1),
        kanaal('ch3', 'memes', 'cat1', 2),
      ],
    });

    expect(waarschuwingen(dubbel)).toEqual([]);
  });
});
