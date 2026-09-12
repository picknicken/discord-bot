import type { Guild } from 'discord.js';
import type { GuildSnapshot } from './snapshot.js';
import { logger } from './util/logger.js';

/**
 * Een server leeghalen: alle kanalen, alle rollen die de bot mag beheren, en de
 * AutoMod-regels. Bedoeld om een testserver opnieuw te kunnen gebruiken.
 *
 * Wat er nooit aan gaat:
 *  - @everyone, want die hoort bij de server zelf;
 *  - rollen van bots en integraties, die beheert Discord;
 *  - rollen die even hoog of hoger staan dan de bot, want dat weigert Discord toch;
 *  - leden, berichten, emoji's en de servernaam.
 */

export interface ResetTarget {
  id: string;
  name: string;
}

export interface ResetPlan {
  channels: ResetTarget[];
  roles: ResetTarget[];
  automod: ResetTarget[];
  /** Wat met opzet blijft staan, met de reden erbij. */
  skipped: string[];
}

export interface ResetResult {
  deleted: number;
  failed: number;
  errors: string[];
}

export function planReset(snapshot: GuildSnapshot, botHighestPosition: number): ResetPlan {
  const skipped: string[] = [];

  const roles: ResetTarget[] = [];
  for (const role of snapshot.roles) {
    if (role.isEveryone) continue;

    if (role.managed) {
      skipped.push(`rol "${role.name}" hoort bij een bot of integratie`);
      continue;
    }
    if (role.position >= botHighestPosition) {
      skipped.push(`rol "${role.name}" staat even hoog als of hoger dan de bot`);
      continue;
    }
    roles.push({ id: role.id, name: role.name });
  }

  return {
    // Categorieen achteraan: de kanalen erin gaan eerst weg.
    channels: [
      ...snapshot.channels.map((channel) => ({ id: channel.id, name: channel.name })),
      ...snapshot.categories.map((category) => ({ id: category.id, name: category.name })),
    ],
    roles,
    automod: snapshot.automod.map((rule) => ({ id: rule.id, name: rule.name })),
    skipped,
  };
}

export function describeReset(plan: ResetPlan): string[] {
  return [
    ...plan.channels.map((channel) => `- kanaal ${channel.name}`),
    ...plan.roles.map((role) => `- rol @${role.name}`),
    ...plan.automod.map((rule) => `- automod "${rule.name}"`),
    ...plan.skipped.map((reason) => `  blijft staan: ${reason}`),
  ];
}

export function countReset(plan: ResetPlan): number {
  return plan.channels.length + plan.roles.length + plan.automod.length;
}

export async function applyReset(guild: Guild, plan: ResetPlan, reason: string): Promise<ResetResult> {
  const result: ResetResult = { deleted: 0, failed: 0, errors: [] };

  const remove = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${what}: ${message}`);
      logger.warn(`Verwijderen mislukt (${what})`, message);
    }
  };

  for (const channel of plan.channels) {
    await remove(`kanaal ${channel.name}`, async () => {
      const target = await guild.channels.fetch(channel.id).catch(() => null);
      if (target) await target.delete(reason);
    });
  }

  for (const role of plan.roles) {
    await remove(`rol ${role.name}`, async () => {
      const target = await guild.roles.fetch(role.id).catch(() => null);
      if (target) await target.delete(reason);
    });
  }

  for (const rule of plan.automod) {
    await remove(`automod ${rule.name}`, async () => {
      await guild.autoModerationRules.delete(rule.id, reason);
    });
  }

  return result;
}
