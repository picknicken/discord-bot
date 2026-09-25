import { PermissionFlagsBits, PermissionsBitField, type Guild, type GuildMember, type Role } from 'discord.js';
import { toBitfield, toNames, unknownPermissions } from './permissions.js';

/**
 * Rollen rechtstreeks in een server aanpassen, zonder template.
 *
 * Voor "Moderator mag voortaan ook bannen" hoef je niet een hele template te
 * bewerken en uit te rollen. Het nadeel is bewust: de server wijkt daarna af van
 * zijn template, en de driftcontrole zegt dat ook. Wie het in de template wil
 * hebben, neemt de server daarna over.
 *
 * Discord bepaalt wat de bot mag, niet wij: alleen rollen onder zijn eigen rol,
 * geen rollen van integraties, en geen rechten die hij zelf niet heeft. Dat
 * zeggen we vooraf per rol, in plaats van een 50013 na het opslaan.
 */

export interface LiveRol {
  id: string;
  name: string;
  /** #rrggbb, of null voor "geen kleur". */
  color: string | null;
  hoist: boolean;
  mentionable: boolean;
  permissions: string[];
  position: number;
  everyone: boolean;
  managed: boolean;
  /** Waarom de bot deze rol niet kan aanpassen; null als het wel kan. */
  vast: string | null;
}

export interface RolWijziging {
  name?: string;
  color?: string | null;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string[];
}

export class RolFout extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const hex = (kleur: number): string | null => (kleur ? `#${kleur.toString(16).padStart(6, '0')}` : null);

/** Waarom de bot er niet aan mag komen, of null. */
export function waaromVast(guild: Guild, role: Role, me: GuildMember): string | null {
  if (role.managed) return 'Deze rol hoort bij een bot of integratie; die beheert Discord zelf.';
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'De bot mist het recht Rollen beheren in deze server.';
  }
  if (role.id !== guild.id && role.position >= me.roles.highest.position) {
    return 'Deze rol staat boven (of gelijk aan) de rol van de bot. Sleep de rol van de bot hoger in Serverinstellingen → Rollen.';
  }
  return null;
}

export async function beschrijfRollen(guild: Guild): Promise<{ rollen: LiveRol[]; botPositie: number }> {
  const me = await guild.members.fetchMe();
  const rollen = [...guild.roles.cache.values()]
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: hex(role.color),
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: toNames(role.permissions.bitfield),
      position: role.position,
      everyone: role.id === guild.id,
      managed: role.managed,
      vast: waaromVast(guild, role, me),
    }));
  return { rollen, botPositie: me.roles.highest.position };
}

/**
 * Controleert een wijziging en zet hem om naar wat discord.js verwacht. Gooit
 * een RolFout met een zin die je aan de gebruiker kunt laten zien.
 */
export function valideer(
  wijziging: RolWijziging,
  me: GuildMember,
  { everyone = false, huidig = 0n }: { everyone?: boolean; huidig?: bigint } = {},
) {
  const uit: { name?: string; color?: number; hoist?: boolean; mentionable?: boolean; permissions?: bigint } = {};

  if (wijziging.name !== undefined) {
    const naam = String(wijziging.name).trim();
    if (everyone) throw new RolFout('De naam van @everyone kan niet veranderen.');
    if (naam.length === 0 || naam.length > 100) throw new RolFout('Een rolnaam is 1 tot 100 tekens.');
    uit.name = naam;
  }

  if (wijziging.color !== undefined) {
    if (wijziging.color === null || wijziging.color === '') uit.color = 0;
    else if (/^#[0-9a-f]{6}$/i.test(wijziging.color)) uit.color = Number.parseInt(wijziging.color.slice(1), 16);
    else throw new RolFout(`Ongeldige kleur: "${wijziging.color}". Gebruik #rrggbb.`);
  }

  for (const sleutel of ['hoist', 'mentionable'] as const) {
    if (wijziging[sleutel] === undefined) continue;
    if (typeof wijziging[sleutel] !== 'boolean') throw new RolFout(`${sleutel} moet aan of uit zijn.`);
    uit[sleutel] = wijziging[sleutel];
  }

  if (wijziging.permissions !== undefined) {
    if (!Array.isArray(wijziging.permissions)) throw new RolFout('Rechten moeten een lijst zijn.');
    const onbekend = unknownPermissions(wijziging.permissions.map(String));
    if (onbekend.length) throw new RolFout(`Onbekende rechten: ${onbekend.join(', ')}.`);
    const bits = toBitfield(wijziging.permissions);

    // Discord laat een bot alleen rechten uitdelen die hij zelf heeft. Wat al op
    // de rol stond mag blijven staan; alleen wat er nieuw bij komt telt.
    if (!me.permissions.has(PermissionFlagsBits.Administrator)) {
      const erbij = bits & ~huidig;
      const nietVanMij = erbij & ~me.permissions.bitfield;
      if (nietVanMij) {
        throw new RolFout(
          `De bot kan alleen rechten geven die hij zelf heeft. Ontbreekt: ${toNames(nietVanMij).join(', ')}.`,
        );
      }
    }
    uit.permissions = bits;
  }

  return uit;
}

function vindRol(guild: Guild, roleId: string): Role {
  const role = guild.roles.cache.get(roleId);
  if (!role) throw new RolFout('Die rol bestaat niet (meer) in deze server.', 404);
  return role;
}

export async function wijzigRol(guild: Guild, roleId: string, wijziging: RolWijziging, door: string): Promise<LiveRol> {
  const role = vindRol(guild, roleId);
  const me = await guild.members.fetchMe();
  const vast = waaromVast(guild, role, me);
  if (vast) throw new RolFout(vast, 403);

  const velden = valideer(wijziging, me, {
    everyone: role.id === guild.id,
    huidig: new PermissionsBitField(role.permissions.bitfield).bitfield,
  });
  if (Object.keys(velden).length === 0) throw new RolFout('Er is niets om te wijzigen.');

  const nieuw = await role.edit({ ...velden, reason: `Dashboard: door ${door}` });
  return (await beschrijfRollen(guild)).rollen.find((rol) => rol.id === nieuw.id) as LiveRol;
}

export async function maakRol(guild: Guild, wijziging: RolWijziging, door: string): Promise<LiveRol> {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new RolFout('De bot mist het recht Rollen beheren in deze server.', 403);
  }
  const velden = valideer({ name: 'Nieuwe rol', ...wijziging }, me);
  const nieuw = await guild.roles.create({ ...velden, reason: `Dashboard: door ${door}` });
  return (await beschrijfRollen(guild)).rollen.find((rol) => rol.id === nieuw.id) as LiveRol;
}

export async function verwijderRol(guild: Guild, roleId: string, door: string): Promise<string> {
  const role = vindRol(guild, roleId);
  if (role.id === guild.id) throw new RolFout('@everyone kun je niet verwijderen.');
  const me = await guild.members.fetchMe();
  const vast = waaromVast(guild, role, me);
  if (vast) throw new RolFout(vast, 403);

  const naam = role.name;
  await role.delete(`Dashboard: door ${door}`);
  return naam;
}
