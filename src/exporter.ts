import { ChannelType, type AnyThreadChannel, type Guild, type GuildBasedChannel } from 'discord.js';
import { toNames } from './permissions.js';
import { mapChannelType } from './snapshot.js';
import type { CategorySpec, ChannelSpec, Overwrite, RoleSpec, ServerTemplate } from './types.js';

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'rol';

/** Leest een bestaande server uit als template, zodat je hem elders kunt herhalen. */
export function exportGuild(guild: Guild, templateName = guild.name): ServerTemplate {
  const roleKeys = new Map<string, string>();
  roleKeys.set(guild.id, '@everyone');

  const roles: RoleSpec[] = [];
  const used = new Set<string>(['@everyone']);

  for (const role of [...guild.roles.cache.values()].sort((a, b) => b.position - a.position)) {
    if (role.id === guild.id || role.managed) continue;
    let key = slug(role.name);
    let suffix = 2;
    while (used.has(key)) key = `${slug(role.name)}-${suffix++}`;
    used.add(key);
    roleKeys.set(role.id, key);

    roles.push({
      key,
      name: role.name,
      color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: toNames(role.permissions.bitfield),
    });
  }

  const overwritesOf = (channel: GuildBasedChannel): Overwrite[] => {
    if (!('permissionOverwrites' in channel)) return [];
    const result: Overwrite[] = [];
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      const key = roleKeys.get(overwrite.id);
      if (!key) continue; // member-overwrites horen niet in een herbruikbare template
      result.push({
        role: key,
        allow: toNames(overwrite.allow.bitfield),
        deny: toNames(overwrite.deny.bitfield),
      });
    }
    return result;
  };

  const channelSpec = (channel: GuildBasedChannel): ChannelSpec | null => {
    const type = mapChannelType(channel.type);
    if (!type) return null;
    return {
      name: channel.name,
      type,
      topic: 'topic' in channel ? channel.topic ?? undefined : undefined,
      nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
      slowmodeSeconds: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser ?? 0 : 0,
      userLimit: 'userLimit' in channel ? channel.userLimit : undefined,
      overwrites: overwritesOf(channel),
      // Berichten worden bewust niet geexporteerd: die horen bij de inhoud van een
      // server, niet bij de structuur, en zouden bij elke uitrol opnieuw geplaatst worden.
      messages: [],
      tags:
        'availableTags' in channel
          ? channel.availableTags.map((tag) => ({
              name: tag.name,
              emoji: tag.emoji?.name ?? undefined,
              moderated: tag.moderated,
            }))
          : [],
      defaultReaction:
        'defaultReactionEmoji' in channel ? channel.defaultReactionEmoji?.name ?? undefined : undefined,
      autoArchiveMinutes:
        'defaultAutoArchiveDuration' in channel
          ? (channel.defaultAutoArchiveDuration as ChannelSpec['autoArchiveMinutes']) ?? undefined
          : undefined,
    };
  };

  const sorted = [...guild.channels.cache.values()]
    .filter((channel): channel is Exclude<GuildBasedChannel, AnyThreadChannel> => !channel.isThread())
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const categories: CategorySpec[] = sorted
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .map((category) => ({
      name: category.name,
      overwrites: overwritesOf(category),
      channels: sorted
        .filter((channel) => channel.parentId === category.id)
        .map(channelSpec)
        .filter((spec): spec is ChannelSpec => spec !== null),
    }));

  const uncategorizedChannels = sorted
    .filter((channel) => channel.parentId === null && channel.type !== ChannelType.GuildCategory)
    .map(channelSpec)
    .filter((spec): spec is ChannelSpec => spec !== null);

  const channelName = (id: string | null | undefined) =>
    id ? guild.channels.cache.get(id)?.name : undefined;

  return {
    name: templateName,
    description: `Geexporteerd uit "${guild.name}" op ${new Date().toISOString().slice(0, 10)}`,
    variables: {},
    guild: {
      description: guild.description ?? undefined,
      systemChannel: channelName(guild.systemChannelId),
      afkChannel: channelName(guild.afkChannelId),
      rulesChannel: channelName(guild.rulesChannelId),
      updatesChannel: channelName(guild.publicUpdatesChannelId),
      community: guild.features.includes('COMMUNITY') || undefined,
    },
    roles,
    categories,
    uncategorizedChannels,
    // De CDN-url werkt als bron bij het opnieuw aanmaken.
    emojis: guild.emojis.cache.map((emoji) => ({
      name: emoji.name ?? 'emoji',
      image: emoji.imageURL({ size: 128 }),
      roles: emoji.roles.cache.map((role) => roleKeys.get(role.id) ?? '').filter(Boolean),
    })),
    // AutoMod-regels staan niet in de cache; die zou een losse API-call vergen.
    automod: [],
  };
}
