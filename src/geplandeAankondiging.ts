import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from 'discord.js';
import { bouwEmbed, type EmbedVelden } from './embedVelden.js';
import { logger } from './util/logger.js';

/**
 * Een embed die op een later moment vanzelf geplaatst wordt: `/embed plan`.
 *
 * Dezelfde opzet als `gepland.ts` voor uitrollen — één bestand naast de
 * geschiedenis, zodat een herstart niets vergeet, en wat al voorbij is bij het
 * opstarten alsnog gebeurt in plaats van stilletjes overgeslagen te worden.
 */
export interface GeplandeAankondiging extends EmbedVelden {
  id: string;
  /** Wanneer het moet gebeuren. */
  wanneer: string;
  guildId: string;
  channelId: string;
  door: string;
  gemaakt: string;
}

const BESTAND = 'geplande-aankondigingen.json';

export async function leesGeplandeAankondigingen(dir: string): Promise<GeplandeAankondiging[]> {
  try {
    const inhoud = JSON.parse(await readFile(path.join(dir, BESTAND), 'utf8')) as GeplandeAankondiging[];
    return Array.isArray(inhoud) ? inhoud : [];
  } catch {
    return [];
  }
}

export async function schrijfGeplandeAankondigingen(
  dir: string,
  lijst: readonly GeplandeAankondiging[],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, BESTAND), `${JSON.stringify(lijst, null, 2)}\n`, 'utf8');
}

export function nieuweAankondiging(velden: Omit<GeplandeAankondiging, 'id' | 'gemaakt'>): GeplandeAankondiging {
  return { ...velden, id: randomUUID(), gemaakt: new Date().toISOString() };
}

/** Ook wat al voorbij is: stond de bot uit op het afgesproken moment, dan alsnog nu. */
export function welkeNu(lijst: readonly GeplandeAankondiging[], nu: Date): GeplandeAankondiging[] {
  return lijst.filter((aankondiging) => new Date(aankondiging.wanneer).getTime() <= nu.getTime());
}

export interface GeplandeAankondigingOpties {
  historyDir: string;
}

async function ronde(client: Client<true>, opties: GeplandeAankondigingOpties): Promise<void> {
  const lijst = await leesGeplandeAankondigingen(opties.historyDir);
  const nu = welkeNu(lijst, new Date());
  if (nu.length === 0) return;

  // Eerst uit de lijst halen, dan pas versturen — anders wordt één mislukking
  // elke minuut opnieuw geprobeerd.
  await schrijfGeplandeAankondigingen(
    opties.historyDir,
    lijst.filter((aankondiging) => !nu.some((aan) => aan.id === aankondiging.id)),
  );

  for (const aankondiging of nu) {
    const guild = client.guilds.cache.get(aankondiging.guildId);
    if (!guild) {
      logger.warn(`Geplande aankondiging overgeslagen: server ${aankondiging.guildId} niet gevonden.`);
      continue;
    }

    const kanaal = guild.channels.cache.get(aankondiging.channelId);
    if (!kanaal || !kanaal.isTextBased()) {
      logger.warn(
        `Geplande aankondiging overgeslagen: kanaal ${aankondiging.channelId} in "${guild.name}" bestaat niet meer.`,
      );
      continue;
    }

    try {
      await kanaal.send({ embeds: [bouwEmbed(aankondiging)] });
      logger.info(`Geplande aankondiging geplaatst in "${guild.name}" #${kanaal.name}.`);
    } catch (error) {
      logger.warn(`Geplande aankondiging in "${guild.name}" mislukt`, error);
    }
  }
}

/** Kijkt elke minuut of er iets aan de beurt is. */
export function startGeplandeAankondigingen(client: Client<true>, opties: GeplandeAankondigingOpties): NodeJS.Timeout {
  let bezig = false;

  const kijk = async () => {
    if (bezig) return;
    bezig = true;
    try {
      await ronde(client, opties);
    } catch (error) {
      logger.warn('Geplande aankondiging overgeslagen', error);
    } finally {
      bezig = false;
    }
  };

  const timer = setInterval(() => void kijk(), 60 * 1000);
  timer.unref?.();
  return timer;
}
