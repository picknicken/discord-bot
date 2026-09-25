import type { Client, Guild } from 'discord.js';
import { config } from '../config.js';
import { serverToegestaan } from '../toegestaan.js';

/**
 * De allowlist die MCP gebruikt, en de enige plek die daar ja of nee op zegt.
 *
 * Hij hergebruikt `serverToegestaan()` — dezelfde matcher als GUILD_IDS — maar
 * niet de instelling zelf: `config.mcpAllowedGuilds` is een eigen, apart
 * ingevulde lijst. Het verschil zit 'm in wat een lege lijst betekent. Bij
 * GUILD_IDS is leeg "geen beperking", en dat is prima voor wie dit lokaal op
 * zijn eigen computer draait. Voor een externe koppeling die op afstand door
 * Claude wordt aangeroepen is diezelfde regel levensgevaarlijk: een vergeten
 * configuratie zou dan in één klap élke server openzetten. Daarom is leeg hier
 * het omgekeerde: geen enkele server, tot er expliciet één is ingevuld.
 *
 * Dit is de enige plek in de MCP-laag die deze knoop doorhakt. Elke tool die
 * een guildId krijgt roept hem aan voor hij iets doet; er is geen tweede,
 * concurrerende manier om daar iets over te zeggen.
 */
export function mcpGuildToegestaan(guildId: string): boolean {
  if (config.mcpAllowedGuilds.length === 0) return false;
  return serverToegestaan(guildId, config.mcpAllowedGuilds);
}

export class GuildNietToegestaanFout extends Error {
  constructor(guildId: string) {
    // Bewust zonder verder detail: niet zeggen of de server wel bestaat, wel
    // lid heeft, een andere naam heeft, etc. Wie hier niet mag komen krijgt
    // geen enkel aanknopingspunt over wat er dan wél had gestaan.
    super(`Server ${guildId} is niet toegestaan voor MCP.`);
  }
}

/** Gooit als de server niet op de MCP-allowlist staat; anders niets. */
export function controleerMcpToegang(guildId: string): void {
  if (!mcpGuildToegestaan(guildId)) throw new GuildNietToegestaanFout(guildId);
}

/**
 * Een toegestane, daadwerkelijk bereikbare server ophalen. Twee controles na
 * elkaar: staat hij op de lijst, en zit de bot er ook echt in. Een server die
 * op de lijst staat maar waar de bot niet (meer) in zit levert dezelfde fout op
 * als een server die nooit heeft bestaan — er lekt geen informatie over welke
 * van de twee het is.
 */
export function haalToegestaneGuild(client: Client<true>, guildId: string): Guild {
  controleerMcpToegang(guildId);
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new GuildNietToegestaanFout(guildId);
  return guild;
}

/** Alle servers die zowel op de MCP-lijst staan als waar de bot echt in zit. */
export function toegestaneGuilds(client: Client<true>): Guild[] {
  return [...client.guilds.cache.values()].filter((guild) => mcpGuildToegestaan(guild.id));
}
