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
  type GuildFeature,
  type GuildChannelCreateOptions,
  type GuildMember,
  type OverwriteResolvable,
} from 'discord.js';
import { logger } from './util/logger.js';
import { toBitfield, toNames } from './permissions.js';
import { grantableBits, veiligeBits } from './haalbaar.js';
import { actionLabel, type Plan } from './planner.js';
import type { AutomodSpec, ChannelSpec, Overwrite, ServerTemplate } from './types.js';

/**
 * Verstopt deze set overwrites het kanaal voor @everyone? Zo ja, dan verliest de
 * bot zelf ook de toegang — die hoort immers ook bij @everyone.
 */
/** De rechten die er nu op een kanaal staan, per rol-id. */
function huidigeOverwrites(channel: {
  permissionOverwrites: { cache: Map<string, { allow: { bitfield: bigint }; deny: { bitfield: bigint } }> };
}): Map<string, { allow: bigint; deny: bigint }> {
  const huidig = new Map<string, { allow: bigint; deny: bigint }>();
  for (const [id, overwrite] of channel.permissionOverwrites.cache) {
    huidig.set(id, { allow: overwrite.allow.bitfield, deny: overwrite.deny.bitfield });
  }
  return huidig;
}

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

  // Wat deze bot mag uitdelen. Discord weigert elke opdracht waarin een recht
  // staat dat de bot zelf niet heeft, dus knippen we dat eraf in plaats van de
  // hele opdracht te laten mislukken. Wat we niet mogen aanraken laten we staan.
  const magBits = grantableBits(me.permissions);

  /**
   * Namen -> echte kanaal-ids, bijgewerkt zodra er iets wordt aangemaakt.
   *
   * Wat dit plan weggooit doet niet mee. Staan er twee kanalen met dezelfde naam
   * - de ene uit de template, de andere blijven liggen van een eerdere uitrol -
   * dan zou de laatste in de lijst winnen, en dat is willekeurig. Dan wees het
   * regelskanaal naar het kanaal dat net weg zou gaan.
   */
  const weg = new Set(
    plan.actions.filter((actie) => actie.kind === 'delete-channel').map((actie) => actie.channelId),
  );
  const categoryIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  for (const channel of guild.channels.cache.values()) {
    if (weg.has(channel.id)) continue;
    if (channel.type === ChannelType.GuildCategory) categoryIds.set(normalize(channel.name), channel.id);
    else if (!channel.isThread()) channelIds.set(normalize(channel.name), channel.id);
  }

  /**
   * Een weggegooid kanaal uit de naamlijst halen.
   *
   * Die lijst wordt bij het inloggen gevuld en daarna alleen aangevuld. Bleef een
   * verwijderd kanaal erin staan, dan wees de naam nog naar een id dat niet meer
   * bestaat en liep alles wat erna kwam daarop stuk: de onboarding kreeg "Unknown
   * channel" terug en het systeemkanaal werd niet gezet.
   *
   * Staat er nog een kanaal met dezelfde naam - en dat is nu juist het geval als
   * er een dubbele werd opgeruimd - dan wijst de naam daarna daarheen.
   */
  const vergeetKanaal = (id: string, isCategory: boolean) => {
    const lijst = isCategory ? categoryIds : channelIds;
    for (const [naam, bekend] of lijst) {
      if (bekend !== id) continue;
      const vervanger = [...guild.channels.cache.values()].find(
        (kanaal) =>
          kanaal.id !== id &&
          normalize(kanaal.name) === naam &&
          (kanaal.type === ChannelType.GuildCategory) === isCategory &&
          !kanaal.isThread(),
      );
      if (vervanger) lijst.set(naam, vervanger.id);
      else lijst.delete(naam);
    }
  };

  const buildOverwrites = (
    overwrites: Overwrite[],
    bestaand?: ReadonlyMap<string, { allow: bigint; deny: bigint }>,
  ): OverwriteResolvable[] => {
    const resolved: OverwriteResolvable[] = [];
    for (const overwrite of overwrites) {
      const id = roleIds.get(overwrite.role);
      if (!id) {
        result.errors.push(`Overwrite overgeslagen: rol "${overwrite.role}" bestaat (nog) niet.`);
        continue;
      }

      const huidig = bestaand?.get(id) ?? { allow: 0n, deny: 0n };
      const allow = veiligeBits(toBitfield(overwrite.allow), huidig.allow, magBits);
      const deny = veiligeBits(toBitfield(overwrite.deny), huidig.deny, magBits);

      const weg = toNames((toBitfield(overwrite.allow) | toBitfield(overwrite.deny)) & ~magBits);
      if (weg.length > 0) {
        result.errors.push(
          `Rechten overgeslagen voor "${overwrite.role}": ${weg.join(', ')} — de bot heeft dat zelf niet.`,
        );
      }

      resolved.push({ id, allow, deny });
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
          const gewenst = toBitfield(action.role.permissions);
          const weg = toNames(gewenst & ~magBits);
          if (weg.length > 0) {
            result.errors.push(
              `Rol @${action.role.name} aangemaakt zonder ${weg.join(', ')} — de bot heeft dat zelf niet.`,
            );
          }

          const created = await guild.roles.create({
            name: action.role.name,
            ...roleColor(action.role.color),
            hoist: action.role.hoist,
            mentionable: action.role.mentionable,
            permissions: gewenst & magBits,
            reason,
          });
          roleIds.set(action.role.key, created.id);
          break;
        }

        case 'update-role': {
          const role = await guild.roles.fetch(action.roleId);
          if (!role) throw new Error('rol niet gevonden');

          // Wat de bot niet mag uitdelen, laat hij staan zoals het stond: anders
          // haalt een bot zonder Administrator die permissie weg bij een rol die
          // hem al had.
          const gewenst = toBitfield(action.role.permissions);
          const weg = toNames((gewenst ^ role.permissions.bitfield) & ~magBits);
          if (weg.length > 0) {
            result.errors.push(
              `Rol @${action.role.name}: ${weg.join(', ')} ongemoeid gelaten — de bot heeft dat zelf niet.`,
            );
          }

          await role.edit({
            ...roleColor(action.role.color),
            hoist: action.role.hoist,
            mentionable: action.role.mentionable,
            permissions: veiligeBits(gewenst, role.permissions.bitfield, magBits),
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
          await category.permissionOverwrites.set(
            buildOverwrites(action.category.overwrites, huidigeOverwrites(category)),
            reason,
          );
          break;
        }

        case 'create-channel': {
          const parentId = action.categoryName ? categoryIds.get(normalize(action.categoryName)) ?? null : null;
          const created = await guild.channels.create({
            ...channelOptions(action.channel, parentId),
            reason,
          } as GuildChannelCreateOptions);
          channelIds.set(normalize(action.channel.name), created.id);
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
            permissionOverwrites: buildOverwrites(action.channel.overwrites, huidigeOverwrites(channel)),
            reason,
          });
          channelIds.set(normalize(action.channel.name), channel.id);
          break;
        }

        case 'delete-channel': {
          const channel = await guild.channels.fetch(action.channelId);
          if (!channel) break;
          await channel.delete(`Server-setup (prune): template "${template.name}"`);
          vergeetKanaal(action.channelId, action.isCategory);
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
          const meldingen = await applyGuildSettings(guild, template, channelIds, reason, {
            magCommunity: me.permissions.has(PermissionFlagsBits.Administrator),
          });
          result.errors.push(...meldingen);
          break;
        }
      }
      result.applied += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const label = actionLabel(action);
      result.errors.push(`${label}: ${message}`);
      logger.warn(`Actie mislukt (${label})`, message);
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
 * Welke plekken de rollen krijgen, gegeven de plek van de bot zelf.
 *
 * Een bot mag niets verplaatsen naar zijn eigen hoogte of hoger, dus alles komt
 * onder `botTop`. Plek 0 is @everyone en telt niet mee. Passen er niet genoeg
 * rollen onder de bot, dan doen we er zoveel als er passen en zeggen we dat -
 * beter een halve volgorde dan een geweigerde opdracht.
 */
export function rolePositions(
  ids: readonly string[],
  botRaw: number,
): { positions: { role: string; position: number }[]; warning: string | null } {
  // Plek 0 is @everyone, en de bot zelf blijft op zijn eigen plek staan. Wat
  // daartussen zit is de ruimte die hij mag uitdelen.
  const ruimte = botRaw - 1;

  if (ruimte < 1) {
    return {
      positions: [],
      warning:
        `rolvolgorde niet gezet: de rol van de bot staat op plek ${botRaw}, en daaronder is geen ruimte. ` +
        'Sleep de rol van de bot in Serverinstellingen -> Rollen boven de rollen van de template en draai dit opnieuw.',
    };
  }

  const passen = ids.slice(0, ruimte);
  const positions = passen.map((id, index) => ({ role: id, position: ruimte - index }));

  return {
    positions,
    warning:
      passen.length < ids.length
        ? `rolvolgorde deels gezet: er passen ${passen.length} van ${ids.length} rollen onder de rol van de bot ` +
          `(die staat op plek ${botRaw}). Sleep zijn rol hoger voor de rest.`
        : null,
  };
}

/**
 * Rollen krijgen de volgorde van de template, direct onder de rol van de bot.
 *
 * Let op het verschil tussen twee soorten "plek". Discord bewaart per rol een
 * ruw nummer, en dat mag bij meerdere rollen hetzelfde zijn - nieuwe rollen
 * komen er allemaal op 1 in. discord.js rekent daar een nette volgorde van
 * (`position`), maar de API praat in die ruwe nummers (`rawPosition`). Wie de
 * nette volgorde terugstuurt, mikt dus naast: op een server waar vier verse
 * rollen allemaal op ruw 1 staan, werd rol nummer vier zo boven de bot gezet -
 * en dat weigert Discord met een kale "Missing Permissions".
 *
 * Hier wordt daarom overal met het ruwe nummer gerekend.
 */
async function orderRoles(
  guild: Guild,
  template: ServerTemplate,
  roleIds: Map<string, string>,
  me: GuildMember,
  reason: string,
): Promise<string | null> {
  // Verse nummers ophalen: na het aanmaken klopt wat er in het geheugen staat niet meer.
  await guild.roles.fetch(undefined, { cache: true, force: true });

  const botRaw = me.roles.highest.rawPosition;
  const teHoog: string[] = [];

  // Zonder een bruikbaar nummer gaat er niets naar Discord: liever geen volgorde
  // dan een gok waarvan Discord er een "Missing Permissions" van maakt.
  if (!Number.isFinite(botRaw)) {
    return 'rolvolgorde overgeslagen: de plek van de rol van de bot is niet op te halen.';
  }

  const ids = template.roles
    .map((role) => roleIds.get(role.key))
    .filter((id): id is string => Boolean(id) && id !== guild.id)
    .filter((id) => {
      const role = guild.roles.cache.get(id);
      if (!role) return false;

      // Rollen die door een bot of integratie beheerd worden mag niemand
      // verslepen, en boven de bot uit mag het ook niet.
      if (role.managed) return false;
      if (role.rawPosition >= botRaw) {
        teHoog.push(`${role.name} (plek ${role.rawPosition})`);
        return false;
      }
      return true;
    });

  const meldingen: string[] = [];
  if (teHoog.length > 0) {
    meldingen.push(
      `rolvolgorde overgeslagen: de rol van de bot staat op plek ${botRaw}, en ${teHoog.join(', ')} ` +
        `${teHoog.length === 1 ? 'staat' : 'staan'} daar even hoog of hoger. Gelijk telt bij Discord niet als ` +
        'hoger, ook al lijkt de bot in de rollenlijst bovenaan te staan. Sleep zijn rol in Serverinstellingen ' +
        '-> Rollen een plek omhoog (of de andere rollen omlaag) en draai dit opnieuw.',
    );
  }

  if (ids.length > 0) {
    const { positions, warning } = rolePositions(ids, botRaw);
    if (positions.length > 0) await guild.roles.setPositions(positions);
    if (warning) meldingen.push(warning);
  }

  void reason;
  return meldingen.length > 0 ? meldingen.join(' ') : null;
}

/**
 * Verificatie en inhoudsfilter zoals Discord ze op een community-server accepteert:
 * filter op alle leden, verificatie minstens laag. Op een gewone server blijft
 * staan wat de template zegt.
 */
export function communitySafeSettings(
  verificationLevel: GuildVerificationLevel | undefined,
  explicitContentFilter: GuildExplicitContentFilter | undefined,
  community: boolean,
): { verificationLevel: GuildVerificationLevel | undefined; explicitContentFilter: GuildExplicitContentFilter | undefined } {
  if (!community) return { verificationLevel, explicitContentFilter };

  return {
    verificationLevel:
      verificationLevel === undefined || verificationLevel === GuildVerificationLevel.None
        ? GuildVerificationLevel.Low
        : verificationLevel,
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
  };
}

/** Zoals discord.js de kenmerken van een server teruggeeft: platte tekst. */
type Feature = `${GuildFeature}`;

/**
 * Wat er naar Discord gaat om community-modus aan te zetten.
 *
 * Dit moet in één keer. Een regelskanaal instellen op een server die nog geen
 * community is, weigert Discord ("Server rules channel is required"), en
 * COMMUNITY aanzetten zonder regelskanaal in hetzelfde verzoek weigert hij om
 * dezelfde reden. Twee losse verzoeken lopen dus altijd stuk; samen lukt het.
 *
 * Discord accepteert COMMUNITY bovendien alleen met het inhoudsfilter op alle
 * leden en verificatie minstens laag; wat de template daarvoor zegt wordt hier
 * overruled.
 */
export function communityEdit(
  features: readonly Feature[],
  verificationLevel: GuildVerificationLevel,
  rulesChannel: string,
  updatesChannel: string,
) {
  return {
    features: features.includes('COMMUNITY') ? [...features] : [...features, 'COMMUNITY' as Feature],
    rulesChannel,
    publicUpdatesChannel: updatesChannel,
    verificationLevel:
      verificationLevel === GuildVerificationLevel.None ? GuildVerificationLevel.Low : verificationLevel,
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
  };
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

  // Staat community al aan, dan hoeven de kenmerken niet mee: die aanpassen
  // vraagt Administrator, en alleen de kanalen zetten niet.
  if (guild.features.includes('COMMUNITY')) {
    await guild.edit({ rulesChannel, publicUpdatesChannel: updatesChannel, reason });
    return;
  }

  const level = VERIFICATION_LEVELS[settings.verificationLevel ?? 'low'];
  await guild.edit({ ...communityEdit(guild.features, level, rulesChannel, updatesChannel), reason });
}

async function applyGuildSettings(
  guild: Guild,
  template: ServerTemplate,
  channelIds: Map<string, string>,
  reason: string,
  opties: { magCommunity: boolean },
): Promise<string[]> {
  const meldingen: string[] = [];
  const settings = template.guild;
  const channelId = (name: string | undefined) => (name ? channelIds.get(normalize(name)) : undefined);

  // Community-modus staat op dit moment meestal al aan. Discord houdt daar dan
  // regels aan vast; sturen we hier toch iets anders, dan weigert hij de hele
  // opdracht en blijft ook de rest van de instellingen liggen.
  const community = settings.community || guild.features.includes('COMMUNITY');
  const { verificationLevel, explicitContentFilter } = communitySafeSettings(
    settings.verificationLevel ? VERIFICATION_LEVELS[settings.verificationLevel] : undefined,
    settings.explicitContentFilter ? CONTENT_FILTERS[settings.explicitContentFilter] : undefined,
    community,
  );

  await guild.edit({
    verificationLevel,
    explicitContentFilter,
    defaultMessageNotifications: settings.defaultMessageNotifications
      ? NOTIFICATION_LEVELS[settings.defaultMessageNotifications]
      : undefined,
    afkTimeout: settings.afkTimeoutSeconds,
    description: settings.description,
    icon: settings.icon,
    banner: settings.banner,
    reason,
  });

  // Kanaalverwijzingen pas hierna: de kanalen moeten bestaan. Verse lijst, want
  // een kanaal dat we net maakten moet Discord ook echt kennen.
  await guild.channels.fetch(undefined, { cache: true, force: true });

  /**
   * Eén verwijzing per opdracht. Samen in één opdracht betekent dat een kanaal
   * dat Discord weigert de andere verwijzingen meesleurt - zo bleef eerder het
   * systeemkanaal liggen door een regelskanaal dat nog niet mocht.
   */
  const zetVerwijzing = async (
    wat: string,
    naam: string | undefined,
    soort: 'text' | 'voice',
    veld: 'systemChannel' | 'afkChannel' | 'rulesChannel' | 'publicUpdatesChannel',
  ) => {
    if (!naam) return;

    const id = channelId(naam);
    if (!id) {
      meldingen.push(`${wat} niet gezet: kanaal "${naam}" is niet aangemaakt.`);
      return;
    }

    const kanaal = guild.channels.cache.get(id);
    const klopt =
      soort === 'text' ? kanaal?.type === ChannelType.GuildText : kanaal?.type === ChannelType.GuildVoice;

    if (!klopt) {
      meldingen.push(
        `${wat} niet gezet: "${naam}" bestaat niet meer of is geen ${soort === 'text' ? 'tekst' : 'spraak'}kanaal.`,
      );
      return;
    }

    try {
      await guild.edit({ [veld]: id, reason });
    } catch (error) {
      const uitleg = error instanceof Error ? error.message : String(error);
      meldingen.push(`${wat} niet gezet ("${naam}"): ${uitleg}`);
      logger.warn(`${wat} niet gezet ("${naam}"): ${uitleg}`);
    }
  };

  await zetVerwijzing('systeemkanaal', settings.systemChannel, 'text', 'systemChannel');
  await zetVerwijzing('afk-kanaal', settings.afkChannel, 'voice', 'afkChannel');

  const rulesChannel = channelId(settings.rulesChannel);
  const updatesChannel = channelId(settings.updatesChannel);

  // Meestal staat community al aan door de eerdere stap; dit vangt het geval waarin
  // de kanalen er toen nog niet waren. Zonder Administrator weigert Discord het
  // toch, dus dan proberen we het niet eens.
  if (settings.community && rulesChannel && updatesChannel && !guild.features.includes('COMMUNITY')) {
    if (!opties.magCommunity) {
      meldingen.push('community-modus niet aangezet: dat vraagt Administrator, en die heeft de bot niet.');
      return meldingen;
    }
    await enableCommunity(guild, template, channelIds, reason);
    return meldingen;
  }

  // Het regels- en updateskanaal bestaan alleen op een community-server; op een
  // gewone server weigert Discord ze.
  if (!guild.features.includes('COMMUNITY')) return meldingen;

  await zetVerwijzing('regelskanaal', settings.rulesChannel, 'text', 'rulesChannel');
  await zetVerwijzing('updateskanaal', settings.updatesChannel, 'text', 'publicUpdatesChannel');
  return meldingen;
}
