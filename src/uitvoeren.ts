import type { Guild } from 'discord.js';
import { applyPlan } from './applier.js';
import { backupGuild } from './backup.js';
import { missingPermissions } from './botPermissions.js';
import { maakHaalbaar } from './haalbaar.js';
import { filterPlan, type Onderdeel } from './onderdelen.js';
import { planSetup } from './planner.js';
import { logSetup } from './setupLog.js';
import { snapshotGuildFresh } from './snapshot.js';
import type { ServerTemplate } from './types.js';
import { logger } from './util/logger.js';
import { letopEmbed, meldInServer } from './util/melden.js';

/**
 * Een template uitrollen op één server, van begin tot eind.
 *
 * Het dashboard deed dit zelf, en de geplande uitrol zou het opnieuw moeten
 * doen: momentopname, plan, bijstellen naar wat de bot mag, uitvoeren, logboek,
 * en een bericht in de server als er iets bleef liggen. Twee keer dezelfde
 * volgorde onderhouden is één keer te veel - dan staat er op een dag in de ene
 * wel een back-up en in de andere niet.
 */
export interface Uitvoeropdracht {
  templateId: string;
  onderdelen: Onderdeel[];
  prune: boolean;
  update: boolean;
  /** Wie het startte; komt in het logboek. */
  door: string;
  backupsDir: string;
  historyDir: string;
  /** Standaard maakt hij eerst een momentopname. */
  backup?: boolean;
}

export interface Uitvoerresultaat {
  guildId: string;
  guildName: string;
  applied: number;
  failed: number;
  errors: string[];
  backup?: string | null;
  note?: string;
}

export async function rolUit(
  guild: Guild,
  template: ServerTemplate,
  opdracht: Uitvoeropdracht,
): Promise<Uitvoerresultaat> {
  const me = await guild.members.fetchMe();

  const missing = missingPermissions(me);
  if (missing.length > 0) {
    return {
      guildId: guild.id,
      guildName: guild.name,
      applied: 0,
      failed: 0,
      errors: [`de bot mist rechten: ${missing.join(', ')}`],
    };
  }

  const plan = filterPlan(
    planSetup(await snapshotGuildFresh(guild), template, { prune: opdracht.prune, update: opdracht.update }),
    opdracht.onderdelen,
  );

  const haalbaar = maakHaalbaar(plan, me.permissions, { alCommunity: guild.features.includes('COMMUNITY') });

  if (haalbaar.plan.actions.length === 0) {
    return { guildId: guild.id, guildName: guild.name, applied: 0, failed: 0, errors: [], note: 'niets te doen' };
  }

  // Altijd eerst een momentopname, tenzij de beller er expliciet om vraagt.
  const backupFile =
    opdracht.backup === false
      ? null
      : await backupGuild(guild, opdracht.backupsDir, opdracht.templateId).catch(() => null);

  logger.info(`"${opdracht.templateId}" naar "${guild.name}" (${haalbaar.plan.actions.length} acties)`);
  const result = await applyPlan(guild, template, haalbaar.plan);
  const meldingen = [...result.errors, ...haalbaar.aanpassingen];

  await logSetup(opdracht.historyDir, {
    at: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    template: opdracht.templateId,
    door: opdracht.door,
    mode: 'apply',
    onderdelen: opdracht.onderdelen,
    applied: result.applied,
    failed: result.failed,
    backup: backupFile,
    notes: meldingen,
  });

  const bericht = letopEmbed(template.name, meldingen);
  if (bericht) await meldInServer(guild, me, bericht);

  return {
    guildId: guild.id,
    guildName: guild.name,
    backup: backupFile,
    applied: result.applied,
    failed: result.failed,
    errors: meldingen,
  };
}
