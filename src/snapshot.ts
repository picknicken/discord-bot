import { ChannelType, type Guild } from 'discord.js';
import type { ChannelSpec } from './types.js';

/**
 * Platte weergave van een bestaande server. De planner werkt hierop in plaats van op
 * discord.js-objecten, zodat plannen te testen is zonder een echte gateway-verbinding.
 */
export interface GuildSnapshot {
  id: string;
  name: string;
  roles: SnapshotRole[];
  categories: SnapshotCategory[];
  channels: SnapshotChannel[];
  emojis: string[];
  /** Gevuld zodra de caller `guild.autoModerationRules.fetch()` heeft gedaan. */
  automod: { id: string; name: string }[];
}

export interface SnapshotRole {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: bigint;
  position: number;
  managed: boolean;
  isEveryone: boolean;
}

export interface SnapshotCategory {
  id: string;
  name: string;
  position: number;
}

export interface SnapshotChannel {
  id: string;
  name: string;
  type: ChannelSpec['type'];
  parentId: string | null;
  topic: string | null;
  nsfw: boolean;
  slowmodeSeconds: number;
  userLimit: number | null;
  position: number;
}

const CHANNEL_TYPE_MAP: Partial<Record<ChannelType, ChannelSpec['type']>> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildStageVoice]: 'stage',
};

export function mapChannelType(type: ChannelType): ChannelSpec['type'] | null {
  return CHANNEL_TYPE_MAP[type] ?? null;
}

export function snapshotGuild(guild: Guild): GuildSnapshot {
  const roles: SnapshotRole[] = guild.roles.cache.map((role) => ({
    id: role.id,
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield,
    position: role.position,
    managed: role.managed,
    isEveryone: role.id === guild.id,
  }));

  const categories: SnapshotCategory[] = [];
  const channels: SnapshotChannel[] = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) continue;
    if (channel.type === ChannelType.GuildCategory) {
      categories.push({ id: channel.id, name: channel.name, position: channel.rawPosition });
      continue;
    }
    const mapped = mapChannelType(channel.type);
    if (!mapped) continue;
    channels.push({
      id: channel.id,
      name: channel.name,
      type: mapped,
      parentId: channel.parentId,
      topic: 'topic' in channel ? channel.topic ?? null : null,
      nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
      slowmodeSeconds: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser ?? 0 : 0,
      userLimit: 'userLimit' in channel ? channel.userLimit : null,
      position: channel.rawPosition,
    });
  }

  return {
    id: guild.id,
    name: guild.name,
    roles: roles.sort((a, b) => b.position - a.position),
    categories: categories.sort((a, b) => a.position - b.position),
    channels: channels.sort((a, b) => a.position - b.position),
    emojis: guild.emojis.cache.map((emoji) => emoji.name ?? '').filter(Boolean),
    automod: guild.autoModerationRules.cache.map((rule) => ({ id: rule.id, name: rule.name })),
  };
}

/**
 * Zelfde als `snapshotGuild`, maar haalt eerst de AutoMod-regels op: die staan niet
 * standaard in de cache, en zonder die stap zou de planner ze allemaal opnieuw aanmaken.
 */
export async function snapshotGuildFresh(guild: Guild): Promise<GuildSnapshot> {
  await guild.autoModerationRules.fetch().catch(() => null);
  return snapshotGuild(guild);
}
