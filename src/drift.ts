import type { Guild } from 'discord.js';
import { planSetup, summarizePlan } from './planner.js';
import { snapshotGuildFresh } from './snapshot.js';
import type { SetupRun } from './setupLog.js';
import { loadTemplateMet } from './templates.js';

/**
 * Wijkt een server af van de template die er het laatst op ging?
 *
 * Eén plek voor het dashboard en voor de controle die vanzelf loopt. Waarmee
 * vergeleken wordt komt uit het logboek: de laatste échte uitrol, niet een
 * preview - die zegt alleen dat je gekeken hebt.
 */
export interface DriftStatus {
  guildId: string;
  guildName: string;
  /** null als er nog nooit iets op deze server is uitgerold. */
  template: string | null;
  /** null als het niet te bepalen was; de reden staat dan in `fout`. */
  count: number | null;
  samenvatting: string | null;
  fout?: string;
}

export async function driftVanServer(
  guild: Guild,
  runs: readonly SetupRun[],
  templatesDir: string,
): Promise<DriftStatus> {
  const laatste = runs.find((run) => run.guildId === guild.id && run.mode === 'apply');
  if (!laatste) {
    return { guildId: guild.id, guildName: guild.name, template: null, count: null, samenvatting: null };
  }

  try {
    // Losjes: een template met variabelen is zonder ingevulde waarden niet te
    // laden, en dan zou deze server helemaal geen antwoord opleveren.
    const { template } = await loadTemplateMet(templatesDir, laatste.template, {}, { losjes: true });
    const plan = planSetup(await snapshotGuildFresh(guild, template), template, { prune: false, update: true });

    return {
      guildId: guild.id,
      guildName: guild.name,
      template: laatste.template,
      count: plan.actions.length,
      samenvatting: summarizePlan(plan),
    };
  } catch (error) {
    return {
      guildId: guild.id,
      guildName: guild.name,
      template: laatste.template,
      count: null,
      samenvatting: null,
      fout: error instanceof Error ? error.message : String(error),
    };
  }
}
