import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listVersions, readVersion, recordVersion } from '../src/history.js';

describe('versiegeschiedenis', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'history-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('bewaart de inhoud en geeft hem terug', async () => {
    await recordVersion(dir, 'bedrijf', '{"a":1}');
    const [version] = await listVersions(dir, 'bedrijf');
    expect(version).toBeDefined();
    expect(await readVersion(dir, 'bedrijf', version!.stamp)).toBe('{"a":1}');
  });

  it('onthoudt wie opsloeg', async () => {
    await recordVersion(dir, 'bedrijf', '{"a":1}', 'Jan');
    const [version] = await listVersions(dir, 'bedrijf');
    expect(version?.door).toBe('Jan');
  });

  it('laat "door" weg als niemand ingelogd was', async () => {
    await recordVersion(dir, 'bedrijf', '{"a":1}');
    const [version] = await listVersions(dir, 'bedrijf');
    expect(version?.door).toBeUndefined();
  });

  it('telt het naamsbestand niet mee als losse versie', async () => {
    await recordVersion(dir, 'bedrijf', '{"a":1}', 'Jan');
    expect(await listVersions(dir, 'bedrijf')).toHaveLength(1);
  });

  it('zet de nieuwste versie bovenaan', async () => {
    await recordVersion(dir, 'bedrijf', '{"nr":1}', 'Jan');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordVersion(dir, 'bedrijf', '{"nr":2}', 'Piet');
    const versions = await listVersions(dir, 'bedrijf');
    expect(versions.map((version) => version.door)).toEqual(['Piet', 'Jan']);
  });

  it('weigert een gekke template-naam', async () => {
    await expect(recordVersion(dir, '../stiekem', '{}')).rejects.toThrow(/Ongeldige template-naam/);
  });
});
