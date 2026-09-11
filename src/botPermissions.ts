import { OAuth2Scopes, PermissionFlagsBits, PermissionsBitField, type Guild, type GuildMember } from 'discord.js';

/**
 * De rechten die de bot nodig heeft. Dit is de enige plek waar ze staan: de
 * invite-link, de default install-settings van de applicatie en de controle bij
 * het joinen lezen allemaal hiervandaan, zodat ze niet uit elkaar kunnen lopen.
 */

/** Zonder deze rechten kan geen enkele template uitgevoerd worden. */
export const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageGuild,
] as const;

/** Nodig om te kunnen terugkoppelen: berichten, embeds en het export-bestand. */
export const RECOMMENDED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
] as const;

export const INVITE_PERMISSIONS = new PermissionsBitField([
  ...REQUIRED_PERMISSIONS,
  ...RECOMMENDED_PERMISSIONS,
]);

export const INVITE_SCOPES = [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands] as const;

export function buildInviteUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: INVITE_SCOPES.join(' '),
    permissions: INVITE_PERMISSIONS.bitfield.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/** Leesbare naam bij een permissie-bit, bijvoorbeeld "ManageChannels". */
export function permissionLabel(permission: bigint): string {
  const entry = Object.entries(PermissionFlagsBits).find(([, value]) => value === permission);
  return entry?.[0] ?? String(permission);
}

export function missingPermissions(member: GuildMember): string[] {
  return REQUIRED_PERMISSIONS.filter((permission) => !member.permissions.has(permission)).map(permissionLabel);
}

/**
 * Discord staat niet toe dat een bot rollen aanmaakt of aanpast boven zijn eigen
 * hoogste rol. Met alleen ManageRoles ben je er dus nog niet.
 */
export function rolesAboveBot(guild: Guild, me: GuildMember): number {
  const ownPosition = me.roles.highest.position;
  return guild.roles.cache.filter(
    (role) => role.id !== guild.id && !role.managed && role.position > ownPosition,
  ).size;
}
