import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { leesGepland, nieuweUitrol, schrijfGepland, welkeNu, type GeplandeUitrol } from '../src/gepland.js';

/**
 * Dertig kanalen aanmaken terwijl iedereen online is hoeft niet; de bot werkt
 * 's nachts net zo hard. De lijst staat op schijf, want een herstart is precies
 * het moment waarop je erop rekent.
 */
const uitrol = (wanneer: string): GeplandeUitrol =>
  nieuweUitrol({
    wanneer,
    templateId: 'community',
    guildIds: ['g1'],
    guildNamen: ['Testserver'],
    prune: false,
    update: true,
    onderdelen: ['rollen'],
    variabelen: {},
    door: 'test',
  });

describe('wat er aan de beurt is', () => {
  const nu = new Date('2026-09-21T03:00:00.000Z');

  it('pakt wat op dit moment moet gebeuren', () => {
    expect(welkeNu([uitrol('2026-09-21T03:00:00.000Z')], nu)).toHaveLength(1);
  });

  it('laat staan wat nog moet komen', () => {
    expect(welkeNu([uitrol('2026-09-22T03:00:00.000Z')], nu)).toEqual([]);
  });

  it('pakt ook op wat gemist is toen de bot uit stond', () => {
    // Anders verdwijnt een geplande uitrol stilletjes omdat er net een deploy
    // liep - en dat is precies wanneer je erop rekent.
    expect(welkeNu([uitrol('2026-09-20T03:00:00.000Z')], nu)).toHaveLength(1);
  });
});

describe('de lijst op schijf', () => {
  it('leest een lege lijst als er nog niets is', async () => {
    const map = mkdtempSync(path.join(tmpdir(), 'setup-bot-gepland-'));
    expect(await leesGepland(map)).toEqual([]);
    rmSync(map, { recursive: true, force: true });
  });

  it('schrijft en leest terug', async () => {
    const map = mkdtempSync(path.join(tmpdir(), 'setup-bot-gepland-'));
    const lijst = [uitrol('2026-09-22T03:00:00.000Z')];

    await schrijfGepland(map, lijst);
    expect(await leesGepland(map)).toEqual(lijst);

    rmSync(map, { recursive: true, force: true });
  });

  it('geeft elke uitrol een eigen id', () => {
    expect(uitrol('2026-09-22T03:00:00.000Z').id).not.toBe(uitrol('2026-09-22T03:00:00.000Z').id);
  });
});
