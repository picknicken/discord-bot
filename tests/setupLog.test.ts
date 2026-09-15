import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beschrijfRun, logSetup, readSetups, wieDraait, type SetupRun } from '../src/setupLog.js';

const run = (extra: Partial<SetupRun> = {}): SetupRun => ({
  at: '2026-09-13T15:55:06.000Z',
  guildId: '1',
  guildName: 'Testserver',
  template: 'bedrijf',
  door: 'Jij',
  mode: 'apply',
  onderdelen: ['rollen'],
  applied: 23,
  failed: 0,
  backup: null,
  notes: [],
  ...extra,
});

describe('logboek van uitrollen', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'setuplog-'));
  });

  afterEach(async () => {
    delete process.env.GITHUB_ACTOR;
    await rm(dir, { recursive: true, force: true });
  });

  it('schrijft en leest een uitrol terug', async () => {
    await logSetup(dir, run());
    const gelezen = await readSetups(dir);

    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.template).toBe('bedrijf');
  });

  it('zet de nieuwste bovenaan', async () => {
    await logSetup(dir, run({ template: 'eerst' }));
    await logSetup(dir, run({ template: 'daarna' }));

    expect((await readSetups(dir)).map((r) => r.template)).toEqual(['daarna', 'eerst']);
  });

  it('houdt zich aan het maximum', async () => {
    for (let n = 0; n < 5; n++) await logSetup(dir, run({ template: `t${n}` }));
    expect(await readSetups(dir, 2)).toHaveLength(2);
  });

  it('geeft een lege lijst als er nog niets is', async () => {
    expect(await readSetups(dir)).toEqual([]);
  });

  it('slaat een kapotte regel over in plaats van te klappen', async () => {
    await logSetup(dir, run());
    await writeFile(path.join(dir, 'setups.jsonl'), 'dit is geen json\n', { flag: 'a' });
    await logSetup(dir, run({ template: 'later' }));

    const gelezen = await readSetups(dir);
    expect(gelezen.map((r) => r.template)).toEqual(['later', 'bedrijf']);
  });

  it('laat een uitrol niet klappen als schrijven niet lukt', async () => {
    await expect(logSetup(path.join(dir, 'a\0b'), run())).resolves.toBeUndefined();
  });
});

describe('wie de uitrol startte', () => {
  afterEach(() => {
    delete process.env.GITHUB_ACTOR;
  });

  it('herkent een GitHub Action', () => {
    process.env.GITHUB_ACTOR = 'picknicken';
    expect(wieDraait()).toBe('picknicken (GitHub Action)');
  });

  it('noemt de commandoregel als het daar vandaan komt', () => {
    delete process.env.GITHUB_ACTOR;
    expect(wieDraait()).toBe('commandoregel');
  });
});

describe('een uitrol in één regel', () => {
  it('zegt of het gelukt is', () => {
    expect(beschrijfRun(run())).toBe('bedrijf op Testserver — 23 gelukt — door Jij');
  });

  it('noemt de mislukte acties', () => {
    expect(beschrijfRun(run({ failed: 2 }))).toContain('23 gelukt, 2 mislukt');
  });

  it('zegt het als het een preview was', () => {
    expect(beschrijfRun(run({ mode: 'preview' }))).toContain('preview');
  });
});
