import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maakSamenvatting, schrijfSamenvatting } from '../src/util/samenvatting.js';

describe('samenvatting boven aan de run', () => {
  it('zet de kop en de regels onder elkaar', () => {
    expect(maakSamenvatting({ kop: 'Bedrijf op Testserver', regels: ['24 acties gelukt, 0 mislukt'] })).toBe(
      '## Bedrijf op Testserver\n\n- 24 acties gelukt, 0 mislukt\n',
    );
  });

  it('zet wat aandacht vraagt onder een eigen kopje', () => {
    const tekst = maakSamenvatting({ kop: 'X', regels: ['klaar'], letop: ['rolvolgorde niet gezet'] });
    expect(tekst).toContain('### Let op');
    expect(tekst).toContain('- rolvolgorde niet gezet');
  });

  it('laat het kopje weg als er niets aan de hand is', () => {
    expect(maakSamenvatting({ kop: 'X', regels: ['klaar'] })).not.toContain('Let op');
  });
});

describe('wegschrijven', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'samenvatting-'));
  });

  afterEach(async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    await rm(dir, { recursive: true, force: true });
  });

  it('schrijft naar het bestand dat GitHub aanwijst', async () => {
    const doel = path.join(dir, 'summary.md');
    process.env.GITHUB_STEP_SUMMARY = doel;

    await schrijfSamenvatting({ kop: 'Klaar', regels: ['alles goed'] });
    expect(await readFile(doel, 'utf8')).toContain('## Klaar');
  });

  it('doet niets buiten GitHub Actions', async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    await expect(schrijfSamenvatting({ kop: 'Klaar', regels: [] })).resolves.toBeUndefined();
  });

  it('laat de run niet klappen als het bestand niet kan', async () => {
    process.env.GITHUB_STEP_SUMMARY = path.join(dir, 'bestaat', 'niet', 'summary.md');
    await expect(schrijfSamenvatting({ kop: 'Klaar', regels: [] })).resolves.toBeUndefined();
  });
});
