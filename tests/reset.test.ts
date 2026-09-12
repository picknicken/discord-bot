import { describe, expect, it } from 'vitest';
import { countReset, describeReset, planReset } from '../src/reset.js';
import type { GuildSnapshot, SnapshotRole } from '../src/snapshot.js';

const role = (id: string, name: string, position: number, extra: Partial<SnapshotRole> = {}): SnapshotRole => ({
  id, name, color: 0, hoist: false, mentionable: false, permissions: 0n, position,
  managed: false, isEveryone: false, ...extra,
});

const snapshot: GuildSnapshot = {
  id: 'g1',
  name: 'Testserver',
  roles: [
    role('g1', '@everyone', 0, { isEveryone: true }),
    role('r1', 'Lid', 1),
    role('r2', 'Moderator', 2),
    role('r3', 'Een bot', 3, { managed: true }),
    role('r4', 'Eigenaar', 8),
  ],
  categories: [{ id: 'c1', name: 'Gesprekken', position: 0 }],
  channels: [
    { id: 'ch1', name: 'algemeen', type: 'text', parentId: 'c1', topic: null, nsfw: false, slowmodeSeconds: 0, userLimit: null, position: 0 },
  ],
  emojis: [],
  automod: [{ id: 'a1', name: 'Spam' }],
};

// De bot staat op 5: alles daaronder mag weg, alles daarboven niet.
const plan = planReset(snapshot, 5);

describe('leeghalen', () => {
  it('neemt kanalen en categorieen mee', () => {
    expect(plan.channels.map((c) => c.name)).toEqual(['algemeen', 'Gesprekken']);
  });

  it('verwijdert kanalen voor hun categorie', () => {
    expect(plan.channels.findIndex((c) => c.name === 'algemeen'))
      .toBeLessThan(plan.channels.findIndex((c) => c.name === 'Gesprekken'));
  });

  it('laat @everyone met rust', () => {
    expect(plan.roles.some((r) => r.name === '@everyone')).toBe(false);
  });

  it('laat rollen van bots en integraties met rust', () => {
    expect(plan.roles.some((r) => r.name === 'Een bot')).toBe(false);
    expect(plan.skipped.join(' ')).toContain('integratie');
  });

  it('laat rollen boven de bot met rust', () => {
    expect(plan.roles.some((r) => r.name === 'Eigenaar')).toBe(false);
    expect(plan.skipped.join(' ')).toContain('hoger dan de bot');
  });

  it('neemt de rollen eronder wel mee', () => {
    expect(plan.roles.map((r) => r.name).sort()).toEqual(['Lid', 'Moderator']);
  });

  it('neemt automod-regels mee', () => {
    expect(plan.automod).toEqual([{ id: 'a1', name: 'Spam' }]);
  });

  it('telt en beschrijft wat er gebeurt', () => {
    expect(countReset(plan)).toBe(5);
    expect(describeReset(plan)[0]).toBe('- kanaal algemeen');
    expect(describeReset(plan).some((line) => line.startsWith('  blijft staan'))).toBe(true);
  });

  it('doet niets op een lege server', () => {
    const leeg = planReset({ ...snapshot, roles: [], categories: [], channels: [], automod: [] }, 5);
    expect(countReset(leeg)).toBe(0);
  });
});
