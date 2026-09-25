import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  leesGeplandeAankondigingen,
  nieuweAankondiging,
  schrijfGeplandeAankondigingen,
  welkeNu,
  type GeplandeAankondiging,
} from '../src/geplandeAankondiging.js';

/** Dezelfde opzet als de geplande uitrollen: één bestand, opgehaald door een minuuttimer. */
const aankondiging = (wanneer: string): GeplandeAankondiging =>
  nieuweAankondiging({
    wanneer,
    guildId: 'g1',
    channelId: 'c1',
    titel: 'Onderhoud',
    beschrijving: null,
    kleur: null,
    afbeelding: null,
    thumbnail: null,
    footer: null,
    door: 'test',
  });

describe('wat er aan de beurt is', () => {
  const nu = new Date('2026-09-21T03:00:00.000Z');

  it('pakt wat op dit moment moet gebeuren', () => {
    expect(welkeNu([aankondiging('2026-09-21T03:00:00.000Z')], nu)).toHaveLength(1);
  });

  it('laat staan wat nog moet komen', () => {
    expect(welkeNu([aankondiging('2026-09-22T03:00:00.000Z')], nu)).toEqual([]);
  });

  it('pakt ook op wat gemist is toen de bot uit stond', () => {
    expect(welkeNu([aankondiging('2026-09-20T03:00:00.000Z')], nu)).toHaveLength(1);
  });
});

describe('de lijst op schijf', () => {
  it('leest een lege lijst als er nog niets is', async () => {
    const map = mkdtempSync(path.join(tmpdir(), 'setup-bot-aankondiging-'));
    expect(await leesGeplandeAankondigingen(map)).toEqual([]);
    rmSync(map, { recursive: true, force: true });
  });

  it('schrijft en leest terug', async () => {
    const map = mkdtempSync(path.join(tmpdir(), 'setup-bot-aankondiging-'));
    const lijst = [aankondiging('2026-09-22T03:00:00.000Z')];

    await schrijfGeplandeAankondigingen(map, lijst);
    expect(await leesGeplandeAankondigingen(map)).toEqual(lijst);

    rmSync(map, { recursive: true, force: true });
  });

  it('geeft elke aankondiging een eigen id', () => {
    expect(aankondiging('2026-09-22T03:00:00.000Z').id).not.toBe(aankondiging('2026-09-22T03:00:00.000Z').id);
  });
});
