import { toBitfield } from './permissions.js';
import type { GuildSnapshot, SnapshotChannel } from './snapshot.js';
import type {
  AutomodSpec,
  CategorySpec,
  ChannelSpec,
  EmojiSpec,
  RoleSpec,
  ServerTemplate,
} from './types.js';

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
  | { kind: 'create-emoji'; emoji: EmojiSpec }
  | { kind: 'create-automod'; rule: AutomodSpec }
  | { kind: 'update-automod'; ruleId: string; rule: AutomodSpec }
  | { kind: 'order-channels'; count: number }
  | { kind: 'order-roles'; count: number }
  | { kind: 'onboarding'; prompts: number }
  | { kind: 'guild-community' }
  | { kind: 'guild-settings'; changes: string[] };

/** Deze kanaaltypes bestaan alleen op een Community-server. */
const COMMUNITY_ONLY: readonly ChannelSpec['type'][] = ['announcement', 'forum', 'stage'];

export const needsCommunity = (type: ChannelSpec['type']) => COMMUNITY_ONLY.includes(type);

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

function planEmojis(snapshot: GuildSnapshot, template: ServerTemplate): PlanAction[] {
  const existing = new Set(snapshot.emojis.map(normalize));
  return template.emojis
    .filter((emoji) => !existing.has(normalize(emoji.name)))
    .map((emoji) => ({ kind: 'create-emoji', emoji }));
}

function planAutomod(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): PlanAction[] {
  const existing = new Map(snapshot.automod.map((rule) => [normalize(rule.name), rule]));

  return template.automod.flatMap<PlanAction>((rule) => {
    const match = existing.get(normalize(rule.name));
    if (!match) return [{ kind: 'create-automod', rule }];
    return options.update ? [{ kind: 'update-automod', ruleId: match.id, rule }] : [];
  });
}

/** Staan de rollen die al bestaan in dezelfde volgorde als in de template? */
function rolesOutOfOrder(snapshot: GuildSnapshot, template: ServerTemplate): boolean {
  const byName = new Map(snapshot.roles.map((role) => [normalize(role.name), role]));
  const positions = template.roles
    .map((role) => byName.get(normalize(role.name))?.position)
    .filter((position): position is number => position !== undefined);

  // De template loopt van hoog naar laag, dus de posities horen te dalen.
  return positions.some((position, index) => index > 0 && position >= (positions[index - 1] ?? 0));
}

function channelsOutOfOrder(snapshot: GuildSnapshot, template: ServerTemplate): boolean {
  const categoryPositions = template.categories
    .map((category) => snapshot.categories.find((c) => normalize(c.name) === normalize(category.name))?.position)
    .filter((position): position is number => position !== undefined);

  if (categoryPositions.some((position, index) => index > 0 && position <= (categoryPositions[index - 1] ?? -1))) {
    return true;
  }

  for (const category of template.categories) {
    const parent = snapshot.categories.find((c) => normalize(c.name) === normalize(category.name));
    if (!parent) continue;
    const positions = category.channels
      .map((channel) =>
        snapshot.channels.find(
          (existing) => existing.parentId === parent.id && normalize(existing.name) === normalize(channel.name),
        )?.position,
      )
      .filter((position): position is number => position !== undefined);
    if (positions.some((position, index) => index > 0 && position <= (positions[index - 1] ?? -1))) return true;
  }

  return false;
}

function planGuildSettings(template: ServerTemplate): PlanAction[] {
  const changes = Object.entries(template.guild)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  return changes.length > 0 ? [{ kind: 'guild-settings', changes }] : [];
}

export function planSetup(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): Plan {
  const warnings: string[] = [];
  let actions: PlanAction[] = [...planRoles(snapshot, template, options)];

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

  // Discord weigert forum-, announcement- en stagekanalen zolang de server geen
  // Community-server is. Die moeten dus wachten tot dat aanstaat, en dat kan pas
  // als het regels- en updateskanaal bestaan.
  if (template.guild.community) {
    const later = actions.filter(
      (action) => action.kind === 'create-channel' && needsCommunity(action.channel.type),
    );
    if (later.length > 0) {
      actions = actions.filter((action) => !later.includes(action));
      actions.push({ kind: 'guild-community' }, ...later);
    }
  }

  actions.push(...planEmojis(snapshot, template));
  actions.push(...planAutomod(snapshot, template, options));

  const createdChannels = actions.some(
    (action) => action.kind === 'create-channel' || action.kind === 'create-category',
  );
  const templateChannelCount =
    template.categories.reduce((sum, category) => sum + category.channels.length, 0) +
    template.uncategorizedChannels.length;

  if (templateChannelCount > 0 && (createdChannels || channelsOutOfOrder(snapshot, template))) {
    actions.push({ kind: 'order-channels', count: templateChannelCount + template.categories.length });
  }

  const createdRoles = actions.some((action) => action.kind === 'create-role');
  if (template.roles.length > 1 && (createdRoles || rolesOutOfOrder(snapshot, template))) {
    actions.push({ kind: 'order-roles', count: template.roles.length });
  }

  if (template.onboarding) {
    actions.push({ kind: 'onboarding', prompts: template.onboarding.prompts.length });
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
    'create-emoji': 'emoji toevoegen',
    'create-automod': 'automod-regel aanmaken',
    'update-automod': 'automod-regel bijwerken',
    'order-channels': 'kanaalvolgorde zetten',
    'order-roles': 'rolvolgorde zetten',
    onboarding: 'onboarding instellen',
    'guild-community': 'community-modus aanzetten',
    'guild-settings': 'serverinstellingen',
  };

  return [...counts.entries()].map(([kind, count]) => `${count}x ${labels[kind]}`).join(' · ');
}

/**
 * Korte naam van één actie, voor foutmeldingen. "create-role" alleen zegt niets;
 * je wilt weten welke rol of welk kanaal het niet deed.
 */
export function actionLabel(action: PlanAction): string {
  switch (action.kind) {
    case 'create-role':
    case 'update-role':
      return `${action.kind} @${action.role.name}`;
    case 'create-category':
    case 'update-category':
      return `${action.kind} ${action.category.name}`;
    case 'create-channel':
    case 'update-channel':
      return `${action.kind} #${action.channel.name}`;
    case 'delete-channel':
      return `delete-channel ${action.name}`;
    case 'create-emoji':
      return `create-emoji :${action.emoji.name}:`;
    case 'create-automod':
    case 'update-automod':
      return `${action.kind} "${action.rule.name}"`;
    default:
      return action.kind;
  }
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
      case 'create-channel': {
        const extras = [action.channel.tags.length > 0 ? `${action.channel.tags.length} tags` : ''].filter(
          Boolean,
        );
        return (
          `+ ${action.channel.type} #${action.channel.name}` +
          (action.categoryName ? ` in ${action.categoryName}` : '') +
          (extras.length ? ` (${extras.join(', ')})` : '')
        );
      }
      case 'update-channel':
        return `~ #${action.channel.name} (${action.changes.join(', ')})`;
      case 'delete-channel':
        return `- ${action.isCategory ? 'categorie' : 'kanaal'} ${action.name}`;
      case 'create-emoji':
        return `+ emoji :${action.emoji.name}:`;
      case 'create-automod':
        return `+ automod "${action.rule.name}" (${action.rule.trigger})`;
      case 'update-automod':
        return `~ automod "${action.rule.name}"`;
      case 'order-channels':
        return `~ volgorde van ${action.count} kanalen/categorieen`;
      case 'order-roles':
        return `~ volgorde van ${action.count} rollen`;
      case 'onboarding':
        return `~ onboarding (${action.prompts} vragen)`;
      case 'guild-community':
        return '~ community-modus aanzetten (nodig voor forum- en announcementkanalen)';
      case 'guild-settings':
        return `~ serverinstellingen (${action.changes.join(', ')})`;
    }
  });

  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `… en nog ${lines.length - limit} acties`];
}
