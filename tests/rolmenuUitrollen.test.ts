import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { applyPlan } from '../src/applier.js';
import { planSetup } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import type { GeplaatstRolmenu } from '../src/rolmenu.js';
import { standaardInstellingen } from './helpers/snapshot.js';

/**
 * Wat er naar Discord gaat als er een rolmenu in de template staat: één bericht,
 * en de tweede keer een bewerking van datzelfde bericht.
 */

const template = parseTemplate({
  name: 'Test',
  roles: [{ key: 'pc', name: 'PC' }],
  uncategorizedChannels: [{ name: 'rollen' }],
  roleMenus: [
    { channel: 'rollen', title: 'Waar speel je op?', description: 'Klik maar.', options: [{ role: 'pc', emoji: '🖥️' }] },
  ],
});

function nepServer() {
  const verstuurd: Record<string, any>[] = [];
  const bewerkt: Record<string, any>[] = [];

  const rol = { id: 'r1', name: 'PC', managed: false, rawPosition: 1, position: 1 };
  const kanaal = {
    id: 'k1',
    name: 'rollen',
    type: ChannelType.GuildText,
    parentId: null,
    rawPosition: 0,
    isThread: () => false,
    isTextBased: () => true,
    send: async (bericht: Record<string, any>) => {
      verstuurd.push(bericht);
      return { id: 'm1' };
    },
    messages: {
      fetch: async (id: string) =>
        id === 'm1'
          ? { id: 'm1', edit: async (bericht: Record<string, any>) => void bewerkt.push(bericht) }
          : Promise.reject(new Error('weg')),
    },
  };

  const guild = {
    id: 'g1',
    name: 'Nepserver',
    features: [] as string[],
    roles: {
      cache: new Collection([['r1', rol]]),
      fetch: async () => new Collection([['r1', rol]]),
      setPositions: async () => undefined,
    },
    channels: {
      cache: new Collection([['k1', kanaal]]),
      fetch: async (id?: string) => (id === 'k1' ? kanaal : null),
      setPositions: async () => undefined,
    },
    members: {
      fetchMe: async () => ({
        id: 'bot',
        roles: { botRole: { id: 'botrol' }, highest: { position: 10, rawPosition: 10 } },
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
      }),
    },
    autoModerationRules: { create: async () => undefined, delete: async () => undefined },
    edit: async () => guild,
  };

  return { guild: guild as unknown as Guild, verstuurd, bewerkt };
}

const server = (rolmenus: GeplaatstRolmenu[]): GuildSnapshot => ({
  id: 'g1',
  name: 'Nepserver',
  roles: [
    { id: 'r1', name: 'PC', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 1, rawPosition: 1, managed: false, isEveryone: false },
  ],
  categories: [],
  channels: [
    { id: 'k1', name: 'rollen', type: 'text', parentId: null, topic: null, nsfw: false, slowmodeSeconds: 0, userLimit: null, position: 0, overwrites: [] },
  ],
  emojis: [],
  automod: [],
  settings: standaardInstellingen,
  onboarding: null,
  rolmenus,
  rolmenusGelezen: true,
});

const draai = async (rolmenus: GeplaatstRolmenu[]) => {
  const nep = nepServer();
  const plan = planSetup(server(rolmenus), template, { prune: false, update: true });
  const result = await applyPlan(nep.guild, template, plan);
  return { ...nep, result };
};

describe('een rolmenu uitrollen', () => {
  it('stuurt het bericht met de knop erin', async () => {
    const { verstuurd, result } = await draai([]);

    expect(result.failed).toBe(0);
    expect(verstuurd).toHaveLength(1);

    const rij = verstuurd[0]?.components?.[0].toJSON();
    expect(rij.components[0].custom_id).toBe('rolmenu:r1');
    expect(rij.components[0].label).toBe('PC');
    expect(verstuurd[0]?.embeds?.[0].toJSON().title).toBe('Waar speel je op?');
  });

  it('bewerkt het bericht dat er al staat in plaats van een nieuw te sturen', async () => {
    const { verstuurd, bewerkt } = await draai([
      {
        channelId: 'k1',
        channelName: 'rollen',
        messageId: 'm1',
        title: 'Waar speel je op?',
        description: 'Iets anders',
        color: null,
        style: 'buttons',
        options: [{ roleId: 'r1', label: 'PC', emoji: '🖥️', description: null }],
      },
    ]);

    expect(bewerkt).toHaveLength(1);
    expect(verstuurd).toHaveLength(0);
  });
});
