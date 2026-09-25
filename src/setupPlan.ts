import type { Guild } from 'discord.js';
import { planSetup, type Plan } from './planner.js';
import { snapshotGuildFresh } from './snapshot.js';
import { loadTemplateMet, type GeladenTemplate } from './templates.js';
import { maakHaalbaar } from './haalbaar.js';
import { applyPlan, type ApplyResult } from './applier.js';
import { backupGuild } from './backup.js';
import { logSetup } from './setupLog.js';
import type { ServerTemplate } from './types.js';

export interface SetupPlanOpties {
  prune?: boolean;
  update?: boolean;
  variabelen?: Record<string, string>;
}

export interface SetupPlanResultaat extends GeladenTemplate {
  plan: Plan;
  aanpassingen: string[];
}

/**
 * Van templatenaam naar uitvoerbaar plan: laden, tegen de server aanhouden, en
 * bijstellen naar wat deze bot hier kan uitvoeren. Precies de stappen van
 * `/setup preview` en `/setup apply` — één plek, zodat een preview via MCP of
 * het dashboard nooit iets anders laat zien dan `/setup preview` zelf zou doen.
 * Er is hier maar één planner, niet één per manier waarop je erom vraagt.
 */
export async function maakSetupPlan(
  guild: Guild,
  templatesDir: string,
  templateId: string,
  opties: SetupPlanOpties = {},
): Promise<SetupPlanResultaat> {
  const geladen = await loadTemplateMet(templatesDir, templateId, opties.variabelen ?? {});

  const plan = planSetup(await snapshotGuildFresh(guild, geladen.template), geladen.template, {
    prune: opties.prune ?? false,
    update: opties.update ?? true,
  });

  const me = await guild.members.fetchMe();
  const haalbaar = maakHaalbaar(plan, me.permissions, {
    alCommunity: guild.features.includes('COMMUNITY'),
  });

  return { ...geladen, plan: haalbaar.plan, aanpassingen: haalbaar.aanpassingen };
}

export interface SetupUitvoerResultaat extends ApplyResult {
  backupFile: string | null;
  /** Wat mislukte, plus wat bijgesteld werd bij het maken van het plan. */
  letop: string[];
}

/**
 * Het plan echt uitvoeren: eerst een momentopname, dan pas aanpassen, dan
 * loggen wat er gebeurde. Dezelfde drie stappen, in dezelfde volgorde, voor
 * `/setup apply`, het dashboard en MCP — er is hier maar één manier waarop
 * een template op een server wordt losgelaten.
 */
export async function voerSetupUit(
  guild: Guild,
  backupsDir: string,
  historyDir: string,
  templateId: string,
  template: ServerTemplate,
  plan: Plan,
  aanpassingen: readonly string[],
  door: string,
): Promise<SetupUitvoerResultaat> {
  const backupFile = await backupGuild(guild, backupsDir, templateId).catch(() => null);
  const result = await applyPlan(guild, template, plan);
  const letop = [...result.errors, ...aanpassingen];

  await logSetup(historyDir, {
    at: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    template: templateId,
    door,
    mode: 'apply',
    onderdelen: [],
    applied: result.applied,
    failed: result.failed,
    backup: backupFile,
    notes: letop,
  });

  return { ...result, backupFile, letop };
}
