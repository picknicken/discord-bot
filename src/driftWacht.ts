import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EmbedBuilder, type Client, type Guild } from 'discord.js';
import { driftVanServer, type DriftStatus } from './drift.js';
import { readSetups } from './setupLog.js';
import { serverToegestaan } from './toegestaan.js';
import { logger } from './util/logger.js';
import { meldInServer } from './util/melden.js';

/**
 * De controle die vanzelf loopt.
 *
 * Een server dwaalt af zonder dat iemand het merkt: een kanaal erbij, een recht
 * eraf, een naam veranderd. Het dashboard laat dat zien zodra je kijkt - maar
 * juist daar zit het probleem, want je kijkt pas als je al iets vermoedt.
 *
 * Dus kijkt de bot zelf, en zegt het in de server. Alleen als er iets verandert:
 * dezelfde afwijking elke dag opnieuw melden is geen melding meer maar behang.
 */
export interface Gemeld {
  template: string;
  count: number;
  at: string;
}

export type DriftGeheugen = Record<string, Gemeld>;

const BESTAND = 'drift-gemeld.json';

/**
 * Is dit het melden waard?
 *
 * - Niet te bepalen of nog nooit uitgerold: niets te zeggen.
 * - Nog niet eerder gemeld: alleen als er nu iets afwijkt.
 * - Wel eerder gemeld: als het aantal verandert, of als er een andere template
 *   op ging. Terug naar nul telt mee - dat is het bericht dat het weer klopt.
 */
export function magMelden(vorige: Gemeld | undefined, nu: DriftStatus): boolean {
  if (nu.count === null || nu.template === null) return false;
  if (!vorige) return nu.count > 0;
  if (vorige.template !== nu.template) return true;
  return vorige.count !== nu.count;
}

export function driftEmbed(status: DriftStatus): EmbedBuilder {
  if (status.count === 0) {
    return new EmbedBuilder()
      .setTitle('Deze server komt weer overeen met de template')
      .setColor(0x3ba55d)
      .setDescription(`Er staat niets meer open tegenover "${status.template}".`);
  }

  const tekst = status.samenvatting ? `\n\n${status.samenvatting}` : '';
  return new EmbedBuilder()
    .setTitle('Deze server wijkt af van de template')
    .setColor(0xfee75c)
    .setDescription(
      `Tegenover "${status.template}" staan ${status.count} dingen open.${tekst}`.slice(0, 3900),
    )
    .setFooter({ text: 'Uitrollen zet het recht. Preview eerst, dan zie je precies wat er gebeurt.' });
}

async function leesGeheugen(dir: string): Promise<DriftGeheugen> {
  try {
    return JSON.parse(await readFile(path.join(dir, BESTAND), 'utf8')) as DriftGeheugen;
  } catch {
    // Geen bestand, of onleesbaar: dan beginnen we opnieuw. Erger dan een keer
    // te veel melden is stil blijven omdat er een bestand stuk is.
    return {};
  }
}

async function bewaarGeheugen(dir: string, geheugen: DriftGeheugen): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, BESTAND), JSON.stringify(geheugen, null, 2));
}

async function ronde(
  client: Client<true>,
  opties: { historyDir: string; templatesDir: string; toegestaneServers: readonly string[] },
): Promise<void> {
  const servers = [...client.guilds.cache.values()].filter((guild) =>
    serverToegestaan(guild.id, opties.toegestaneServers),
  );
  if (servers.length === 0) return;

  const runs = await readSetups(opties.historyDir, 500);
  const geheugen = await leesGeheugen(opties.historyDir);
  let veranderd = false;

  for (const guild of servers) {
    const status = await driftVanServer(guild, runs, opties.templatesDir).catch(() => null);
    if (!status || status.count === null || status.template === null) continue;

    if (!magMelden(geheugen[status.guildId], status)) continue;

    geheugen[status.guildId] = { template: status.template, count: status.count, at: new Date().toISOString() };
    veranderd = true;

    logger.info(`Drift in "${guild.name}": ${status.count} tegenover "${status.template}"`);
    await meldDaar(guild, status);
  }

  if (veranderd) await bewaarGeheugen(opties.historyDir, geheugen);
}

async function meldDaar(guild: Guild, status: DriftStatus): Promise<void> {
  try {
    const me = await guild.members.fetchMe();
    await meldInServer(guild, me, driftEmbed(status));
  } catch (error) {
    logger.warn(`Kon drift niet melden in "${guild.name}"`, error);
  }
}

/** Start de controle. 0 uur is uit. */
export function startDriftWacht(
  client: Client<true>,
  opties: { historyDir: string; templatesDir: string; toegestaneServers: readonly string[]; uren: number },
): NodeJS.Timeout | null {
  if (opties.uren <= 0) return null;

  let bezig = false;
  const kijk = async () => {
    // Een ronde langs een paar volle servers duurt langer dan je denkt; zonder
    // deze vlag lopen twee rondes over elkaar heen en meldt hij dubbel.
    if (bezig) return;
    bezig = true;
    try {
      await ronde(client, opties);
    } catch (error) {
      logger.warn('Driftcontrole overgeslagen', error);
    } finally {
      bezig = false;
    }
  };

  // Niet meteen bij het opstarten: de bot is dan nog bezig met inloggen en
  // caches vullen, en een herstart is geen reden voor een bericht.
  const eerste = setTimeout(() => void kijk(), 5 * 60 * 1000);
  eerste.unref?.();

  const timer = setInterval(() => void kijk(), opties.uren * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}
