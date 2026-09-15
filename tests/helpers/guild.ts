import { Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

/**
 * Een namaak-server: precies zoveel als het dashboard ervan gebruikt. Genoeg om
 * te zien wat er wel en niet uit de api komt, zonder een echte Discord-verbinding.
 */
export function stubGuild(id: string, naam: string) {
  const everyone = {
    id,
    name: '@everyone',
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: new PermissionsBitField(0n),
    position: 0,
    managed: false,
  };

  return {
    id,
    name: naam,
    memberCount: 3,
    iconURL: () => null,
    description: null,
    features: [] as string[],
    systemChannelId: null,
    afkChannelId: null,
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    roles: { cache: new Collection([[id, everyone]]) },
    channels: { cache: new Collection() },
    emojis: { cache: new Collection() },
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection() },
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(
          PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageGuild,
        ),
        roles: { highest: { position: 9 } },
      }),
    },
  };
}

export function stubClient(guilds: ReturnType<typeof stubGuild>[]): Client<true> {
  return {
    user: { username: 'Setup Bot', id: '123456789', displayAvatarURL: () => 'https://example.invalid/a.png' },
    guilds: { cache: new Collection(guilds.map((guild) => [guild.id, guild] as const)) },
  } as unknown as Client<true>;
}
