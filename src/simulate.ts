import { isValidPermission } from './permissions.js';
import type { CategorySpec, ChannelSpec, Overwrite, ServerTemplate } from './types.js';

/**
 * Rekent uit wat een lid met een bepaalde rol straks ziet, zonder de template uit
 * te rollen. Het model volgt hoe Discord kanalen aanmaakt: een kanaal zonder eigen
 * overwrites erft die van zijn categorie, een kanaal met eigen overwrites staat los.
 */

export interface VisibleChannel {
  name: string;
  type: ChannelSpec['type'];
  visible: boolean;
  /** Waarom het kanaal wel of niet zichtbaar is. */
  reason: string;
}

export interface VisibleCategory {
  name: string;
  channels: VisibleChannel[];
}

export interface Simulation {
  role: string;
  roleName: string;
  /** Heeft deze rol Administrator? Dan ziet hij per definitie alles. */
  administrator: boolean;
  categories: VisibleCategory[];
  uncategorized: VisibleChannel[];
  visibleCount: number;
  totalCount: number;
}

/** Overwrites die echt gelden voor dit kanaal. */
export function effectiveOverwrites(channel: ChannelSpec, category: CategorySpec | null): Overwrite[] {
  return channel.overwrites.length > 0 ? channel.overwrites : (category?.overwrites ?? []);
}

function guildLevelView(template: ServerTemplate, roleKey: string): { view: boolean; admin: boolean } {
  if (roleKey === '@everyone') return { view: true, admin: false };

  const role = template.roles.find((candidate) => candidate.key === roleKey);
  if (!role) return { view: true, admin: false };

  const admin = role.permissions.includes('Administrator');
  // @everyone heeft ViewChannel standaard aan; een rol erft dat.
  return { view: admin || true, admin };
}

function decide(
  template: ServerTemplate,
  roleKey: string,
  channel: ChannelSpec,
  category: CategorySpec | null,
): VisibleChannel {
  const { admin } = guildLevelView(template, roleKey);
  const base = { name: channel.name, type: channel.type };

  if (admin) return { ...base, visible: true, reason: 'Administrator ziet alles' };

  const overwrites = effectiveOverwrites(channel, category);
  const source = channel.overwrites.length > 0 ? 'kanaal' : 'categorie';
  const everyone = overwrites.find((overwrite) => overwrite.role === '@everyone');
  const own = roleKey === '@everyone' ? undefined : overwrites.find((overwrite) => overwrite.role === roleKey);

  let visible = true;
  let reason = 'geen overwrite — standaard zichtbaar';

  if (everyone?.deny.includes('ViewChannel')) {
    visible = false;
    reason = `@everyone mag het niet zien (${source})`;
  }
  if (everyone?.allow.includes('ViewChannel')) {
    visible = true;
    reason = `@everyone mag het zien (${source})`;
  }
  if (own?.deny.includes('ViewChannel')) {
    visible = false;
    reason = `deze rol wordt uitgesloten (${source})`;
  }
  if (own?.allow.includes('ViewChannel')) {
    visible = true;
    reason = `deze rol krijgt toegang (${source})`;
  }

  return { ...base, visible, reason };
}

export function simulate(template: ServerTemplate, roleKey: string): Simulation {
  const role = template.roles.find((candidate) => candidate.key === roleKey);
  const { admin } = guildLevelView(template, roleKey);

  const categories = template.categories.map((category) => ({
    name: category.name,
    channels: category.channels.map((channel) => decide(template, roleKey, channel, category)),
  }));
  const uncategorized = template.uncategorizedChannels.map((channel) => decide(template, roleKey, channel, null));

  const all = [...categories.flatMap((category) => category.channels), ...uncategorized];

  return {
    role: roleKey,
    roleName: roleKey === '@everyone' ? '@everyone' : role?.name ?? roleKey,
    administrator: admin,
    categories,
    uncategorized,
    visibleCount: all.filter((channel) => channel.visible).length,
    totalCount: all.length,
  };
}

/** Alle rollen die de template kent, met @everyone vooraan. */
export function simulatableRoles(template: ServerTemplate): { key: string; name: string }[] {
  return [{ key: '@everyone', name: '@everyone' }, ...template.roles.map((role) => ({ key: role.key, name: role.name }))];
}

/** Kanalen die door niemand gezien worden — bijna altijd een fout in de overwrites. */
export function channelsNobodySees(template: ServerTemplate): string[] {
  const roles = simulatableRoles(template);
  const seen = new Set<string>();

  for (const role of roles) {
    for (const channel of simulate(template, role.key).categories.flatMap((category) => category.channels)) {
      if (channel.visible) seen.add(channel.name);
    }
    for (const channel of simulate(template, role.key).uncategorized) {
      if (channel.visible) seen.add(channel.name);
    }
  }

  return template.categories
    .flatMap((category) => category.channels.map((channel) => channel.name))
    .concat(template.uncategorizedChannels.map((channel) => channel.name))
    .filter((name) => !seen.has(name));
}

/** Permissienamen die Discord niet kent, gegroepeerd per plek. Voor de dashboard-checks. */
export function unknownPermissionUse(template: ServerTemplate): string[] {
  const problems: string[] = [];
  const check = (where: string, names: readonly string[]) => {
    for (const name of names) if (!isValidPermission(name)) problems.push(`${where}: ${name}`);
  };
  for (const role of template.roles) check(`rol ${role.name}`, role.permissions);
  return problems;
}
