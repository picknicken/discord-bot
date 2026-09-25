import type { Message } from 'discord.js';
import { leesDossier } from './opslag.js';
import { koppelEnMeld } from './koppelen.js';
import { kiesTaal } from '../taal.js';
import { logger } from '../util/logger.js';

/**
 * De verplichte naamkoppeling: iemand typt zijn OSRS-naam gewoon in het
 * welkomkanaal, in plaats van (of naast) de knop te gebruiken.
 *
 * Dat is een lagere drempel dan een knop met een venstertje erachteraan — het
 * kanaal zelf is al de vraag, en typen is typen. Zodra het lukt gaat de
 * wachtkamerrol eraf en ziet hij de rest van de server; dezelfde rollen en
 * dezelfde bijnaam als via `/clan koppel` of de knop, want dit roept precies
 * diezelfde functie aan.
 *
 * Wie de wachtkamerrol niet (meer) heeft wordt met rust gelaten: dat is een
 * gewoon berichtje in het welkomkanaal, geen koppelpoging.
 */
export async function verwerkNaamBericht(message: Message, clanDir: string): Promise<void> {
  if (message.author.bot || !message.inGuild()) return;

  const dossier = await leesDossier(clanDir, message.guildId);
  const { verplicht, wachtkamerRol, welkomKanaal } = dossier.instellingen;
  if (!verplicht || !wachtkamerRol || !welkomKanaal) return;
  if (message.channelId !== welkomKanaal) return;

  const member = message.member ?? (await message.guild?.members.fetch(message.author.id).catch(() => null));
  if (!member || !member.roles.cache.has(wachtkamerRol)) return;

  const rsn = message.content.trim();
  if (!rsn) return;

  const taal = kiesTaal(message.guild?.preferredLocale);

  let uitkomst;
  try {
    uitkomst = await koppelEnMeld({
      clanDir,
      guild: message.guild!,
      discordId: member.id,
      rsn,
      door: 'zelf (wachtkamer)',
      taal,
    });
  } catch (error) {
    logger.error(`Naamkoppeling via de wachtkamer mislukte voor ${member.user.username}`, error);
    return;
  }

  if (uitkomst.gekoppeld) {
    try {
      await member.roles.remove(wachtkamerRol, 'Naam gekoppeld in de wachtkamer');
    } catch (error) {
      logger.warn(`Wachtkamerrol kon niet af bij ${member.user.username} in "${message.guild!.name}"`, error);
    }
  }

  await message.reply(uitkomst.bericht).catch(() => undefined);
}
