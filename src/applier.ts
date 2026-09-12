import {
  PermissionFlagsBits,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildOnboardingMode,
  GuildVerificationLevel,
  type CategoryChannel,
  type Guild,
  type GuildChannelCreateOptions,
  type GuildMember,
  type OverwriteResolvable,
} from 'discord.js';
import { logger } from './util/logger.js';
import { toBitfield } from './permissions.js';
import type { Plan } from './planner.js';
import type { AutomodSpec, ChannelSpec, Overwrite, ServerTemplate } from './types.js';

/**
 * Verstopt deze set overwrites het kanaal voor @everyone? Zo ja, dan verliest de
 * bot zelf ook de toegang — die hoort immers ook bij @everyone.
 */
export function hidesFromEveryone(overwrites: readonly Overwrite[]): boolean {
  return overwrites.some((overwrite) => overwrite.role === '@everyone' && overwrite.deny.includes('ViewChannel'));
}

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

const AUTOMOD_TRIGGERS = {
  keyword: AutoModerationRuleTriggerType.Keyword,
  keyword_preset: AutoModerationRuleTriggerType.KeywordPreset,
  spam: AutoModerationRuleTriggerType.Spam,
  mention_spam: AutoModerationRuleTriggerType.MentionSpam,
} as const;

const AUTOMOD_PRESETS = {
  profanity: AutoModerationRuleKeywordPresetType.Profanity,
  sexual_content: AutoModerationRuleKeywordPresetType.SexualContent,
  slurs: AutoModerationRuleKeywordPresetType.Slurs,
} as const;

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Voert een plan uit. Acties draaien bewust sequentieel: Discord's rate limits op
 * kanaal- en rolbeheer zijn streng, en de volgorde is betekenisvol (rollen voor
 * overwrites, categorieen voor kanalen, kanalen voor alles wat ernaar verwijst).
 */
export async function applyPlan(guild: Guild, template: ServerTemplate, plan: Plan): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, failed: 0, errors: [] };
  const reason = `Server-setup: template "${template.name}"`;

  /** Template-rolkey -> echte rol-id. */
  const roleIds = new Map<string, string>();
  roleIds.set('@everyone', guild.id);
  for (const role of template.roles) {
    const existing = guild.roles.cache.find((candidate) => normalize(candidate.name) === normalize(role.name));
    if (existing) roleIds.set(role.key, existing.id);
  }

  // De eigen rol van de bot, zodat hij zichzelf toegang kan geven tot wat hij verstopt.
  const me = await guild.members.fetchMe();
  const botAccessId = me.roles.botRole?.id ?? me.id;

  /** Namen -> echte kanaal-ids, bijgewerkt zodra er iets wordt aangemaakt. */
  const categoryIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) categoryIds.set(normalize(channel.name), channel.id);
    else if (!channel.isThread()) channelIds.set(normalize(channel.name), channel.id);
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

    // Verstopt de template dit kanaal voor @everyone, dan raakt de bot het zelf
    // ook kwijt: hij is ook maar een lid. Daarna kan hij het niet meer bijwerken
    // of verwijderen. Daarom houdt hij hier een sleutel achter.
    if (hidesFromEveryone(overwrites) && !resolved.some((entry) => entry.id === botAccessId)) {
      resolved.push({ id: botAccessId, allow: PermissionFlagsBits.ViewChannel });
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
    if (spec.autoArchiveMinutes !== undefined) {
      options.defaultAutoArchiveDuration = spec.autoArchiveMinutes;
    }
    if (spec.type === 'forum') {
      if (spec.tags.length > 0) {
        options.availableTags = spec.tags.map((tag) => ({
          name: tag.name,
          moderated: tag.moderated,
          ...(tag.emoji ? { emoji: { id: null, name: tag.emoji } } : {}),
        }));
      }
      if (spec.defaultReaction) {
        options.defaultReactionEmoji = { id: null, name: spec.defaultReaction };
      }
    }
    return options;
  };

  /** Berichten horen bij het aanmaken: opnieuw toepassen post dus niets dubbel. */
  const postMessages = async (channelId: string, spec: ChannelSpec): Promise<void> => {
    if (spec.messages.length === 0) return;
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    for (const message of spec.messages) {
      const sent = await channel.send({ content: message.content, allowedMentions: { parse: [] } });
      if (message.pin) await sent.pin(reason);
    }
  };

  const automodOptions = (rule: AutomodSpec) => {
    const alertChannelId = rule.alertChannel ? channelIds.get(normalize(rule.alertChannel)) : undefined;

    const actions = [];
    if (rule.action === 'block') {
      actions.push({
        type: AutoModerationActionType.BlockMessage,
        metadata: rule.customMessage ? { customMessage: rule.customMessage } : {},
      });
    } else if (rule.action === 'alert') {
      if (!alertChannelId) throw new Error(`alertChannel "${rule.alertChannel}" niet gevonden`);
      actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannelId } });
    } else {
      actions.push({
        type: AutoModerationActionType.Timeout,
        metadata: { durationSeconds: rule.timeoutSeconds ?? 300 },
      });
    }

    const triggerMetadata =
      rule.trigger === 'keyword'
        ? { keywordFilter: rule.keywords, regexPatterns: rule.regexPatterns, allowList: rule.allowList }
        : rule.trigger === 'keyword_preset'
          ? { presets: rule.presets.map((preset) => AUTOMOD_PRESETS[preset]), allowList: rule.allowList }
          : rule.trigger === 'mention_spam'
            ? { mentionTotalLimit: rule.mentionLimit ?? 5 }
            : {};

    return {
      name: rule.name,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AUTOMOD_TRIGGERS[rule.trigger],
      triggerMetadata,
      actions,
      enabled: rule.enabled,
      exemptRoles: rule.exemptRoles.map((key) => roleIds.get(key)).filter((id): id is string => Boolean(id)),
      reason,
    };
  };

  for (const action of plan.actions) {
    try {
      switch (action.kind) {
        case 'create-role': {
          const created = await guild.roles.create({
            name: action.role.name,
            ...roleColor(action.role.color),
            hoist: action.role.hoist,
            mentionable: action.role.mentionable,
            permissions: toBitfield(action.role.permissions),
            reason,
          });
          roleIds.set(action.role.key, created.id);
          break;
        }

        case 'update-role': {
          const role = await guild.roles.fetch(action.roleId);
          if (!role) throw new Error('rol niet gevonden');
          await role.edit({
            ...roleColor(action.role.color),
            hoist: action.role.hoist,
            mentionable: action.role.mentionable,
            permissions: toBitfield(action.role.permissions),
            reason,
          });
          roleIds.set(action.role.key, role.id);
          break;
        }

        case 'create-category': {
          const created = await guild.channels.create({
            name: action.category.name,
            type: ChannelType.GuildCategory,
            permissionOverwrites: buildOverwrites(action.category.overwrites),
            reason,
          });
          categoryIds.set(normalize(action.category.name), created.id);
          break;
        }

        case 'update-category': {
          const category = (await guild.channels.fetch(action.channelId)) as CategoryChannel | null;
          if (!category) throw new Error('categorie niet gevonden');
          await category.permissionOverwrites.set(buildOverwrites(action.category.overwrites), reason);
          break;
        }

        case 'create-channel': {
          const parentId = action.categoryName ? categoryIds.get(normalize(action.categoryName)) ?? null : null;
          const created = await guild.channels.create({
            ...channelOptions(action.channel, parentId),
            reason,
          } as GuildChannelCreateOptions);
          channelIds.set(normalize(action.channel.name), created.id);
          await postMessages(created.id, action.channel);
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
            reason,
          });
          channelIds.set(normalize(action.channel.name), channel.id);
          break;
        }

        case 'delete-channel': {
          const channel = await guild.channels.fetch(action.channelId);
          if (!channel) break;
          await channel.delete(`Server-setup (prune): template "${template.name}"`);
          break;
        }

        case 'create-emoji': {
          await guild.emojis.create({
            attachment: action.emoji.image,
            name: action.emoji.name,
            roles: action.emoji.roles.map((key) => roleIds.get(key)).filter((id): id is string => Boolean(id)),
            reason,
          });
          break;
        }

        case 'create-automod': {
          await guild.autoModerationRules.create(automodOptions(action.rule));
          break;
        }

        case 'update-automod': {
          const { name, eventType, ...rest } = automodOptions(action.rule);
          await guild.autoModerationRules.edit(action.ruleId, { name, ...rest });
          break;
        }

        case 'order-channels': {
          await orderChannels(guild, template, categoryIds, channelIds, reason);
          break;
        }

        case 'order-roles': {
          const me = await guild.members.fetchMe();
          const warning = await orderRoles(guild, template, roleIds, me, reason);
          if (warning) result.errors.push(warning);
          break;
        }

        case 'onboarding': {
          if (!template.onboarding) break;
          await guild.editOnboarding({
            enabled: template.onboarding.enabled,
            mode:
              template.onboarding.mode === 'advanced'
                ? GuildOnboardingMode.OnboardingAdvanced
                : GuildOnboardingMode.OnboardingDefault,
            defaultChannels: template.onboarding.defaultChannels
              .map((name) => channelIds.get(normalize(name)))
              .filter((id): id is string => Boolean(id)),
            prompts: template.onboarding.prompts.map((prompt) => ({
              title: prompt.title,
              singleSelect: prompt.singleSelect,
              required: prompt.required,
              inOnboarding: true,
              options: prompt.options.map((option) => ({
                title: option.title,
                description: option.description ?? null,
                ...(option.emoji ? { emoji: option.emoji } : {}),
                roles: option.roles.map((key) => roleIds.get(key)).filter((id): id is string => Boolean(id)),
                channels: option.channels
                  .map((name) => channelIds.get(normalize(name)))
                  .filter((id): id is string => Boolean(id)),
              })),
            })),
            reason,
          });
          break;
        }

        case 'guild-community': {
          await enableCommunity(guild, template, channelIds, reason);
          break;
        }

        case 'guild-settings': {
          await applyGuildSettings(guild, template, channelIds, reason);
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

/**
 * Sinds discord.js 14.27 heet dit `colors` en waarschuwt `color` bij elk gebruik.
 * Geen kleur in de template betekent: laat de kleur met rust.
 */
function roleColor(color: string | undefined): { colors?: { primaryColor: number } } {
  if (!color) return {};
  return { colors: { primaryColor: Number.parseInt(color.replace('#', ''), 16) } };
}

/** Categorieen en kanalen in de volgorde zetten waarin ze in de template staan. */
async function orderChannels(
  guild: Guild,
  template: ServerTemplate,
  categoryIds: Map<string, string>,
  channelIds: Map<string, string>,
  reason: string,
): Promise<void> {
  const positions: { channel: string; position: number }[] = [];

  template.uncategorizedChannels.forEach((channel, index) => {
    const id = channelIds.get(normalize(channel.name));
    if (id) positions.push({ channel: id, position: index });
  });

  template.categories.forEach((category, index) => {
    const categoryId = categoryIds.get(normalize(category.name));
    if (categoryId) positions.push({ channel: categoryId, position: index });

    category.channels.forEach((channel, channelIndex) => {
      const id = channelIds.get(normalize(channel.name));
      if (id) positions.push({ channel: id, position: channelIndex });
    });
  });

  if (positions.length > 0) await guild.channels.setPositions(positions);
  void reason;
}

/**
 * Rollen krijgen de volgorde van de template, direct onder de rol van de bot.
 * Hoger dan zichzelf mag een bot niet komen, dus dat wordt gemeld in plaats van geprobeerd.
 */
async function orderRoles(
  guild: Guild,
  template: ServerTemplate,
  roleIds: Map<string, string>,
  me: GuildMember,
  reason: string,
): Promise<string | null> {
  const ids = template.roles
    .map((role) => roleIds.get(role.key))
    .filter((id): id is string => Boolean(id) && id !== guild.id);

  if (ids.length === 0) return null;

  const top = me.roles.highest.position - 1;
  if (top < ids.length) {
    return `rolvolgorde overgeslagen: de rol van de bot staat te laag (${top + 1}) voor ${ids.length} rollen.`;
  }

  await guild.roles.setPositions(ids.map((id, index) => ({ role: id, position: top - index })));
  void reason;
  return null;
}

/** Zet community-modus aan. Kan pas als het regels- en updateskanaal bestaan. */
async function enableCommunity(
  guild: Guild,
  template: ServerTemplate,
  channelIds: Map<string, string>,
  reason: string,
): Promise<void> {
  const settings = template.guild;
  const rulesChannel = settings.rulesChannel ? channelIds.get(normalize(settings.rulesChannel)) : undefined;
  const updatesChannel = settings.updatesChannel ? channelIds.get(normalize(settings.updatesChannel)) : undefined;

  if (!rulesChannel || !updatesChannel) {
    throw new Error('community-modus vereist een bestaand regels- en updateskanaal');
  }
  if (guild.features.includes('COMMUNITY')) return;

  await guild.edit({ rulesChannel, publicUpdatesChannel: updatesChannel, reason });

  // Discord accepteert COMMUNITY alleen met filter op alle leden en verificatie
  // minstens laag; wat de template daarvoor zegt wordt hier dus overruled.
  const level = VERIFICATION_LEVELS[settings.verificationLevel ?? 'low'];
  await guild.edit({
    features: [...guild.features, 'COMMUNITY'],
    verificationLevel: level === GuildVerificationLevel.None ? GuildVerificationLevel.Low : level,
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
    reason,
  });
}

async function applyGuildSettings(
  guild: Guild,
  template: ServerTemplate,
  channelIds: Map<string, string>,
  reason: string,
): Promise<void> {
  const settings = template.guild;
  const channelId = (name: string | undefined) => (name ? channelIds.get(normalize(name)) : undefined);

  await guild.edit({
    verificationLevel: settings.verificationLevel ? VERIFICATION_LEVELS[settings.verificationLevel] : undefined,
    explicitContentFilter: settings.explicitContentFilter
      ? CONTENT_FILTERS[settings.explicitContentFilter]
      : undefined,
    defaultMessageNotifications: settings.defaultMessageNotifications
      ? NOTIFICATION_LEVELS[settings.defaultMessageNotifications]
      : undefined,
    afkTimeout: settings.afkTimeoutSeconds,
    description: settings.description,
    icon: settings.icon,
    banner: settings.banner,
    reason,
  });

  // Kanaalverwijzingen en community-modus pas hierna: de kanalen moeten bestaan,
  // en Discord accepteert COMMUNITY alleen met een regels- en updateskanaal.
  const rulesChannel = channelId(settings.rulesChannel);
  const updatesChannel = channelId(settings.updatesChannel);

  await guild.edit({
    systemChannel: channelId(settings.systemChannel) ?? undefined,
    afkChannel: channelId(settings.afkChannel) ?? undefined,
    rulesChannel: rulesChannel ?? undefined,
    publicUpdatesChannel: updatesChannel ?? undefined,
    reason,
  });

  // Meestal staat community al aan door de eerdere stap; dit vangt het geval waarin
  // de kanalen er toen nog niet waren.
  if (settings.community && rulesChannel && updatesChannel && !guild.features.includes('COMMUNITY')) {
    await enableCommunity(guild, template, channelIds, reason);
  }
}
