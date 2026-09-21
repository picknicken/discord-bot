import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from 'discord.js';
import type { Onderdeel } from './onderdelen.js';
import { loadTemplateMet } from './templates.js';
import { rolUit } from './uitvoeren.js';
import { logger } from './util/logger.js';

/**
 * Uitrollen op een tijdstip.
 *
 * Dertig kanalen aanmaken om acht uur 's avonds terwijl iedereen online is, is
 * onnodig: de bot werkt de hele nacht net zo hard. Je zet het klaar, en het
 * gebeurt om drie uur.
 *
 * De lijst staat op schijf, naast het logboek, zodat een herstart hem niet
 * vergeet - dat is precies het moment waarop je erop rekent.
 */
export interface GeplandeUitrol {
  id: string;
  /** Wanneer het moet gebeuren. */
  wanneer: string;
  templateId: string;
  guildIds: string[];
  guildNamen: string[];
  prune: boolean;
  update: boolean;
  onderdelen: Onderdeel[];
  variabelen: Record<string, string>;
  door: string;
  gemaakt: string;
}

const BESTAND = 'gepland.json';

export async function leesGepland(dir: string): Promise<GeplandeUitrol[]> {
  try {
    const inhoud = JSON.parse(await readFile(path.join(dir, BESTAND), 'utf8')) as GeplandeUitrol[];
    return Array.isArray(inhoud) ? inhoud : [];
  } catch {
    return [];
  }
}

export async function schrijfGepland(dir: string, lijst: readonly GeplandeUitrol[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, BESTAND), `${JSON.stringify(lijst, null, 2)}\n`, 'utf8');
}

export function nieuweUitrol(velden: Omit<GeplandeUitrol, 'id' | 'gemaakt'>): GeplandeUitrol {
  return { ...velden, id: randomUUID(), gemaakt: new Date().toISOString() };
}

/**
 * Wat er nu aan de beurt is.
 *
 * Ook wat al voorbij is: stond de bot uit op het afgesproken moment, dan hoort
 * het alsnog te gebeuren zodra hij er weer is - niet stilletjes overgeslagen te
 * worden.
 */
export function welkeNu(lijst: readonly GeplandeUitrol[], nu: Date): GeplandeUitrol[] {
  return lijst.filter((uitrol) => new Date(uitrol.wanneer).getTime() <= nu.getTime());
}

export interface GeplandOpties {
  templatesDir: string;
  backupsDir: string;
  historyDir: string;
}

async function ronde(client: Client<true>, opties: GeplandOpties): Promise<void> {
  const lijst = await leesGepland(opties.historyDir);
  const nu = welkeNu(lijst, new Date());
  if (nu.length === 0) return;

  // Eerst uit de lijst halen, dan pas uitvoeren. Gaat er iets mis, dan probeert
  // hij het niet elke minuut opnieuw - dat zou van één fout een stortvloed maken.
  await schrijfGepland(
    opties.historyDir,
    lijst.filter((uitrol) => !nu.some((aan) => aan.id === uitrol.id)),
  );

  for (const uitrol of nu) {
    for (const guildId of uitrol.guildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        logger.warn(`Geplande uitrol overgeslagen: server ${guildId} niet gevonden.`);
        continue;
      }

      try {
        const { template } = await loadTemplateMet(opties.templatesDir, uitrol.templateId, uitrol.variabelen);
        const result = await rolUit(guild, template, {
          templateId: uitrol.templateId,
          onderdelen: uitrol.onderdelen,
          prune: uitrol.prune,
          update: uitrol.update,
          door: `${uitrol.door} (gepland)`,
          backupsDir: opties.backupsDir,
          historyDir: opties.historyDir,
        });

        logger.info(
          `Geplande uitrol "${uitrol.templateId}" op "${guild.name}": ` +
            `${result.applied} gelukt, ${result.failed} mislukt`,
        );
      } catch (error) {
        logger.warn(`Geplande uitrol "${uitrol.templateId}" op "${guild.name}" mislukt`, error);
      }
    }
  }
}

/** Kijkt elke minuut of er iets aan de beurt is. */
export function startGeplandeUitrol(client: Client<true>, opties: GeplandOpties): NodeJS.Timeout {
  let bezig = false;

  const kijk = async () => {
    if (bezig) return;
    bezig = true;
    try {
      await ronde(client, opties);
    } catch (error) {
      logger.warn('Geplande uitrol overgeslagen', error);
    } finally {
      bezig = false;
    }
  };

  const timer = setInterval(() => void kijk(), 60 * 1000);
  timer.unref?.();
  return timer;
}
