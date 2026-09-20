import { describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import type { GuildSnapshot, SnapshotChannel, SnapshotRole } from '../src/snapshot.js';
import { parseTemplate } from '../src/types.js';

const role = (id: string, name: string, extra: Partial<SnapshotRole> = {}): SnapshotRole => ({
  id, name, color: 0, hoist: false, mentionable: false, permissions: 0n, position: 1, rawPosition: 1,
  managed: false, isEveryone: false, ...extra,
});

const channel = (id: string, name: string, parentId: string | null, extra: Partial<SnapshotChannel> = {}): SnapshotChannel => ({
  id, name, type: 'text', parentId, topic: null, nsfw: false, slowmodeSeconds: 0,
  userLimit: null, position: 0, overwrites: [], ...extra,
});

const snapshot = (overrides: Partial<GuildSnapshot> = {}): GuildSnapshot => ({
  id: 'g1',
  name: 'Testserver',
  roles: [role('0', '@everyone', { isEveryone: true })],
  categories: [],
  channels: [],
  emojis: [],
  automod: [],
  ...overrides,
});

const template = parseTemplate({
  name: 'T',
  roles: [{ key: 'lid', name: 'Lid', color: '#57f287' }],
  categories: [{ name: 'Gesprekken', channels: [{ name: 'algemeen' }, { name: 'Lounge', type: 'voice' }] }],
});

describe('template naast de server', () => {
  it('markeert alles als nieuw op een lege server', () => {
    const result = compare(snapshot(), template);
    expect(result.counts.new).toBe(4); // rol, categorie, twee kanalen
    expect(result.counts.same).toBe(0);
    expect(result.roles[0]).toMatchObject({ name: 'Lid', status: 'new' });
  });

  it('herkent wat er al staat', () => {
    const result = compare(
      snapshot({
        roles: [role('0', '@everyone', { isEveryone: true }), role('1', 'lid')],
        categories: [{ id: '10', name: 'gesprekken', position: 0, overwrites: [] }],
        channels: [channel('11', 'Algemeen', '10')],
      }),
      template,
    );

    expect(result.roles[0]?.status).toBe('same');
    expect(result.categories[0]?.status).toBe('same');
    expect(result.categories[0]?.channels.find((c) => c.name === 'algemeen')?.status).toBe('same');
    expect(result.categories[0]?.channels.find((c) => c.name === 'Lounge')?.status).toBe('new');
  });

  it('toont wat er op de server staat maar niet in de template', () => {
    const result = compare(
      snapshot({
        roles: [role('0', '@everyone', { isEveryone: true }), role('2', 'Oude rol')],
        categories: [{ id: '10', name: 'Gesprekken', position: 0, overwrites: [] }, { id: '20', name: 'Archief', position: 1, overwrites: [] }],
        channels: [channel('12', 'oud-kanaal', '10'), channel('21', 'stof', '20'), channel('30', 'los', null)],
      }),
      template,
    );

    expect(result.roles.find((r) => r.name === 'Oude rol')?.status).toBe('extra');
    expect(result.categories.find((c) => c.name === 'Gesprekken')?.channels.find((c) => c.name === 'oud-kanaal')?.status)
      .toBe('extra');

    const archief = result.categories.find((c) => c.name === 'Archief');
    expect(archief?.status).toBe('extra');
    expect(archief?.channels).toHaveLength(1);
    expect(result.loose.find((c) => c.name === 'los')?.status).toBe('extra');
  });

  it('meldt een kanaal met dezelfde naam maar een ander type', () => {
    const result = compare(
      snapshot({
        categories: [{ id: '10', name: 'Gesprekken', position: 0, overwrites: [] }],
        channels: [channel('13', 'Lounge', '10', { type: 'text' })],
      }),
      template,
    );

    const lounge = result.categories[0]?.channels.find((c) => c.name === 'Lounge');
    expect(lounge?.status).toBe('type-mismatch');
    expect(lounge?.note).toContain('text');
    expect(result.counts['type-mismatch']).toBe(1);
  });

  it('negeert rollen van integraties', () => {
    const result = compare(
      snapshot({ roles: [role('0', '@everyone', { isEveryone: true }), role('3', 'Een bot', { managed: true })] }),
      template,
    );
    expect(result.roles.some((r) => r.name === 'Een bot')).toBe(false);
  });
});
