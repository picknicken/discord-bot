import { describe, expect, it } from 'vitest';
import { hidesFromEveryone } from '../src/applier.js';

describe('verstopte kanalen', () => {
  it('herkent een kanaal dat @everyone niet mag zien', () => {
    expect(hidesFromEveryone([{ role: '@everyone', allow: [], deny: ['ViewChannel'] }])).toBe(true);
  });

  it('kijkt alleen naar @everyone', () => {
    // Een rol uitsluiten verstopt het kanaal niet voor de bot.
    expect(hidesFromEveryone([{ role: 'lid', allow: [], deny: ['ViewChannel'] }])).toBe(false);
  });

  it('ziet een ander verbod niet aan voor onzichtbaar', () => {
    expect(hidesFromEveryone([{ role: '@everyone', allow: [], deny: ['SendMessages'] }])).toBe(false);
  });

  it('geen overwrites betekent zichtbaar', () => {
    expect(hidesFromEveryone([])).toBe(false);
  });
});
