import { z } from 'zod';
import { unknownPermissions } from './permissions.js';

const permissionList = z
  .array(z.string())
  .default([])
  .superRefine((names, ctx) => {
    const unknown = unknownPermissions(names);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Onbekende permissie(s): ${unknown.join(', ')}`,
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

export const channelSchema = z.object({
  name: z.string().min(1).max(100),
  type: channelTypeSchema.default('text'),
  topic: z.string().max(1024).optional(),
  nsfw: z.boolean().default(false),
  slowmodeSeconds: z.number().int().min(0).max(21600).default(0),
  /** Alleen voor voice/stage; 0 = geen limiet. */
  userLimit: z.number().int().min(0).max(99).optional(),
  overwrites: z.array(overwriteSchema).default([]),
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
  /** Kanaalnaam uit deze template. */
  systemChannel: z.string().optional(),
  afkChannel: z.string().optional(),
  afkTimeoutSeconds: z.union([
    z.literal(60),
    z.literal(300),
    z.literal(900),
    z.literal(1800),
    z.literal(3600),
  ]).optional(),
});

export const templateSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  guild: guildSettingsSchema.default({}),
  roles: z.array(roleSchema).default([]),
  categories: z.array(categorySchema).default([]),
  /** Kanalen zonder categorie, bovenaan de serverlijst. */
  uncategorizedChannels: z.array(channelSchema).default([]),
});

export type Overwrite = z.infer<typeof overwriteSchema>;
export type RoleSpec = z.infer<typeof roleSchema>;
export type ChannelSpec = z.infer<typeof channelSchema>;
export type CategorySpec = z.infer<typeof categorySchema>;
export type GuildSettingsSpec = z.infer<typeof guildSettingsSchema>;
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

/** Overwrites mogen alleen verwijzen naar rollen die de template zelf definieert. */
function validateReferences(template: ServerTemplate): ServerTemplate {
  const known = new Set<string>(template.roles.map((role) => role.key));
  known.add('@everyone');

  const problems: string[] = [];
  const check = (where: string, overwrites: Overwrite[]) => {
    for (const overwrite of overwrites) {
      if (!known.has(overwrite.role)) {
        problems.push(`${where}: overwrite verwijst naar onbekende rol "${overwrite.role}"`);
      }
    }
  };

  for (const category of template.categories) {
    check(`categorie "${category.name}"`, category.overwrites);
    for (const channel of category.channels) {
      check(`kanaal "${category.name}/${channel.name}"`, channel.overwrites);
    }
  }
  for (const channel of template.uncategorizedChannels) {
    check(`kanaal "${channel.name}"`, channel.overwrites);
  }

  const duplicateKeys = template.roles
    .map((role) => role.key)
    .filter((key, index, all) => all.indexOf(key) !== index);
  for (const key of new Set(duplicateKeys)) {
    problems.push(`dubbele rol-key "${key}"`);
  }

  if (problems.length > 0) {
    throw new Error(`Template is ongeldig:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return template;
}
