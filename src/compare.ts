import type { GuildSnapshot } from './snapshot.js';
import type { ChannelSpec, ServerTemplate } from './types.js';

/**
 * Legt de template naast een echte server. Waar de planner acties oplevert
 * ("maak dit aan"), levert dit een beeld op: wat staat er al, wat komt erbij,
 * en — het interessantste — wat staat er op de server dat de template niet kent.
 */

export type ItemStatus = 'same' | 'new' | 'extra' | 'type-mismatch';

export interface ComparedChannel {
  name: string;
  type: ChannelSpec['type'];
  status: ItemStatus;
  note?: string;
}

export interface ComparedCategory {
  name: string;
  status: ItemStatus;
  channels: ComparedChannel[];
}

export interface ComparedRole {
  name: string;
  status: ItemStatus;
  color?: string;
}

export interface Comparison {
  guildName: string;
  roles: ComparedRole[];
  categories: ComparedCategory[];
  loose: ComparedChannel[];
  counts: Record<ItemStatus, number>;
}

const normalize = (value: string) => value.trim().toLowerCase();

export function compare(snapshot: GuildSnapshot, template: ServerTemplate): Comparison {
  const roles = compareRoles(snapshot, template);
  const { categories, loose } = compareChannels(snapshot, template);

  const everything: { status: ItemStatus }[] = [
    ...roles,
    ...categories,
    ...categories.flatMap((category) => category.channels),
    ...loose,
  ];

  return {
    guildName: snapshot.name,
    roles,
    categories,
    loose,
    counts: {
      same: everything.filter((item) => item.status === 'same').length,
      new: everything.filter((item) => item.status === 'new').length,
      extra: everything.filter((item) => item.status === 'extra').length,
      'type-mismatch': everything.filter((item) => item.status === 'type-mismatch').length,
    },
  };
}

function compareRoles(snapshot: GuildSnapshot, template: ServerTemplate): ComparedRole[] {
  // Rollen van bots en integraties horen hier niet: die beheert Discord zelf.
  const existing = snapshot.roles.filter((role) => !role.isEveryone && !role.managed);
  const inTemplate = new Set(template.roles.map((role) => normalize(role.name)));
  const onServer = new Map(existing.map((role) => [normalize(role.name), role]));

  return [
    ...template.roles.map((role) => ({
      name: role.name,
      color: role.color,
      status: (onServer.has(normalize(role.name)) ? 'same' : 'new') as ItemStatus,
    })),
    ...existing
      .filter((role) => !inTemplate.has(normalize(role.name)))
      .map((role) => ({
        name: role.name,
        color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined,
        status: 'extra' as ItemStatus,
      })),
  ];
}

function compareChannels(snapshot: GuildSnapshot, template: ServerTemplate) {
  const categoryByName = new Map(snapshot.categories.map((category) => [normalize(category.name), category]));
  const seenChannelIds = new Set<string>();

  const channelsUnder = (parentId: string | null) =>
    snapshot.channels.filter((channel) => channel.parentId === parentId);

  const compareOne = (spec: ChannelSpec, parentId: string | null): ComparedChannel => {
    const candidates = channelsUnder(parentId).filter(
      (channel) => normalize(channel.name) === normalize(spec.name),
    );
    const exact = candidates.find((channel) => channel.type === spec.type);

    if (exact) {
      seenChannelIds.add(exact.id);
      return { name: spec.name, type: spec.type, status: 'same' };
    }
    if (candidates[0]) {
      seenChannelIds.add(candidates[0].id);
      return {
        name: spec.name,
        type: spec.type,
        status: 'type-mismatch',
        note: `staat op de server als ${candidates[0].type}`,
      };
    }
    return { name: spec.name, type: spec.type, status: 'new' };
  };

  const categories: ComparedCategory[] = template.categories.map((category) => {
    const existing = categoryByName.get(normalize(category.name));
    const channels = category.channels.map((channel) => compareOne(channel, existing?.id ?? null));

    if (existing) {
      for (const channel of channelsUnder(existing.id)) {
        if (seenChannelIds.has(channel.id)) continue;
        channels.push({ name: channel.name, type: channel.type, status: 'extra' });
        seenChannelIds.add(channel.id);
      }
    }

    return { name: category.name, status: existing ? 'same' : 'new', channels };
  });

  const inTemplate = new Set(template.categories.map((category) => normalize(category.name)));
  for (const category of snapshot.categories) {
    if (inTemplate.has(normalize(category.name))) continue;
    categories.push({
      name: category.name,
      status: 'extra',
      channels: channelsUnder(category.id).map((channel) => {
        seenChannelIds.add(channel.id);
        return { name: channel.name, type: channel.type, status: 'extra' as ItemStatus };
      }),
    });
  }

  const loose: ComparedChannel[] = [
    ...template.uncategorizedChannels.map((channel) => compareOne(channel, null)),
    ...channelsUnder(null)
      .filter((channel) => !seenChannelIds.has(channel.id))
      .map((channel) => ({ name: channel.name, type: channel.type, status: 'extra' as ItemStatus })),
  ];

  return { categories, loose };
}
