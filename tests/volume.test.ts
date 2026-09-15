import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zaaiTemplates } from '../src/templates.js';

/**
 * Een volume begint leeg. Zonder klaarzetten staat er dan niets om uit te
 * rollen, en met te gretig klaarzetten ben je bij elke herstart je eigen
 * aanpassingen kwijt.
 */
describe('templates klaarzetten op een leeg volume', () => {
  it('kopieert de meegeleverde templates naar een lege map', async () => {
    const doel = path.join(mkdtempSync(path.join(tmpdir(), 'volume-')), 'templates');

    const gezaaid = await zaaiTemplates(doel);

    expect(gezaaid).toContain('community');
    expect(readdirSync(doel).filter((naam) => naam.endsWith('.json')).length).toBe(gezaaid.length);
  });

  it('laat een map met templates met rust', async () => {
    const doel = mkdtempSync(path.join(tmpdir(), 'volume-vol-'));
    writeFileSync(path.join(doel, 'eigen.json'), '{"name":"Van mij"}');

    expect(await zaaiTemplates(doel)).toEqual([]);
    expect(readdirSync(doel)).toEqual(['eigen.json']);
  });

  it('doet niets als bron en doel dezelfde map zijn', async () => {
    expect(await zaaiTemplates('./templates')).toEqual([]);
  });

  it('klapt niet als de bronmap niet bestaat', async () => {
    const doel = path.join(mkdtempSync(path.join(tmpdir(), 'volume-nobron-')), 'templates');
    expect(await zaaiTemplates(doel, './bestaat-niet')).toEqual([]);
  });
});

describe('paden volgen het volume', () => {
  it('zet templates, back-ups en geschiedenis op het volume', async () => {
    const volume = mkdtempSync(path.join(tmpdir(), 'railway-'));
    mkdirSync(path.join(volume, 'templates'), { recursive: true });

    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = '123456789';
    process.env.RAILWAY_VOLUME_MOUNT_PATH = volume;
    delete process.env.TEMPLATES_DIR;
    delete process.env.BACKUPS_DIR;
    delete process.env.HISTORY_DIR;

    const { config } = await import('../src/config.js');

    expect(config.templatesDir).toBe(`${volume}/templates`);
    expect(config.backupsDir).toBe(`${volume}/backups`);
    expect(config.historyDir).toBe(`${volume}/history`);
  });
});
