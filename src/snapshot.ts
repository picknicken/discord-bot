import { ChannelType, OverwriteType, type Guild, type GuildBasedChannel } from 'discord.js';
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
  /**
   * De nette volgorde zoals discord.js hem uitrekent: een strikte rangschikking
   * waarin geen twee rollen gelijk staan. Goed om mee te vergelijken - niet om
   * naar Discord terug te sturen.
   */
  position: number;
  /**
   * Het nummer zoals Discord het zelf bewaart. Twee rollen mogen hier hetzelfde
   * nummer hebben. Dit is wat de API verwacht als je een volgorde zet.
   */
  rawPosition: number;
  managed: boolean;
  isEveryone: boolean;
}

/**
 * De rechten die op een kanaal of categorie staan, per rol-id.
 *
 * Zonder deze konden we niet vergelijken of de rechten al kloppen, en zette de
 * planner ze bij elke uitrol opnieuw - twintig regels "permissies" in elke
 * preview, waardoor je de echte wijziging niet meer zag.
 *
 * Alleen rollen; rechten die aan een persoon hangen laten we met rust, want die
 * staan niet in een template en horen dus ook niet weggehaald te worden.
 */
export interface SnapshotOverwrite {
  roleId: string;
  allow: bigint;
  deny: bigint;
}

export interface SnapshotCategory {
  id: string;
  name: string;
  /** Het nummer zoals Discord het bewaart. */
  position: number;
  overwrites: SnapshotOverwrite[];
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
  overwrites: SnapshotOverwrite[];
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

/** De rolrechten op een kanaal, in dezelfde vorm als waarmee we vergelijken. */
function leesOverwrites(channel: GuildBasedChannel): SnapshotOverwrite[] {
  if (!('permissionOverwrites' in channel)) return [];

  return [...channel.permissionOverwrites.cache.values()]
    .filter((overwrite) => overwrite.type === OverwriteType.Role)
    .map((overwrite) => ({
      roleId: overwrite.id,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
    }));
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
    rawPosition: role.rawPosition,
    managed: role.managed,
    isEveryone: role.id === guild.id,
  }));

  const categories: SnapshotCategory[] = [];
  const channels: SnapshotChannel[] = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) continue;
    if (channel.type === ChannelType.GuildCategory) {
      categories.push({
        id: channel.id,
        name: channel.name,
        position: channel.rawPosition,
        overwrites: leesOverwrites(channel),
      });
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
      overwrites: leesOverwrites(channel),
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
