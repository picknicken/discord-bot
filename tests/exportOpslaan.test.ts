import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTemplate } from '../src/types.js';
import { bewaarExport, exportId, listTemplateIds } from '../src/templates.js';

describe('export opslaan', () => {
  it('maakt een bestandsnaam uit de servernaam', () => {
    expect(exportId('Bloody Mayhem!', '1')).toBe('bloody-mayhem');
  });

  it('valt terug op het server-id als de naam niets overhoudt', () => {
    expect(exportId('🎮✨', '1538588222983250001')).toBe('server-1538588222983250001');
  });

  it('zet de export in de templates-map zonder een bestaande te overschrijven', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'export-'));
    await writeFile(path.join(dir, 'clan.json'), '{"name":"Oud"}\n', 'utf8');
    const template = parseTemplate({ name: 'Nieuw' });

    const id = await bewaarExport(dir, 'clan', template);

    expect(id).toBe('clan-2');
    expect(await listTemplateIds(dir)).toEqual(['clan', 'clan-2']);
    expect(JSON.parse(await readFile(path.join(dir, 'clan.json'), 'utf8')).name).toBe('Oud');
    expect(JSON.parse(await readFile(path.join(dir, 'clan-2.json'), 'utf8')).name).toBe('Nieuw');
  });
});
