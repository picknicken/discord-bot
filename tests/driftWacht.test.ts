import { describe, expect, it } from 'vitest';
import { driftEmbed, magMelden, type Gemeld } from '../src/driftWacht.js';
import type { DriftStatus } from '../src/drift.js';

/**
 * Dezelfde afwijking elke dag opnieuw melden is geen melding meer maar behang.
 * Dus: alleen als er iets verandert - en dat geldt ook voor de andere kant op,
 * want "het klopt weer" wil je net zo goed weten.
 */
const status = (extra: Partial<DriftStatus> = {}): DriftStatus => ({
  guildId: 'g1',
  guildName: 'Testserver',
  template: 'community',
  count: 3,
  samenvatting: '3x kanaal aanmaken',
  ...extra,
});

const eerder = (extra: Partial<Gemeld> = {}): Gemeld => ({
  template: 'community',
  count: 3,
  at: '2026-09-20T10:00:00.000Z',
  ...extra,
});

describe('wanneer meldt hij iets', () => {
  it('zwijgt over een server waar nog nooit iets op ging', () => {
    expect(magMelden(undefined, status({ template: null, count: null }))).toBe(false);
  });

  it('zwijgt als het niet te bepalen was', () => {
    expect(magMelden(undefined, status({ count: null, fout: 'template is stuk' }))).toBe(false);
  });

  it('zwijgt over een server die gewoon klopt', () => {
    expect(magMelden(undefined, status({ count: 0 }))).toBe(false);
  });

  it('meldt een afwijking die er nog niet was', () => {
    expect(magMelden(undefined, status())).toBe(true);
  });

  it('zwijgt als er sinds de vorige keer niets veranderd is', () => {
    expect(magMelden(eerder(), status())).toBe(false);
  });

  it('meldt het als de afwijking groter of kleiner wordt', () => {
    expect(magMelden(eerder(), status({ count: 5 }))).toBe(true);
    expect(magMelden(eerder(), status({ count: 1 }))).toBe(true);
  });

  it('meldt het als het weer klopt', () => {
    expect(magMelden(eerder(), status({ count: 0 }))).toBe(true);
  });

  it('meldt het als er een andere template op ging', () => {
    expect(magMelden(eerder(), status({ template: 'gaming' }))).toBe(true);
  });
});

describe('wat er in de server komt te staan', () => {
  it('zegt hoeveel er openstaat, met de samenvatting erbij', () => {
    const embed = driftEmbed(status()).toJSON();

    expect(embed.title).toContain('wijkt af');
    expect(embed.description).toContain('3 dingen');
    expect(embed.description).toContain('3x kanaal aanmaken');
  });

  it('heeft een ander bericht als het weer klopt', () => {
    const embed = driftEmbed(status({ count: 0, samenvatting: null })).toJSON();

    expect(embed.title).toContain('weer overeen');
    expect(embed.description).toContain('community');
  });
});
