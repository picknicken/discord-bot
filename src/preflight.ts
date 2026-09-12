import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { permissionLabel } from './botPermissions.js';
import { toBitfield } from './permissions.js';
import type { Plan } from './planner.js';
import type { ServerTemplate } from './types.js';

/**
 * Kan de bot deze template überhaupt uitvoeren?
 *
 * Discord kent twee regels die je pas merkt als het misgaat:
 *  - een bot mag geen recht uitdelen dat hij zelf niet heeft. Een rol met
 *    KickMembers aanmaken lukt dus alleen als de bot zelf mag kicken. Dat geldt
 *    net zo goed voor de rechten die je per kanaal aan- of uitzet.
 *  - community-modus aan- of uitzetten vraagt Administrator. Niets minder.
 *
 * Zonder controle vooraf merk je dat halverwege: een server die half af is, met
 * rollen die ontbreken en kanalen die hun rechten missen. Daarom kijken we eerst.
 */

export interface Shortfall {
  /** Waar het misgaat, bijvoorbeeld 'rol @Officier'. */
  where: string;
  /** Welke rechten de bot daarvoor mist. */
  permissions: string[];
}

const ADMINISTRATOR = PermissionFlagsBits.Administrator;

/** Welke rechten de bot mist voor deze set, gemeten aan wat hij zelf mag. */
function missend(permissions: readonly string[], botPermissions: PermissionsBitField): string[] {
  const nodig = new PermissionsBitField(toBitfield([...permissions]));
  return nodig.toArray().filter((name) => !botPermissions.has(PermissionFlagsBits[name]));
}

/**
 * Hetzelfde, maar dan voor wat er deze keer echt gaat gebeuren. Werk je alleen
 * de rollen bij, dan hoeft de bot niets te kunnen voor de kanalen - en een
 * template met community-modus hoeft je dan niet in de weg te zitten.
 */
export function planShortfalls(plan: Plan, botPermissions: PermissionsBitField): Shortfall[] {
  if (botPermissions.has(ADMINISTRATOR)) return [];

  const shortfalls: Shortfall[] = [];
  const voegToe = (where: string, permissions: readonly string[]) => {
    const missing = missend(permissions, botPermissions);
    if (missing.length > 0) shortfalls.push({ where, permissions: missing });
  };

  const uitOverwrites = (overwrites: readonly { allow: readonly string[]; deny: readonly string[] }[]) =>
    overwrites.flatMap((overwrite) => [...overwrite.allow, ...overwrite.deny]);

  for (const action of plan.actions) {
    switch (action.kind) {
      case 'guild-community':
        shortfalls.push({ where: 'community-modus aanzetten', permissions: [permissionLabel(ADMINISTRATOR)] });
        break;
      case 'create-role':
      case 'update-role':
        voegToe(`rol @${action.role.name}`, action.role.permissions);
        break;
      case 'create-category':
      case 'update-category':
        voegToe(`categorie ${action.category.name}`, uitOverwrites(action.category.overwrites));
        break;
      case 'create-channel':
      case 'update-channel':
        voegToe(`kanaal ${action.channel.name}`, uitOverwrites(action.channel.overwrites));
        break;
      default:
        break;
    }
  }

  return shortfalls;
}

/** Alles wat de template aan rechten uitdeelt, per plek waar dat gebeurt. */
export function permissionShortfalls(
  template: ServerTemplate,
  botPermissions: PermissionsBitField,
): Shortfall[] {
  // Administrator bevat alles; dan valt er niets te missen.
  if (botPermissions.has(ADMINISTRATOR)) return [];

  const shortfalls: Shortfall[] = [];

  const voegToe = (where: string, permissions: readonly string[]) => {
    const missing = missend(permissions, botPermissions);
    if (missing.length > 0) shortfalls.push({ where, permissions: missing });
  };

  if (template.guild.community) {
    shortfalls.push({ where: 'community-modus aanzetten', permissions: [permissionLabel(ADMINISTRATOR)] });
  }

  for (const role of template.roles) {
    voegToe(`rol @${role.name}`, role.permissions);
  }

  // Bij een overwrite telt allow en deny allebei: ook iets uitzetten mag alleen
  // als de bot dat recht zelf heeft.
  const uitOverwrites = (overwrites: ServerTemplate['categories'][number]['overwrites']) =>
    overwrites.flatMap((overwrite) => [...overwrite.allow, ...overwrite.deny]);

  for (const category of template.categories) {
    voegToe(`categorie ${category.name}`, uitOverwrites(category.overwrites));
    for (const channel of category.channels) {
      voegToe(`kanaal ${channel.name}`, uitOverwrites(channel.overwrites));
    }
  }
  for (const channel of template.uncategorizedChannels) {
    voegToe(`kanaal ${channel.name}`, uitOverwrites(channel.overwrites));
  }

  return shortfalls;
}

/** Alle rechten die de bot mist, ontdubbeld — genoeg voor één invite-link. */
export function missingForTemplate(shortfalls: readonly Shortfall[]): string[] {
  return [...new Set(shortfalls.flatMap((shortfall) => shortfall.permissions))].sort();
}

/** Wat je hiermee moet, in gewone taal. */
export function explainShortfalls(shortfalls: readonly Shortfall[], inviteUrl: string | null): string[] {
  if (shortfalls.length === 0) return [];

  const alles = missingForTemplate(shortfalls);
  const regels = [
    `De bot mist ${alles.length} recht${alles.length === 1 ? '' : 'en'} voor deze template:`,
    ...shortfalls.map((shortfall) => `  - ${shortfall.where}: ${shortfall.permissions.join(', ')}`),
    '',
    'Discord laat een bot geen recht uitdelen dat hij zelf niet heeft, en',
    'community-modus aanzetten mag alleen met Administrator.',
    '',
    'Oplossing: geef de rol van de bot Administrator (Serverinstellingen -> Rollen),',
    'of nodig hem opnieuw uit met de juiste rechten.',
  ];

  if (inviteUrl) regels.push('', `Uitnodigen met alles wat nodig is: ${inviteUrl}`);
  return regels;
}
