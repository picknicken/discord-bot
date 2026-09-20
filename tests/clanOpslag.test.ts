import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alGekoppeldAan,
  koppel,
  koppelingenVan,
  leesDossier,
  lijstDossiers,
  noteerRangen,
  ontkoppel,
  wijzigDossier,
  zetInstellingen,
} from '../src/clan/opslag.js';
import { parseClanInstellingen } from '../src/clan/rangen.js';

/** Wat er per server op schijf staat: de clan, de rangrollen en wie wie is. */
describe('clandossier', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'clan-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('geeft een leeg dossier terug voor een server die er nog niet is', async () => {
    const dossier = await leesDossier(dir, '123456789');
    expect(dossier.instellingen.clans).toEqual([]);
    expect(dossier.koppelingen).toEqual({});
  });

  it('bewaart instellingen en leest ze terug', async () => {
    await zetInstellingen(
      dir,
      '123456789',
      parseClanInstellingen({ clans: [{ groupId: 139, naam: 'Mijn Clan', lidRol: '42' }], gastRol: '43' }),
    );

    const instellingen = (await leesDossier(dir, '123456789')).instellingen;
    expect(instellingen.clans[0]).toMatchObject({ groupId: 139, naam: 'Mijn Clan', lidRol: '42' });
    expect(instellingen.gastRol).toBe('43');
  });

  it('koppelt en ontkoppelt een lid', async () => {
    await koppel(dir, '123456789', '1', 'Sparc Mac', 'zelf');
    expect(koppelingenVan(await leesDossier(dir, '123456789'))).toEqual([{ discordId: '1', rsn: 'Sparc Mac' }]);

    expect(await ontkoppel(dir, '123456789', '1')).toBe(true);
    expect(await ontkoppel(dir, '123456789', '1')).toBe(false);
    expect(koppelingenVan(await leesDossier(dir, '123456789'))).toEqual([]);
  });

  it('onthoudt waar een lid voor het laatst gezien is', async () => {
    await koppel(dir, '123456789', '1', 'Sparc Mac', 'zelf');
    await noteerRangen(dir, '123456789', [
      { discordId: '1', gevonden: [{ groupId: 139, clan: 'Mijn Clan', rang: 'owner' }] },
    ]);

    const dossier = await leesDossier(dir, '123456789');
    expect(dossier.koppelingen['1']?.gezien).toEqual([{ groupId: 139, clan: 'Mijn Clan', rang: 'owner' }]);
    expect(dossier.koppelingen['1']?.gezienOp).not.toBeNull();
    expect(dossier.laatsteSync).not.toBeNull();
  });

  it('zet de klok alleen bij een ronde langs iedereen', async () => {
    await koppel(dir, '123456789', '1', 'Sparc Mac', 'zelf');
    await noteerRangen(
      dir,
      '123456789',
      [{ discordId: '1', gevonden: [{ groupId: 139, clan: 'Mijn Clan', rang: 'owner' }] }],
      { volledig: false },
    );

    const dossier = await leesDossier(dir, '123456789');
    expect(dossier.koppelingen['1']?.gezien).toHaveLength(1);
    // Eén lid dat zichzelf koppelt zegt niets over de rest van de server.
    expect(dossier.laatsteSync).toBeNull();
  });

  it('ziet dezelfde naam met een underscore als bezet', async () => {
    await koppel(dir, '123456789', '1', 'Sparc Mac', 'zelf');
    const dossier = await leesDossier(dir, '123456789');

    expect(alGekoppeldAan(dossier, 'sparc_mac', '2')).toBe('1');
    // Jezelf opnieuw koppelen mag wel; dat is een correctie, geen botsing.
    expect(alGekoppeldAan(dossier, 'Sparc Mac', '1')).toBeNull();
  });

  it('laat twee wijzigingen tegelijk niet over elkaar heen schrijven', async () => {
    // Het dashboard en een lid met /clan koppel kunnen op hetzelfde moment
    // binnenkomen; zonder de rij eromheen wint de laatste en is de eerste weg.
    await Promise.all([
      koppel(dir, '123456789', '1', 'Sparc Mac', 'zelf'),
      koppel(dir, '123456789', '2', 'Tess', 'zelf'),
      koppel(dir, '123456789', '3', 'Noa', 'dashboard'),
    ]);

    expect(Object.keys((await leesDossier(dir, '123456789')).koppelingen).sort()).toEqual(['1', '2', '3']);
  });

  it('blokkeert de rij niet als één wijziging mislukt', async () => {
    await expect(
      wijzigDossier(dir, '123456789', () => {
        throw new Error('nee');
      }),
    ).rejects.toThrow('nee');

    await koppel(dir, '123456789', '1', 'Tess', 'zelf');
    expect(koppelingenVan(await leesDossier(dir, '123456789'))).toHaveLength(1);
  });

  it('weigert een server-id dat een pad kan zijn', async () => {
    await expect(leesDossier(dir, '../geheim')).rejects.toThrow(/Ongeldig server-id/);
  });

  it('stopt bij een kapot bestand in plaats van het als leeg te lezen', async () => {
    // Stil doorgaan zou betekenen: alle koppelingen weg, en bij de volgende
    // synchronisatie iedereen zijn rol kwijt.
    await writeFile(path.join(dir, '123456789.json'), '{ dit is geen json', 'utf8');
    await expect(leesDossier(dir, '123456789')).rejects.toThrow(/niet te lezen/);
  });

  it('noemt alle servers waarvoor iets is ingesteld', async () => {
    await koppel(dir, '111111111', '1', 'Tess', 'zelf');
    await koppel(dir, '222222222', '1', 'Noa', 'zelf');
    await writeFile(path.join(dir, 'rommel.txt'), 'x', 'utf8');

    expect((await lijstDossiers(dir)).sort()).toEqual(['111111111', '222222222']);
  });

  it('laat geen half bestand achter bij het schrijven', async () => {
    await koppel(dir, '123456789', '1', 'Tess', 'zelf');
    const inhoud = await readFile(path.join(dir, '123456789.json'), 'utf8');
    expect(() => JSON.parse(inhoud)).not.toThrow();
  });
});
