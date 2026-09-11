import { toBitfield } from './permissions.js';
import type { GuildSnapshot, SnapshotChannel } from './snapshot.js';
import type { CategorySpec, ChannelSpec, RoleSpec, ServerTemplate } from './types.js';

export interface PlanOptions {
  /** Verwijder kanalen/categorieen die niet in de template staan. */
  prune: boolean;
  /** Pas bestaande rollen en kanalen aan als ze afwijken van de template. */
  update: boolean;
}

export type PlanAction =
  | { kind: 'create-role'; role: RoleSpec }
  | { kind: 'update-role'; roleId: string; role: RoleSpec; changes: string[] }
  | { kind: 'create-category'; category: CategorySpec }
  | { kind: 'update-category'; channelId: string; category: CategorySpec; changes: string[] }
  | { kind: 'create-channel'; channel: ChannelSpec; categoryName: string | null }
  | { kind: 'update-channel'; channelId: string; channel: ChannelSpec; categoryName: string | null; changes: string[] }
  | { kind: 'delete-channel'; channelId: string; name: string; isCategory: boolean }
  | { kind: 'guild-settings'; changes: string[] };

export interface Plan {
  templateName: string;
  options: PlanOptions;
  actions: PlanAction[];
  warnings: string[];
}

const normalize = (value: string) => value.trim().toLowerCase();

function hexToInt(color: string | undefined): number | undefined {
  if (!color) return undefined;
  return Number.parseInt(color.replace('#', ''), 16);
}

function planRoles(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): PlanAction[] {
  const actions: PlanAction[] = [];
  const existingByName = new Map(
    snapshot.roles.filter((role) => !role.isEveryone && !role.managed).map((role) => [normalize(role.name), role]),
  );

  for (const role of template.roles) {
    const existing = existingByName.get(normalize(role.name));
    if (!existing) {
      actions.push({ kind: 'create-role', role });
      continue;
    }
    if (!options.update) continue;

    const changes: string[] = [];
    const wantedColor = hexToInt(role.color);
    if (wantedColor !== undefined && wantedColor !== existing.color) changes.push('kleur');
    if (role.hoist !== existing.hoist) changes.push('apart tonen');
    if (role.mentionable !== existing.mentionable) changes.push('vermeldbaar');
    if (toBitfield(role.permissions) !== existing.permissions) changes.push('permissies');

    if (changes.length > 0) {
      actions.push({ kind: 'update-role', roleId: existing.id, role, changes });
    }
  }

  return actions;
}

function channelChanges(spec: ChannelSpec, existing: SnapshotChannel): string[] {
  const changes: string[] = [];
  if (spec.topic !== undefined && (existing.topic ?? '') !== spec.topic) changes.push('topic');
  if (spec.nsfw !== existing.nsfw) changes.push('nsfw');
  if (spec.slowmodeSeconds !== existing.slowmodeSeconds) changes.push('slowmode');
  if (spec.userLimit !== undefined && existing.userLimit !== null && spec.userLimit !== existing.userLimit) {
    changes.push('gebruikerslimiet');
  }
  return changes;
}

function planChannels(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): {
  actions: PlanAction[];
  keptChannelIds: Set<string>;
  keptCategoryIds: Set<string>;
} {
  const actions: PlanAction[] = [];
  const keptChannelIds = new Set<string>();
  const keptCategoryIds = new Set<string>();

  const categoryByName = new Map(snapshot.categories.map((category) => [normalize(category.name), category]));

  const findChannel = (name: string, type: ChannelSpec['type'], parentId: string | null) =>
    snapshot.channels.find(
      (channel) =>
        normalize(channel.name) === normalize(name) &&
        channel.type === type &&
        (parentId === null || channel.parentId === parentId),
    );

  for (const category of template.categories) {
    const existingCategory = categoryByName.get(normalize(category.name));
    if (!existingCategory) {
      actions.push({ kind: 'create-category', category });
      for (const channel of category.channels) {
        actions.push({ kind: 'create-channel', channel, categoryName: category.name });
      }
      continue;
    }

    keptCategoryIds.add(existingCategory.id);
    if (options.update) {
      actions.push({
        kind: 'update-category',
        channelId: existingCategory.id,
        category,
        changes: ['permissies'],
      });
    }

    for (const channel of category.channels) {
      const existing = findChannel(channel.name, channel.type, existingCategory.id);
      if (!existing) {
        actions.push({ kind: 'create-channel', channel, categoryName: category.name });
        continue;
      }
      keptChannelIds.add(existing.id);
      if (!options.update) continue;
      const changes = channelChanges(channel, existing);
      changes.push('permissies');
      actions.push({
        kind: 'update-channel',
        channelId: existing.id,
        channel,
        categoryName: category.name,
        changes,
      });
    }
  }

  for (const channel of template.uncategorizedChannels) {
    const existing = findChannel(channel.name, channel.type, null);
    if (!existing) {
      actions.push({ kind: 'create-channel', channel, categoryName: null });
      continue;
    }
    keptChannelIds.add(existing.id);
    if (!options.update) continue;
    const changes = channelChanges(channel, existing);
    changes.push('permissies');
    actions.push({ kind: 'update-channel', channelId: existing.id, channel, categoryName: null, changes });
  }

  return { actions, keptChannelIds, keptCategoryIds };
}

function planGuildSettings(template: ServerTemplate): PlanAction[] {
  const changes = Object.entries(template.guild)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  return changes.length > 0 ? [{ kind: 'guild-settings', changes }] : [];
}

export function planSetup(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): Plan {
  const warnings: string[] = [];
  const actions: PlanAction[] = [...planRoles(snapshot, template, options)];

  const channelPlan = planChannels(snapshot, template, options);
  actions.push(...channelPlan.actions);

  if (options.prune) {
    for (const channel of snapshot.channels) {
      if (!channelPlan.keptChannelIds.has(channel.id)) {
        actions.push({ kind: 'delete-channel', channelId: channel.id, name: channel.name, isCategory: false });
      }
    }
    for (const category of snapshot.categories) {
      if (!channelPlan.keptCategoryIds.has(category.id)) {
        actions.push({ kind: 'delete-channel', channelId: category.id, name: category.name, isCategory: true });
      }
    }
  }

  actions.push(...planGuildSettings(template));

  const totalChannels = template.categories.reduce((sum, category) => sum + category.channels.length, 0) +
    template.uncategorizedChannels.length;
  if (snapshot.channels.length + totalChannels > 500) {
    warnings.push('Discord staat maximaal 500 kanalen per server toe; deze template past er mogelijk niet in.');
  }
  if (template.roles.length > 250) {
    warnings.push('Discord staat maximaal 250 rollen per server toe.');
  }

  return { templateName: template.name, options, actions, warnings };
}

export function summarizePlan(plan: Plan): string {
  if (plan.actions.length === 0) {
    return 'Geen wijzigingen nodig — de server komt al overeen met de template.';
  }

  const counts = new Map<PlanAction['kind'], number>();
  for (const action of plan.actions) {
    counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
  }

  const labels: Record<PlanAction['kind'], string> = {
    'create-role': 'rol aanmaken',
    'update-role': 'rol bijwerken',
    'create-category': 'categorie aanmaken',
    'update-category': 'categorie bijwerken',
    'create-channel': 'kanaal aanmaken',
    'update-channel': 'kanaal bijwerken',
    'delete-channel': 'verwijderen',
    'guild-settings': 'serverinstellingen',
  };

  return [...counts.entries()].map(([kind, count]) => `${count}x ${labels[kind]}`).join(' · ');
}

export function describeActions(plan: Plan, limit = 25): string[] {
  const lines = plan.actions.map((action) => {
    switch (action.kind) {
      case 'create-role':
        return `+ rol @${action.role.name}`;
      case 'update-role':
        return `~ rol @${action.role.name} (${action.changes.join(', ')})`;
      case 'create-category':
        return `+ categorie ${action.category.name}`;
      case 'update-category':
        return `~ categorie ${action.category.name}`;
      case 'create-channel':
        return `+ ${action.channel.type} #${action.channel.name}${action.categoryName ? ` in ${action.categoryName}` : ''}`;
      case 'update-channel':
        return `~ #${action.channel.name} (${action.changes.join(', ')})`;
      case 'delete-channel':
        return `- ${action.isCategory ? 'categorie' : 'kanaal'} ${action.name}`;
      case 'guild-settings':
        return `~ serverinstellingen (${action.changes.join(', ')})`;
    }
  });

  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `… en nog ${lines.length - limit} acties`];
}
