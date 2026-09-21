import { describe, expect, it } from 'vitest';
import { VANZELF, welkeWegKunnen } from '../src/backupWacht.js';
import type { BackupEntry } from '../src/backup.js';

/**
 * Een momentopname per week houdt je volume niet leeg. Opruimen dus - maar
 * alleen wat vanzelf gemaakt is. Een back-up van vlak voor een uitrol heb je
 * juist bewaard omdat er iets stond te gebeuren.
 */
const entry = (file: string, guildId: string, createdAt: string, label = VANZELF): BackupEntry => ({
  file, guildId, guildName: 'Server ' + guildId, createdAt, label, roles: 1, channels: 1,
});

describe('oude momentopnames opruimen', () => {
  it('houdt de nieuwste en gooit de rest weg', () => {
    const entries = [
      entry('a.json', 'g1', '2026-09-21T10:00:00.000Z'),
      entry('b.json', 'g1', '2026-09-14T10:00:00.000Z'),
      entry('c.json', 'g1', '2026-09-07T10:00:00.000Z'),
    ];

    expect(welkeWegKunnen(entries, 2).map((e) => e.file)).toEqual(['c.json']);
  });

  it('telt per server, niet over alles heen', () => {
    const entries = [
      entry('a.json', 'g1', '2026-09-21T10:00:00.000Z'),
      entry('b.json', 'g2', '2026-09-21T10:00:00.000Z'),
      entry('c.json', 'g2', '2026-09-14T10:00:00.000Z'),
    ];

    expect(welkeWegKunnen(entries, 1).map((e) => e.file)).toEqual(['c.json']);
  });

  it('blijft af van back-ups die voor een uitrol gemaakt zijn', () => {
    const entries = [
      entry('nieuw.json', 'g1', '2026-09-21T10:00:00.000Z'),
      entry('voor-uitrol.json', 'g1', '2026-09-14T10:00:00.000Z', 'voor-inrichten'),
      entry('voor-leeghalen.json', 'g1', '2026-09-07T10:00:00.000Z', 'voor-leeghalen'),
    ];

    expect(welkeWegKunnen(entries, 1)).toEqual([]);
  });

  it('gooit niets weg als er nog ruimte is', () => {
    expect(welkeWegKunnen([entry('a.json', 'g1', '2026-09-21T10:00:00.000Z')], 8)).toEqual([]);
  });
});
