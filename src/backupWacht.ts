import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from 'discord.js';
import { backupGuild, listBackups, type BackupEntry } from './backup.js';
import { serverToegestaan } from './toegestaan.js';
import { logger } from './util/logger.js';

/**
 * Een momentopname zonder dat iemand erom vraagt.
 *
 * Er werd alleen een back-up gemaakt vlak voor een uitrol of een leeghaal.
 * Gebeurt er een maand niets en gaat er dan iets mis - iemand gooit een
 * categorie weg - dan is je laatste momentopname een maand oud, of er is er
 * geen.
 *
 * Deze rondes zijn gemerkt als "vanzelf". Alleen die worden opgeruimd; een
 * back-up van vlak voor een uitrol blijft staan, want die heb je juist bewaard
 * omdat er iets stond te gebeuren.
 */
export const VANZELF = 'vanzelf';

/**
 * Welke automatische back-ups mogen weg?
 *
 * De nieuwste `bewaar` blijven staan, per server. Zonder opruimen loopt een
 * volume vol met honderden bestanden die niemand ooit opent.
 */
export function welkeWegKunnen(entries: readonly BackupEntry[], bewaar: number): BackupEntry[] {
  const perServer = new Map<string, BackupEntry[]>();

  for (const entry of entries) {
    if (entry.label !== VANZELF) continue;
    const lijst = perServer.get(entry.guildId) ?? [];
    lijst.push(entry);
    perServer.set(entry.guildId, lijst);
  }

  const weg: BackupEntry[] = [];
  for (const lijst of perServer.values()) {
    // listBackups levert nieuwste eerst; alles voorbij de grens is oud nieuws.
    weg.push(...[...lijst].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(bewaar));
  }
  return weg;
}

async function ronde(
  client: Client<true>,
  opties: { backupsDir: string; toegestaneServers: readonly string[]; bewaar: number },
): Promise<void> {
  const servers = [...client.guilds.cache.values()].filter((guild) =>
    serverToegestaan(guild.id, opties.toegestaneServers),
  );

  for (const guild of servers) {
    try {
      const bestand = await backupGuild(guild, opties.backupsDir, VANZELF);
      logger.info(`Momentopname van "${guild.name}": ${path.basename(bestand)}`);
    } catch (error) {
      logger.warn(`Geen momentopname van "${guild.name}"`, error);
    }
  }

  for (const oud of welkeWegKunnen(await listBackups(opties.backupsDir), opties.bewaar)) {
    await unlink(path.join(opties.backupsDir, oud.file)).catch(() => null);
  }
}

/** Start de momentopnames. 0 uur is uit. */
export function startBackupWacht(
  client: Client<true>,
  opties: { backupsDir: string; toegestaneServers: readonly string[]; uren: number; bewaar: number },
): NodeJS.Timeout | null {
  if (opties.uren <= 0) return null;

  let bezig = false;
  const kijk = async () => {
    if (bezig) return;
    bezig = true;
    try {
      await ronde(client, opties);
    } catch (error) {
      logger.warn('Momentopname overgeslagen', error);
    } finally {
      bezig = false;
    }
  };

  // Tien minuten na het opstarten de eerste: dan is de cache gevuld, en een
  // herstart levert niet meteen een stapel bestanden op.
  const eerste = setTimeout(() => void kijk(), 10 * 60 * 1000);
  eerste.unref?.();

  const timer = setInterval(() => void kijk(), opties.uren * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}
