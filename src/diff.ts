import type { ServerTemplate } from './types.js';

/**
 * Wat is er veranderd tussen twee versies van een template? Hiermee schrijft de
 * versiegeschiedenis zichzelf: je hoeft bij het opslaan niets in te typen en ziet
 * toch waarom een versie er staat.
 */

export interface TemplateDiff {
  rolesAdded: string[];
  rolesRemoved: string[];
  rolesChanged: string[];
  categoriesAdded: string[];
  categoriesRemoved: string[];
  channelsAdded: string[];
  channelsRemoved: string[];
  settingsChanged: string[];
}

const namesOf = (template: ServerTemplate) => ({
  roles: new Map(template.roles.map((role) => [role.key, role])),
  categories: new Set(template.categories.map((category) => category.name)),
  channels: new Set([
    ...template.categories.flatMap((category) => category.channels.map((channel) => channel.name)),
    ...template.uncategorizedChannels.map((channel) => channel.name),
  ]),
});

const missing = <T>(from: Iterable<T>, inside: Set<T>) => [...from].filter((value) => !inside.has(value));

export function diffTemplates(before: ServerTemplate, after: ServerTemplate): TemplateDiff {
  const a = namesOf(before);
  const b = namesOf(after);

  const rolesChanged: string[] = [];
  for (const [key, role] of b.roles) {
    const oud = a.roles.get(key);
    if (!oud) continue;
    if (
      oud.name !== role.name ||
      oud.color !== role.color ||
      oud.hoist !== role.hoist ||
      oud.mentionable !== role.mentionable ||
      oud.permissions.join() !== role.permissions.join()
    ) {
      rolesChanged.push(role.name);
    }
  }

  const settingsChanged = [...new Set([...Object.keys(before.guild), ...Object.keys(after.guild)])].filter(
    (key) =>
      before.guild[key as keyof typeof before.guild] !== after.guild[key as keyof typeof after.guild],
  );

  return {
    rolesAdded: missing(b.roles.keys(), new Set(a.roles.keys())).map((key) => b.roles.get(key)?.name ?? key),
    rolesRemoved: missing(a.roles.keys(), new Set(b.roles.keys())).map((key) => a.roles.get(key)?.name ?? key),
    rolesChanged,
    categoriesAdded: missing(b.categories, a.categories),
    categoriesRemoved: missing(a.categories, b.categories),
    channelsAdded: missing(b.channels, a.channels),
    channelsRemoved: missing(a.channels, b.channels),
    settingsChanged,
  };
}

/** Eén regel: "2 rollen erbij · 1 kanaal weg". Leeg als er niets veranderde. */
export function summarizeDiff(diff: TemplateDiff): string {
  const delen: string[] = [];
  const tel = (aantal: number, enkel: string, meer: string, achter: string) => {
    if (aantal > 0) delen.push(`${aantal} ${aantal === 1 ? enkel : meer} ${achter}`);
  };

  tel(diff.rolesAdded.length, 'rol', 'rollen', 'erbij');
  tel(diff.rolesRemoved.length, 'rol', 'rollen', 'weg');
  tel(diff.rolesChanged.length, 'rol', 'rollen', 'aangepast');
  tel(diff.categoriesAdded.length, 'categorie', 'categorieen', 'erbij');
  tel(diff.categoriesRemoved.length, 'categorie', 'categorieen', 'weg');
  tel(diff.channelsAdded.length, 'kanaal', 'kanalen', 'erbij');
  tel(diff.channelsRemoved.length, 'kanaal', 'kanalen', 'weg');
  if (diff.settingsChanged.length > 0) delen.push('serverinstellingen aangepast');

  return delen.join(' · ');
}

export function describeDiff(diff: TemplateDiff): string[] {
  return [
    ...diff.rolesAdded.map((naam) => `+ rol @${naam}`),
    ...diff.rolesRemoved.map((naam) => `- rol @${naam}`),
    ...diff.rolesChanged.map((naam) => `~ rol @${naam}`),
    ...diff.categoriesAdded.map((naam) => `+ categorie ${naam}`),
    ...diff.categoriesRemoved.map((naam) => `- categorie ${naam}`),
    ...diff.channelsAdded.map((naam) => `+ kanaal ${naam}`),
    ...diff.channelsRemoved.map((naam) => `- kanaal ${naam}`),
    ...diff.settingsChanged.map((naam) => `~ instelling ${naam}`),
  ];
}
