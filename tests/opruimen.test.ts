import { SnowflakeUtil } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { dagenGeleden, laatsteBericht, stilleKanalen } from '../src/opruimen.js';

/**
 * Een server groeit dicht met kanalen waar niets meer gebeurt. Niets daarvan is
 * kapot, dus niemand ruimt het op - je komt er alleen achter als je er expres
 * naar gaat zoeken.
 */
const nu = new Date('2026-09-21T12:00:00.000Z');
const idVan = (datum: string) => String(SnowflakeUtil.generate({ timestamp: new Date(datum).getTime() }));

describe('wanneer was het laatste bericht', () => {
  it('leest het tijdstip uit het bericht-id', () => {
    const wanneer = laatsteBericht(idVan('2026-07-01T10:00:00.000Z'));

    expect(wanneer?.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(dagenGeleden(wanneer as Date, nu)).toBe(82);
  });

  it('zegt niets als er nooit een bericht was', () => {
    expect(laatsteBericht(null)).toBeNull();
    expect(laatsteBericht(undefined)).toBeNull();
  });
});

describe('stille kanalen', () => {
  it('noemt een kanaal waar het lang stil is, met hoe lang', () => {
    const punten = stilleKanalen([{ name: 'oud-nieuws', lastMessageId: idVan('2026-06-01T10:00:00.000Z') }], nu, 60);

    expect(punten).toEqual([{ soort: 'kanaal', naam: 'oud-nieuws', waarom: 'al 112 dagen stil' }]);
  });

  it('laat een kanaal waar gepraat wordt met rust', () => {
    expect(stilleKanalen([{ name: 'algemeen', lastMessageId: idVan('2026-09-20T10:00:00.000Z') }], nu, 60)).toEqual([]);
  });

  it('zegt er apart bij dat er nooit iets in gezegd is', () => {
    // Dat is iets anders dan "ooit druk, nu stil", en het verschil bepaalt of je
    // het kanaal weggooit of nieuw leven inblaast.
    expect(stilleKanalen([{ name: 'leeg', lastMessageId: null }], nu, 60)).toEqual([
      { soort: 'kanaal', naam: 'leeg', waarom: 'nog nooit een bericht' },
    ]);
  });

  it('houdt zich aan de grens die je opgeeft', () => {
    const kanaal = [{ name: 'soms', lastMessageId: idVan('2026-09-01T10:00:00.000Z') }];

    expect(stilleKanalen(kanaal, nu, 60)).toEqual([]);
    expect(stilleKanalen(kanaal, nu, 14)).toHaveLength(1);
  });
});
