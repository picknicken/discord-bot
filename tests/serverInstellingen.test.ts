import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  instellingenVan,
  leesServerInstellingen,
  schoonInstellingen,
  zetServerInstellingen,
} from '../src/serverInstellingen.js';

/**
 * Melden dat een server afwijkt is nuttig op een server die af is, en vervelend
 * op een server die je aan het verbouwen bent. Dus is het per server te kiezen.
 */

const dir = mkdtempSync(path.join(tmpdir(), 'serverinstellingen-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('wat er standaard geldt', () => {
  it('meldt afwijkingen, zolang je niets zegt', async () => {
    expect((await instellingenVan(dir, 'onbekend')).driftMelden).toBe(true);
  });

  it('leest een leeg bestand als "overal de standaard"', async () => {
    expect(await leesServerInstellingen(path.join(dir, 'bestaat-niet'))).toEqual({});
  });

  it('negeert rommel in het bestand', () => {
    expect(schoonInstellingen({ driftMelden: 'graag' }).driftMelden).toBe(true);
    expect(schoonInstellingen(null).driftMelden).toBe(true);
  });
});

describe('per server iets anders', () => {
  it('onthoudt dat het melden uit mag', async () => {
    await zetServerInstellingen(dir, 'g1', { driftMelden: false });
    expect((await instellingenVan(dir, 'g1')).driftMelden).toBe(false);
  });

  it('laat de andere servers met rust', async () => {
    await zetServerInstellingen(dir, 'g1', { driftMelden: false });
    await zetServerInstellingen(dir, 'g2', { driftMelden: true });

    const alles = await leesServerInstellingen(dir);
    expect(alles['g1']?.driftMelden).toBe(false);
    expect(alles['g2']?.driftMelden).toBe(true);
  });

  it('zet het ook weer aan', async () => {
    await zetServerInstellingen(dir, 'g3', { driftMelden: false });
    await zetServerInstellingen(dir, 'g3', { driftMelden: true });
    expect((await instellingenVan(dir, 'g3')).driftMelden).toBe(true);
  });

  it('struikelt niet over een kapot bestand', async () => {
    const kapot = mkdtempSync(path.join(tmpdir(), 'kapot-'));
    writeFileSync(path.join(kapot, 'server-instellingen.json'), '{ dit is geen json');

    expect((await instellingenVan(kapot, 'g1')).driftMelden).toBe(true);
    rmSync(kapot, { recursive: true, force: true });
  });
});
