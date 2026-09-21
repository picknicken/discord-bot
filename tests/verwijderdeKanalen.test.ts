import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { applyPlan } from '../src/applier.js';
import type { Plan } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';

/**
 * Een dubbel kanaal opruimen en daarna de verwijzingen zetten, in één run.
 *
 * Dat ging mis: de lijst met namen wordt bij het inloggen gevuld, en het zojuist
 * weggegooide kanaal stond er nog in. Het systeemkanaal wees dus naar een id dat
 * niet meer bestond, en de onboarding kreeg "Unknown channel" terug — terwijl er
 * nog een kanaal met precies die naam stond.
 */
function nepServer() {
  const kanaal = (id: string, name: string) => ({ id, name, type: ChannelType.GuildText, isThread: () => false });
  const kanalen = new Collection<string, ReturnType<typeof kanaal>>();
  // Het dubbele kanaal staat als laatste in de lijst, dus dat is het kanaal dat
  // de naam "welkom" bij het inloggen opeist - en precies dat wordt weggegooid.
  kanalen.set('blijft', kanaal('blijft', 'welkom'));
  kanalen.set('oud', kanaal('oud', 'welkom'));

  const edits: Record<string, unknown>[] = [];
  const verwijderd: string[] = [];

  const guild = {
    id: 'g1',
    name: 'Nepserver',
    features: [] as string[],
    roles: { cache: new Collection(), fetch: async () => new Collection() },
    channels: {
      cache: kanalen,
      fetch: async (id?: string) => {
        if (!id) return kanalen;
        const kanaal = kanalen.get(id);
        if (!kanaal) return null;
        return {
          ...kanaal,
          delete: async () => {
            kanalen.delete(id);
            verwijderd.push(id);
          },
        };
      },
    },
    members: {
      fetchMe: async () => ({
        id: 'bot',
        roles: { botRole: { id: 'botrol' }, highest: { position: 10, rawPosition: 10 } },
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
      }),
    },
    edit: async (payload: Record<string, unknown>) => {
      edits.push(payload);
      return guild;
    },
  };

  return { guild: guild as unknown as Guild, edits, verwijderd, kanalen };
}

const template = parseTemplate({
  name: 'Test',
  guild: { systemChannel: 'welkom' },
  categories: [{ name: 'Info', channels: [{ name: 'welkom' }] }],
});

const plan: Plan = {
  templateName: 'Test',
  options: { prune: true, update: true },
  actions: [
    { kind: 'delete-channel', channelId: 'oud', name: 'welkom', isCategory: false },
    { kind: 'guild-settings', changes: ['systemChannel'] },
  ],
  warnings: [],
};

describe('een verwijderd kanaal uit de naamlijst halen', () => {
  it('zet de verwijzing op het kanaal dat blijft staan', async () => {
    const nep = nepServer();
    const result = await applyPlan(nep.guild, template, plan);

    expect(nep.verwijderd).toEqual(['oud']);
    expect(result.errors).toEqual([]);
    expect(nep.edits.some((edit) => edit.systemChannel === 'blijft')).toBe(true);
    expect(nep.edits.some((edit) => edit.systemChannel === 'oud')).toBe(false);
  });
});
