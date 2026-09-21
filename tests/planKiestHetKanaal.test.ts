import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { applyPlan } from '../src/applier.js';
import { planSetup } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import { standaardInstellingen } from './helpers/snapshot.js';

/**
 * Twee kanalen met dezelfde naam: de planner kiest er een, en de uitroller moet
 * diezelfde bedoelen. Deden ze dat apart, dan zette de uitroller het
 * systeemkanaal op het kanaal dat de planner juist had laten vallen - en bleef
 * de preview daarna melden dat het anders was, zonder dat je kon zien waarom.
 */
const template = parseTemplate({
  name: 'Test',
  guild: { systemChannel: 'welkom' },
  categories: [{ name: 'Info', channels: [{ name: 'welkom' }] }],
});

const kanaal = (id: string, name: string, parentId: string | null, position: number) => ({
  id, name, type: 'text' as const, parentId, topic: null, nsfw: false,
  slowmodeSeconds: 0, userLimit: null, position, overwrites: [],
});

const snapshot: GuildSnapshot = {
  id: 'g1',
  name: 'Server',
  roles: [],
  categories: [{ id: 'cat1', name: 'Info', position: 0, overwrites: [] }],
  channels: [
    kanaal('binnen', 'welkom', 'cat1', 0),
    // Blijven liggen van een eerdere uitrol, buiten de categorie.
    kanaal('los', 'welkom', null, 1),
  ],
  emojis: [],
  automod: [],
  settings: standaardInstellingen,
  onboarding: null,
  rolmenus: [],
  rolmenusGelezen: true,
};

function nepServer() {
  const kanalen = new Collection<string, { id: string; name: string; type: ChannelType; isThread: () => boolean }>();
  for (const id of ['binnen', 'los']) {
    kanalen.set(id, { id, name: 'welkom', type: ChannelType.GuildText, isThread: () => false });
  }

  const edits: Record<string, unknown>[] = [];
  const guild = {
    id: 'g1',
    name: 'Nepserver',
    features: [] as string[],
    roles: { cache: new Collection(), fetch: async () => new Collection() },
    channels: { cache: kanalen, fetch: async () => kanalen },
    members: {
      fetchMe: async () => ({
        id: 'bot',
        roles: { botRole: { id: 'botrol' }, highest: { position: 10, rawPosition: 10 } },
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
      }),
    },
    systemChannelId: null as string | null,
    afkChannelId: null as string | null,
    rulesChannelId: null as string | null,
    publicUpdatesChannelId: null as string | null,
    edit: async (payload: Record<string, unknown>) => {
      edits.push(payload);
      if (typeof payload.systemChannel === 'string') guild.systemChannelId = payload.systemChannel;
      return guild;
    },
  };

  return { guild: guild as unknown as Guild, edits };
}

describe('de planner kiest het kanaal, de uitroller volgt', () => {
  it('zet het systeemkanaal op het kanaal uit de categorie van de template', async () => {
    const plan = planSetup(snapshot, template, { prune: false, update: true });
    expect(plan.gekozenIds.kanalen.welkom).toBe('binnen');

    const nep = nepServer();
    const result = await applyPlan(nep.guild, template, plan);

    expect(result.errors).toEqual([]);
    expect(nep.edits.some((edit) => edit.systemChannel === 'binnen')).toBe(true);
    expect(nep.edits.some((edit) => edit.systemChannel === 'los')).toBe(false);
  });
});
