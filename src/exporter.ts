import {
  AutoModerationActionType,
  ChannelType,
  type AnyThreadChannel,
  type AutoModerationRule,
  type Guild,
  type GuildBasedChannel,
} from 'discord.js';
import { toNames } from './permissions.js';
import {
  mapChannelType,
  PRESET_NAMEN,
  snapshotGuildFresh,
  TRIGGER_NAMEN,
  type GuildSnapshot,
  type SnapshotOnboarding,
  type SnapshotSettings,
} from './snapshot.js';
import type { AutomodSpec, CategorySpec, ChannelSpec, Overwrite, RoleSpec, ServerTemplate } from './types.js';

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'rol';

/** Leest een bestaande server uit als template, zodat je hem elders kunt herhalen. */
/**
 * De afk-tijd zoals Discord hem accepteert. Iets anders weigert hij, dus zetten
 * we hem liever niet in de template dan er een verzonnen waarde in te doen.
 */
const AFK_TIJDEN = [60, 300, 900, 1800, 3600] as const;

const afkTijd = (seconden: number) =>
  (AFK_TIJDEN as readonly number[]).includes(seconden)
    ? (seconden as (typeof AFK_TIJDEN)[number])
    : undefined;

/**
 * De onboarding van ids terug naar namen.
 *
 * In de server staan rollen en kanalen als id; een template kent alleen namen en
 * rolsleutels. Wat niet meer bestaat laten we weg - anders levert de export een
 * template op die nergens meer op uit te rollen is.
 */
function onboardingUitServer(
  onboarding: SnapshotOnboarding,
  guild: Guild,
  roleKeys: ReadonlyMap<string, string>,
): ServerTemplate['onboarding'] {
  const kanaalNaam = (id: string) => guild.channels.cache.get(id)?.name;
  const namen = (ids: readonly string[]) => ids.map(kanaalNaam).filter((naam): naam is string => Boolean(naam));
  const sleutels = (ids: readonly string[]) =>
    ids.map((id) => roleKeys.get(id)).filter((key): key is string => Boolean(key));

  return {
    enabled: onboarding.enabled,
    mode: onboarding.mode,
    defaultChannels: namen(onboarding.defaultChannelIds),
    prompts: onboarding.prompts.map((vraag) => ({
      title: vraag.title,
      singleSelect: vraag.singleSelect,
      required: vraag.required,
      options: vraag.options.map((optie) => ({
        title: optie.title,
        description: optie.description ?? undefined,
        emoji: optie.emoji ?? undefined,
        roles: sleutels(optie.roleIds),
        channels: namen(optie.channelIds),
      })),
    })),
  };
}

/**
 * @param extra De momentopname, voor de dingen die niet rechtstreeks uit een
 *   guild-object te lezen zijn: de serverinstellingen in template-woorden, en de
 *   onboarding. Zonder deze blijven die uit de export - en dan levert
 *   "overnemen" een template op die nog steeds afwijkt.
 */
export function exportGuild(
  guild: Guild,
  templateName = guild.name,
  extra?: { settings: SnapshotSettings; onboarding: SnapshotOnboarding | null },
): ServerTemplate {
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
    // Rolmenu's staan in berichten en niet in de structuur van de server; die
    // leest een export dus niet mee.
    roleMenus: [],
    guild: {
      description: guild.description ?? undefined,
      systemChannel: channelName(guild.systemChannelId),
      afkChannel: channelName(guild.afkChannelId),
      rulesChannel: channelName(guild.rulesChannelId),
      updatesChannel: channelName(guild.publicUpdatesChannelId),
      community: guild.features.includes('COMMUNITY') || undefined,
      ...(extra
        ? {
            verificationLevel: extra.settings.verificationLevel,
            explicitContentFilter: extra.settings.explicitContentFilter,
            defaultMessageNotifications: extra.settings.defaultMessageNotifications,
            afkTimeoutSeconds: afkTijd(extra.settings.afkTimeoutSeconds),
          }
        : {}),
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
    automod: [...guild.autoModerationRules.cache.values()].map((rule) =>
      automodUitServer(rule, roleKeys, channelName),
    ),
    ...(extra?.onboarding ? { onboarding: onboardingUitServer(extra.onboarding, guild, roleKeys) } : {}),
  };
}

/**
 * Zelfde als `exportGuild`, maar haalt eerst de AutoMod-regels op.
 *
 * Die staan niet in de cache. Zonder deze stap kwam er een template uit zonder
 * je AutoMod-regels — en het vervelende was: zonder dat iets dat zei. Je dacht
 * een kopie van je server te hebben en miste stilletjes een stuk.
 */
export async function exportGuildFresh(guild: Guild, templateName = guild.name): Promise<ServerTemplate> {
  // De momentopname haalt de AutoMod-regels en de onboarding op, en vertaalt de
  // serverinstellingen naar de woorden die in een template staan.
  const snapshot: GuildSnapshot = await snapshotGuildFresh(guild);
  return exportGuild(guild, templateName, { settings: snapshot.settings, onboarding: snapshot.onboarding });
}

/** Een AutoMod-regel van Discord terug naar de vorm die in een template past. */
export function automodUitServer(
  rule: AutoModerationRule,
  roleKeys: Map<string, string>,
  channelName: (id: string | null) => string | undefined,
): AutomodSpec {
  const trigger = TRIGGER_NAMEN[rule.triggerType as keyof typeof TRIGGER_NAMEN] ?? 'spam';
  const blokkeer = rule.actions.find((actie) => actie.type === AutoModerationActionType.BlockMessage);
  const melden = rule.actions.find((actie) => actie.type === AutoModerationActionType.SendAlertMessage);
  const timeout = rule.actions.find((actie) => actie.type === AutoModerationActionType.Timeout);

  return {
    name: rule.name,
    trigger,
    keywords: [...(rule.triggerMetadata.keywordFilter ?? [])],
    regexPatterns: [...(rule.triggerMetadata.regexPatterns ?? [])],
    allowList: [...(rule.triggerMetadata.allowList ?? [])],
    presets: [...(rule.triggerMetadata.presets ?? [])]
      .map((preset) => PRESET_NAMEN[preset as keyof typeof PRESET_NAMEN])
      .filter(Boolean),
    mentionLimit: rule.triggerMetadata.mentionTotalLimit ?? undefined,
    // Discord staat meerdere acties toe; een template kent er één. Blokkeren is
    // de zwaarste en wint, daarna melden, dan time-out.
    action: blokkeer ? 'block' : melden ? 'alert' : timeout ? 'timeout' : 'block',
    customMessage: blokkeer?.metadata.customMessage ?? undefined,
    timeoutSeconds: timeout?.metadata.durationSeconds ?? undefined,
    alertChannel: melden?.metadata.channelId ? channelName(melden.metadata.channelId) : undefined,
    exemptRoles: rule.exemptRoles.map((rol) => roleKeys.get(rol.id) ?? '').filter(Boolean),
    enabled: rule.enabled,
  };
}
