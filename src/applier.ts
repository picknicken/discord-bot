import {
  ChannelType,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
  type CategoryChannel,
  type Guild,
  type GuildChannelCreateOptions,
  type OverwriteResolvable,
} from 'discord.js';
import { logger } from './util/logger.js';
import { toBitfield } from './permissions.js';
import type { Plan } from './planner.js';
import type { ChannelSpec, Overwrite, ServerTemplate } from './types.js';

export interface ApplyResult {
  applied: number;
  failed: number;
  errors: string[];
}

const CHANNEL_TYPES: Record<ChannelSpec['type'], ChannelType> = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  forum: ChannelType.GuildForum,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
};

const VERIFICATION_LEVELS = {
  none: GuildVerificationLevel.None,
  low: GuildVerificationLevel.Low,
  medium: GuildVerificationLevel.Medium,
  high: GuildVerificationLevel.High,
  very_high: GuildVerificationLevel.VeryHigh,
} as const;

const CONTENT_FILTERS = {
  disabled: GuildExplicitContentFilter.Disabled,
  members_without_roles: GuildExplicitContentFilter.MembersWithoutRoles,
  all_members: GuildExplicitContentFilter.AllMembers,
} as const;

const NOTIFICATION_LEVELS = {
  all_messages: GuildDefaultMessageNotifications.AllMessages,
  only_mentions: GuildDefaultMessageNotifications.OnlyMentions,
} as const;

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Voert een plan uit. Acties draaien bewust sequentieel: Discord's rate limits op
 * kanaal- en rolbeheer zijn streng, en de volgorde is betekenisvol (rollen voor
 * overwrites, categorieen voor kanalen).
 */
export async function applyPlan(guild: Guild, template: ServerTemplate, plan: Plan): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, failed: 0, errors: [] };

  /** Template-rolkey -> echte rol-id. */
  const roleIds = new Map<string, string>();
  roleIds.set('@everyone', guild.id);
  for (const role of template.roles) {
    const existing = guild.roles.cache.find((candidate) => normalize(candidate.name) === normalize(role.name));
    if (existing) roleIds.set(role.key, existing.id);
  }

  /** Categorienaam -> echte kanaal-id. */
  const categoryIds = new Map<string, string>();
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) {
      categoryIds.set(normalize(channel.name), channel.id);
    }
  }

  const buildOverwrites = (overwrites: Overwrite[]): OverwriteResolvable[] => {
    const resolved: OverwriteResolvable[] = [];
    for (const overwrite of overwrites) {
      const id = roleIds.get(overwrite.role);
      if (!id) {
        result.errors.push(`Overwrite overgeslagen: rol "${overwrite.role}" bestaat (nog) niet.`);
        continue;
      }
      resolved.push({ id, allow: toBitfield(overwrite.allow), deny: toBitfield(overwrite.deny) });
    }
    return resolved;
  };

  const channelOptions = (spec: ChannelSpec, parentId: string | null): GuildChannelCreateOptions => {
    const options: GuildChannelCreateOptions = {
      name: spec.name,
      type: CHANNEL_TYPES[spec.type] as GuildChannelCreateOptions['type'],
      parent: parentId ?? undefined,
      permissionOverwrites: buildOverwrites(spec.overwrites),
    };
    if (spec.type === 'text' || spec.type === 'forum' || spec.type === 'announcement') {
      options.topic = spec.topic;
      options.nsfw = spec.nsfw;
      options.rateLimitPerUser = spec.slowmodeSeconds;
    }
    if ((spec.type === 'voice' || spec.type === 'stage') && spec.userLimit !== undefined) {
      options.userLimit = spec.userLimit;
    }
    return options;
  };

  for (const action of plan.actions) {
    try {
      switch (action.kind) {
        case 'create-role': {
          const created = await guild.roles.create({
            name: action.role.name,
            color: action.role.color ? Number.parseInt(action.role.color.replace('#', ''), 16) : undefined,
            hoist: action.role.hoist,
            mentionable: action.role.mentionable,
            permissions: toBitfield(action.role.permissions),
            reason: `Server-setup: template "${template.name}"`,
          });
          roleIds.set(action.role.key, created.id);
          break;
        }

        case 'update-role': {
          const role = await guild.roles.fetch(action.roleId);
          if (!role) throw new Error('rol niet gevonden');
          await role.edit({
            color: action.role.color ? Number.parseInt(action.role.color.replace('#', ''), 16) : undefined,
            hoist: action.role.hoist,
            mentionable: action.role.mentionable,
            permissions: toBitfield(action.role.permissions),
            reason: `Server-setup: template "${template.name}"`,
          });
          roleIds.set(action.role.key, role.id);
          break;
        }

        case 'create-category': {
          const created = await guild.channels.create({
            name: action.category.name,
            type: ChannelType.GuildCategory,
            permissionOverwrites: buildOverwrites(action.category.overwrites),
            reason: `Server-setup: template "${template.name}"`,
          });
          categoryIds.set(normalize(action.category.name), created.id);
          break;
        }

        case 'update-category': {
          const category = (await guild.channels.fetch(action.channelId)) as CategoryChannel | null;
          if (!category) throw new Error('categorie niet gevonden');
          await category.permissionOverwrites.set(
            buildOverwrites(action.category.overwrites),
            `Server-setup: template "${template.name}"`,
          );
          break;
        }

        case 'create-channel': {
          const parentId = action.categoryName ? categoryIds.get(normalize(action.categoryName)) ?? null : null;
          await guild.channels.create({
            ...channelOptions(action.channel, parentId),
            reason: `Server-setup: template "${template.name}"`,
          } as GuildChannelCreateOptions);
          break;
        }

        case 'update-channel': {
          const channel = await guild.channels.fetch(action.channelId);
          if (!channel || channel.isThread()) throw new Error('kanaal niet gevonden');
          const parentId = action.categoryName ? categoryIds.get(normalize(action.categoryName)) ?? null : null;
          await channel.edit({
            parent: parentId,
            ...(action.channel.type === 'text' || action.channel.type === 'announcement'
              ? {
                  topic: action.channel.topic,
                  nsfw: action.channel.nsfw,
                  rateLimitPerUser: action.channel.slowmodeSeconds,
                }
              : {}),
            permissionOverwrites: buildOverwrites(action.channel.overwrites),
            reason: `Server-setup: template "${template.name}"`,
          });
          break;
        }

        case 'delete-channel': {
          const channel = await guild.channels.fetch(action.channelId);
          if (!channel) break;
          await channel.delete(`Server-setup (prune): template "${template.name}"`);
          break;
        }

        case 'guild-settings': {
          const settings = template.guild;
          await guild.edit({
            verificationLevel: settings.verificationLevel
              ? VERIFICATION_LEVELS[settings.verificationLevel]
              : undefined,
            explicitContentFilter: settings.explicitContentFilter
              ? CONTENT_FILTERS[settings.explicitContentFilter]
              : undefined,
            defaultMessageNotifications: settings.defaultMessageNotifications
              ? NOTIFICATION_LEVELS[settings.defaultMessageNotifications]
              : undefined,
            afkTimeout: settings.afkTimeoutSeconds,
            reason: `Server-setup: template "${template.name}"`,
          });
          await applyNamedChannels(guild, template);
          break;
        }
      }
      result.applied += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${action.kind}: ${message}`);
      logger.warn(`Actie mislukt (${action.kind})`, message);
    }
  }

  return result;
}

/** System- en AFK-kanaal kunnen pas gezet worden als de kanalen bestaan. */
async function applyNamedChannels(guild: Guild, template: ServerTemplate): Promise<void> {
  const { systemChannel, afkChannel } = template.guild;
  if (!systemChannel && !afkChannel) return;

  const find = (name: string, type: ChannelType) =>
    guild.channels.cache.find((channel) => channel.type === type && normalize(channel.name) === normalize(name));

  await guild.edit({
    systemChannel: systemChannel ? find(systemChannel, ChannelType.GuildText)?.id ?? null : undefined,
    afkChannel: afkChannel ? find(afkChannel, ChannelType.GuildVoice)?.id ?? null : undefined,
    reason: `Server-setup: template "${template.name}"`,
  });
}
