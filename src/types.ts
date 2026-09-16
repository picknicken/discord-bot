import { z } from 'zod';
import { PERMISSION_NAMES, unknownPermissions } from './permissions.js';
import { bedoeldeJe } from './bedoeldeJe.js';

const permissionList = z
  .array(z.string())
  .default([])
  .superRefine((names, ctx) => {
    const unknown = unknownPermissions(names);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Onbekende permissie(s): ${unknown
          .map((naam) => `${naam}${bedoeldeJe(naam, PERMISSION_NAMES)}`)
          .join(', ')}`,
      });
    }
  });

export const overwriteSchema = z.object({
  /** Rol-key uit `roles`, of "@everyone". */
  role: z.string(),
  allow: permissionList,
  deny: permissionList,
});

export const roleSchema = z.object({
  /** Stabiele sleutel waarnaar overwrites verwijzen. */
  key: z.string().min(1),
  name: z.string().min(1).max(100),
  /** Hex-kleur, bijvoorbeeld "#5865F2". */
  color: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, 'Kleur moet een hexwaarde zijn zoals #5865F2')
    .optional(),
  hoist: z.boolean().default(false),
  mentionable: z.boolean().default(false),
  permissions: permissionList,
});

export const channelTypeSchema = z.enum(['text', 'voice', 'forum', 'announcement', 'stage']);

export const forumTagSchema = z.object({
  name: z.string().min(1).max(20),
  emoji: z.string().optional(),
  /** Alleen moderators mogen deze tag zetten. */
  moderated: z.boolean().default(false),
});

export const channelSchema = z.object({
  name: z.string().min(1).max(100),
  type: channelTypeSchema.default('text'),
  topic: z.string().max(1024).optional(),
  nsfw: z.boolean().default(false),
  slowmodeSeconds: z.number().int().min(0).max(21600).default(0),
  /** Alleen voor voice/stage; 0 = geen limiet. */
  userLimit: z.number().int().min(0).max(99).optional(),
  overwrites: z.array(overwriteSchema).default([]),
  /** Alleen forum. */
  tags: z.array(forumTagSchema).default([]),
  defaultReaction: z.string().optional(),
  autoArchiveMinutes: z
    .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
    .optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1).max(100),
  overwrites: z.array(overwriteSchema).default([]),
  channels: z.array(channelSchema).default([]),
});

export const guildSettingsSchema = z.object({
  verificationLevel: z.enum(['none', 'low', 'medium', 'high', 'very_high']).optional(),
  explicitContentFilter: z.enum(['disabled', 'members_without_roles', 'all_members']).optional(),
  defaultMessageNotifications: z.enum(['all_messages', 'only_mentions']).optional(),
  /** Kanaalnamen uit deze template. */
  systemChannel: z.string().optional(),
  afkChannel: z.string().optional(),
  rulesChannel: z.string().optional(),
  updatesChannel: z.string().optional(),
  afkTimeoutSeconds: z
    .union([z.literal(60), z.literal(300), z.literal(900), z.literal(1800), z.literal(3600)])
    .optional(),
  description: z.string().max(300).optional(),
  /** Pad of https-URL naar een afbeelding. */
  icon: z.string().optional(),
  banner: z.string().optional(),
  /** Community-modus aanzetten. Vereist een regels- en updateskanaal. */
  community: z.boolean().optional(),
});

export const emojiSchema = z.object({
  name: z.string().regex(/^\w{2,32}$/, 'Emojinaam: 2-32 tekens, alleen letters, cijfers en _'),
  /** Pad of https-URL naar png/jpg/gif, maximaal 256 KB. */
  image: z.string().min(1),
  /** Rol-keys die deze emoji mogen gebruiken; leeg = iedereen. */
  roles: z.array(z.string()).default([]),
});

export const automodSchema = z.object({
  name: z.string().min(1).max(100),
  trigger: z.enum(['keyword', 'keyword_preset', 'spam', 'mention_spam']),
  /** trigger: keyword */
  keywords: z.array(z.string()).default([]),
  regexPatterns: z.array(z.string()).default([]),
  allowList: z.array(z.string()).default([]),
  /** trigger: keyword_preset */
  presets: z.array(z.enum(['profanity', 'sexual_content', 'slurs'])).default([]),
  /** trigger: mention_spam */
  mentionLimit: z.number().int().min(1).max(50).optional(),
  action: z.enum(['block', 'alert', 'timeout']).default('block'),
  /** Tekst die het lid ziet bij een geblokkeerd bericht. */
  customMessage: z.string().max(150).optional(),
  timeoutSeconds: z.number().int().min(1).max(2419200).optional(),
  /** Kanaalnaam waar meldingen heen gaan (verplicht bij action "alert"). */
  alertChannel: z.string().optional(),
  exemptRoles: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

export const onboardingOptionSchema = z.object({
  title: z.string().min(1).max(50),
  description: z.string().max(100).optional(),
  emoji: z.string().optional(),
  /** Rol-keys die het lid krijgt bij deze keuze. */
  roles: z.array(z.string()).default([]),
  /** Kanaalnamen die zichtbaar worden bij deze keuze. */
  channels: z.array(z.string()).default([]),
});

export const onboardingPromptSchema = z.object({
  title: z.string().min(1).max(100),
  /** Eén keuze in plaats van meerdere. */
  singleSelect: z.boolean().default(false),
  required: z.boolean().default(false),
  options: z.array(onboardingOptionSchema).min(1),
});

export const onboardingSchema = z.object({
  enabled: z.boolean().default(true),
  /** "advanced" telt de onboardingvragen mee voor de opzetvereisten van Discord. */
  mode: z.enum(['default', 'advanced']).default('default'),
  /** Kanalen die elk nieuw lid sowieso ziet. */
  defaultChannels: z.array(z.string()).default([]),
  prompts: z.array(onboardingPromptSchema).default([]),
});

/** Variabelen die de template zelf opgeeft, om bij het uitrollen in te vullen. */
export const variabeleSchema = z.object({
  beschrijving: z.string().max(200).optional(),
  standaard: z.string().max(200).optional(),
});

export const templateSchema = z.object({
  name: z.string().min(1),
  /** `{{naam}}` in de rest van de template wordt hiermee ingevuld. */
  variables: z.record(z.string(), variabeleSchema).default({}),
  description: z.string().default(''),
  guild: guildSettingsSchema.default({}),
  roles: z.array(roleSchema).default([]),
  categories: z.array(categorySchema).default([]),
  /** Kanalen zonder categorie, bovenaan de serverlijst. */
  uncategorizedChannels: z.array(channelSchema).default([]),
  emojis: z.array(emojiSchema).default([]),
  automod: z.array(automodSchema).default([]),
  onboarding: onboardingSchema.optional(),
});

export type Overwrite = z.infer<typeof overwriteSchema>;
export type RoleSpec = z.infer<typeof roleSchema>;
export type ChannelSpec = z.infer<typeof channelSchema>;
export type CategorySpec = z.infer<typeof categorySchema>;
export type GuildSettingsSpec = z.infer<typeof guildSettingsSchema>;
export type EmojiSpec = z.infer<typeof emojiSchema>;
export type AutomodSpec = z.infer<typeof automodSchema>;
export type OnboardingSpec = z.infer<typeof onboardingSchema>;
export type ServerTemplate = z.infer<typeof templateSchema>;

/** Parse + valideer, met een leesbare foutmelding in plaats van een zod-dump. */
export function parseTemplate(input: unknown): ServerTemplate {
  const result = templateSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Template is ongeldig:\n${details}`);
  }
  return validateReferences(result.data);
}

/** Alles wat naar een rol of kanaal verwijst moet ook echt in de template staan. */
function validateReferences(template: ServerTemplate): ServerTemplate {
  const roleKeys = new Set<string>(template.roles.map((role) => role.key));
  roleKeys.add('@everyone');

  const channelNames = new Set<string>([
    ...template.categories.flatMap((category) => category.channels.map((channel) => channel.name)),
    ...template.uncategorizedChannels.map((channel) => channel.name),
  ]);

  const problems: string[] = [];

  const alleRollen = [...roleKeys];
  const alleKanalen = [...channelNames];

  const checkRoles = (where: string, keys: readonly string[]) => {
    for (const key of keys) {
      if (!roleKeys.has(key)) {
        problems.push(`${where}: onbekende rol "${key}"${bedoeldeJe(key, alleRollen)}`);
      }
    }
  };
  const checkChannel = (where: string, name: string | undefined) => {
    if (name && !channelNames.has(name)) {
      problems.push(`${where}: onbekend kanaal "${name}"${bedoeldeJe(name, alleKanalen)}`);
    }
  };

  for (const category of template.categories) {
    checkRoles(`categorie "${category.name}"`, category.overwrites.map((o) => o.role));
    for (const channel of category.channels) {
      checkRoles(`kanaal "${category.name}/${channel.name}"`, channel.overwrites.map((o) => o.role));
      if (channel.type !== 'forum' && channel.tags.length > 0) {
        problems.push(`kanaal "${channel.name}": tags werken alleen in een forumkanaal`);
      }
    }
  }
  for (const channel of template.uncategorizedChannels) {
    checkRoles(`kanaal "${channel.name}"`, channel.overwrites.map((o) => o.role));
  }

  for (const emoji of template.emojis) checkRoles(`emoji "${emoji.name}"`, emoji.roles);

  for (const rule of template.automod) {
    checkRoles(`automod "${rule.name}"`, rule.exemptRoles);
    checkChannel(`automod "${rule.name}"`, rule.alertChannel);
    if (rule.action === 'alert' && !rule.alertChannel) {
      problems.push(`automod "${rule.name}": action "alert" heeft een alertChannel nodig`);
    }
    if (rule.trigger === 'keyword' && rule.keywords.length === 0 && rule.regexPatterns.length === 0) {
      problems.push(`automod "${rule.name}": trigger "keyword" heeft keywords of regexPatterns nodig`);
    }
    if (rule.trigger === 'keyword_preset' && rule.presets.length === 0) {
      problems.push(`automod "${rule.name}": trigger "keyword_preset" heeft presets nodig`);
    }
  }

  if (template.onboarding) {
    for (const channel of template.onboarding.defaultChannels) {
      checkChannel('onboarding', channel);
    }
    for (const prompt of template.onboarding.prompts) {
      for (const option of prompt.options) {
        checkRoles(`onboarding "${prompt.title}"`, option.roles);
        for (const channel of option.channels) checkChannel(`onboarding "${prompt.title}"`, channel);
      }
    }
  }

  for (const name of ['systemChannel', 'afkChannel', 'rulesChannel', 'updatesChannel'] as const) {
    checkChannel(`guild.${name}`, template.guild[name]);
  }
  if (template.guild.community && (!template.guild.rulesChannel || !template.guild.updatesChannel)) {
    problems.push('guild.community vereist zowel rulesChannel als updatesChannel');
  }

  const duplicateKeys = template.roles
    .map((role) => role.key)
    .filter((key, index, all) => all.indexOf(key) !== index);
  for (const key of new Set(duplicateKeys)) problems.push(`dubbele rol-key "${key}"`);

  if (problems.length > 0) {
    throw new Error(`Template is ongeldig:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return template;
}
