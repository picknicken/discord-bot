import {
  AutoModerationActionType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildOnboardingMode,
  GuildVerificationLevel,
  OverwriteType,
  type AutoModerationRule,
  type Guild,
  type GuildBasedChannel,
  type GuildOnboarding,
} from 'discord.js';
import { leesRolmenus, type GeplaatstRolmenu } from './rolmenu.js';
import type { AutomodSpec, ChannelSpec, GuildSettingsSpec, OnboardingSpec, ServerTemplate } from './types.js';

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
  automod: SnapshotAutomod[];
  /** De serverinstellingen zoals ze nu staan. */
  settings: SnapshotSettings;
  /** Gevuld zodra de caller de onboarding heeft opgehaald. */
  onboarding: SnapshotOnboarding | null;
  /** De rolmenu's die nu in de kanalen van de template staan. */
  rolmenus: GeplaatstRolmenu[];
  /**
   * Is er naar de rolmenu's gekeken?
   *
   * Niet gekeken is iets anders dan niets gevonden. Zonder dit onderscheid zou de
   * planner bij elke momentopname zonder template denken dat er nog geen enkel
   * rolmenu staat, en ze allemaal opnieuw plaatsen.
   */
  rolmenusGelezen: boolean;
}

/**
 * De serverinstellingen die een template kan zetten, zoals ze nu staan.
 *
 * Kanalen staan hier als id, niet als naam: namen kunnen dubbel voorkomen en
 * veranderen, het id niet.
 */
export interface SnapshotSettings {
  verificationLevel: NonNullable<GuildSettingsSpec['verificationLevel']>;
  explicitContentFilter: NonNullable<GuildSettingsSpec['explicitContentFilter']>;
  defaultMessageNotifications: NonNullable<GuildSettingsSpec['defaultMessageNotifications']>;
  systemChannelId: string | null;
  afkChannelId: string | null;
  rulesChannelId: string | null;
  updatesChannelId: string | null;
  afkTimeoutSeconds: number;
  description: string | null;
  community: boolean;
}

/** Eén actie van een AutoMod-regel: wat er gebeurt als de regel afgaat. */
export interface SnapshotAutomodActie {
  soort: AutomodSpec['action'];
  customMessage: string | null;
  timeoutSeconds: number | null;
  channelId: string | null;
}

/**
 * Een AutoMod-regel zoals hij nu op de server staat.
 *
 * Alleen de naam bewaren was niet genoeg: dan wist de planner wel dat de regel
 * bestond, maar niet of hij nog klopte, en werd hij bij elke uitrol opnieuw
 * geschreven.
 */
export interface SnapshotAutomod {
  id: string;
  name: string;
  enabled: boolean;
  /** null bij een triggertype dat een template niet kent. */
  trigger: AutomodSpec['trigger'] | null;
  keywords: string[];
  regexPatterns: string[];
  allowList: string[];
  presets: AutomodSpec['presets'];
  mentionLimit: number | null;
  acties: SnapshotAutomodActie[];
  exemptRoleIds: string[];
}

export interface SnapshotOnboardingOptie {
  title: string;
  description: string | null;
  emoji: string | null;
  roleIds: string[];
  channelIds: string[];
}

export interface SnapshotOnboardingVraag {
  title: string;
  singleSelect: boolean;
  required: boolean;
  options: SnapshotOnboardingOptie[];
}

export interface SnapshotOnboarding {
  enabled: boolean;
  mode: NonNullable<OnboardingSpec['mode']>;
  defaultChannelIds: string[];
  prompts: SnapshotOnboardingVraag[];
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

/**
 * Discord-waarden terug naar de woorden die in een template staan.
 *
 * Andersom staat het in de applier; deze kant is nodig om te kunnen zien of een
 * instelling al goed staat.
 */
export const VERIFICATIE = {
  [GuildVerificationLevel.None]: 'none',
  [GuildVerificationLevel.Low]: 'low',
  [GuildVerificationLevel.Medium]: 'medium',
  [GuildVerificationLevel.High]: 'high',
  [GuildVerificationLevel.VeryHigh]: 'very_high',
} as const satisfies Record<GuildVerificationLevel, NonNullable<GuildSettingsSpec['verificationLevel']>>;

export const INHOUDSFILTER = {
  [GuildExplicitContentFilter.Disabled]: 'disabled',
  [GuildExplicitContentFilter.MembersWithoutRoles]: 'members_without_roles',
  [GuildExplicitContentFilter.AllMembers]: 'all_members',
} as const satisfies Record<GuildExplicitContentFilter, NonNullable<GuildSettingsSpec['explicitContentFilter']>>;

export const MELDINGEN = {
  [GuildDefaultMessageNotifications.AllMessages]: 'all_messages',
  [GuildDefaultMessageNotifications.OnlyMentions]: 'only_mentions',
} as const satisfies Record<
  GuildDefaultMessageNotifications,
  NonNullable<GuildSettingsSpec['defaultMessageNotifications']>
>;

export const TRIGGER_NAMEN = {
  [AutoModerationRuleTriggerType.Keyword]: 'keyword',
  [AutoModerationRuleTriggerType.KeywordPreset]: 'keyword_preset',
  [AutoModerationRuleTriggerType.Spam]: 'spam',
  [AutoModerationRuleTriggerType.MentionSpam]: 'mention_spam',
} as const;

export const PRESET_NAMEN = {
  [AutoModerationRuleKeywordPresetType.Profanity]: 'profanity',
  [AutoModerationRuleKeywordPresetType.SexualContent]: 'sexual_content',
  [AutoModerationRuleKeywordPresetType.Slurs]: 'slurs',
} as const;

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

function leesInstellingen(guild: Guild): SnapshotSettings {
  return {
    verificationLevel: VERIFICATIE[guild.verificationLevel],
    explicitContentFilter: INHOUDSFILTER[guild.explicitContentFilter],
    defaultMessageNotifications: MELDINGEN[guild.defaultMessageNotifications],
    systemChannelId: guild.systemChannelId,
    afkChannelId: guild.afkChannelId,
    rulesChannelId: guild.rulesChannelId,
    updatesChannelId: guild.publicUpdatesChannelId,
    afkTimeoutSeconds: guild.afkTimeout,
    description: guild.description,
    community: guild.features.includes('COMMUNITY'),
  };
}

/** Eén AutoMod-actie van Discord in de vorm waarin wij hem vergelijken. */
function leesAutomodActie(actie: AutoModerationRule['actions'][number]): SnapshotAutomodActie | null {
  if (actie.type === AutoModerationActionType.BlockMessage) {
    return {
      soort: 'block',
      customMessage: actie.metadata.customMessage ?? null,
      timeoutSeconds: null,
      channelId: null,
    };
  }
  if (actie.type === AutoModerationActionType.SendAlertMessage) {
    return { soort: 'alert', customMessage: null, timeoutSeconds: null, channelId: actie.metadata.channelId ?? null };
  }
  if (actie.type === AutoModerationActionType.Timeout) {
    return {
      soort: 'timeout',
      customMessage: null,
      timeoutSeconds: actie.metadata.durationSeconds ?? null,
      channelId: null,
    };
  }
  return null;
}

function leesAutomod(rule: AutoModerationRule): SnapshotAutomod {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    trigger: TRIGGER_NAMEN[rule.triggerType as keyof typeof TRIGGER_NAMEN] ?? null,
    keywords: [...(rule.triggerMetadata.keywordFilter ?? [])],
    regexPatterns: [...(rule.triggerMetadata.regexPatterns ?? [])],
    allowList: [...(rule.triggerMetadata.allowList ?? [])],
    presets: [...(rule.triggerMetadata.presets ?? [])]
      .map((preset) => PRESET_NAMEN[preset as keyof typeof PRESET_NAMEN])
      .filter((preset): preset is (typeof PRESET_NAMEN)[keyof typeof PRESET_NAMEN] => Boolean(preset)),
    mentionLimit: rule.triggerMetadata.mentionTotalLimit ?? null,
    acties: rule.actions
      .map(leesAutomodActie)
      .filter((actie): actie is SnapshotAutomodActie => actie !== null),
    exemptRoleIds: [...rule.exemptRoles.keys()],
  };
}

function leesOnboarding(onboarding: GuildOnboarding): SnapshotOnboarding {
  return {
    enabled: onboarding.enabled,
    mode: onboarding.mode === GuildOnboardingMode.OnboardingAdvanced ? 'advanced' : 'default',
    defaultChannelIds: [...onboarding.defaultChannels.keys()],
    prompts: [...onboarding.prompts.values()].map((prompt) => ({
      title: prompt.title,
      singleSelect: prompt.singleSelect,
      required: prompt.required,
      options: [...prompt.options.values()].map((option) => ({
        title: option.title,
        description: option.description,
        emoji: option.emoji?.name ?? null,
        roleIds: [...option.roles.keys()],
        channelIds: [...option.channels.keys()],
      })),
    })),
  };
}

export function snapshotGuild(
  guild: Guild,
  onboarding: GuildOnboarding | null = null,
  rolmenus: GeplaatstRolmenu[] | null = null,
): GuildSnapshot {
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
    automod: guild.autoModerationRules.cache.map(leesAutomod),
    settings: leesInstellingen(guild),
    onboarding: onboarding ? leesOnboarding(onboarding) : null,
    rolmenus: rolmenus ?? [],
    rolmenusGelezen: rolmenus !== null,
  };
}

/**
 * Zelfde als `snapshotGuild`, maar haalt eerst de AutoMod-regels en de onboarding
 * op: die staan niet standaard in de cache, en zonder die stap zou de planner ze
 * allemaal opnieuw aanmaken.
 */
export async function snapshotGuildFresh(
  guild: Guild,
  template: ServerTemplate | null = null,
): Promise<GuildSnapshot> {
  await guild.autoModerationRules.fetch().catch(() => null);
  const onboarding = await guild.fetchOnboarding().catch(() => null);

  // Rolmenu's staan in berichten, en alleen in de kanalen waar de template ze wil.
  // Zonder template weten we niet waar we moeten kijken, en doen we dus niet
  // alsof we gekeken hebben.
  const rolmenus = template
    ? await leesRolmenus(guild, template.roleMenus.map((menu) => menu.channel))
    : null;

  return snapshotGuild(guild, onboarding, rolmenus);
}
