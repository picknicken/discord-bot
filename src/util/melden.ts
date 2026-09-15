import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { logger } from './logger.js';

/**
 * Een bericht in de server zelf.
 *
 * Wat de bot niet kan doen hoort niet alleen in een log te staan dat je op een
 * telefoon toch niet openslaat. Het gaat over die server, dus zegt hij het
 * daar: in het systeemkanaal, anders in het eerste kanaal waar hij mag praten,
 * anders in een DM naar de eigenaar.
 */
export async function meldInServer(guild: Guild, me: GuildMember, embed: EmbedBuilder): Promise<void> {
  const doel = eersteSchrijfbareKanaal(guild, me);

  if (doel) {
    try {
      await doel.send({ embeds: [embed] });
      return;
    } catch (error) {
      logger.warn(`Kon niet posten in #${doel.name} van "${guild.name}"`, error);
    }
  }

  try {
    const eigenaar = await guild.fetchOwner();
    await eigenaar.send({ embeds: [embed] });
  } catch {
    logger.warn(`Geen kanaal en geen DM mogelijk in "${guild.name}" — bericht overgeslagen.`);
  }
}

export function eersteSchrijfbareKanaal(guild: Guild, me: GuildMember): TextChannel | null {
  const magSchrijven = (kanaal: TextChannel) =>
    kanaal.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);

  if (guild.systemChannel && magSchrijven(guild.systemChannel)) return guild.systemChannel;

  const rest = guild.channels.cache
    .filter((kanaal): kanaal is TextChannel => kanaal.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .find((kanaal) => magSchrijven(kanaal));

  return rest ?? null;
}

/**
 * Wat er na een uitrol is blijven liggen, als bericht in de server. Alleen de
 * dingen waar iemand iets mee moet - een lege lijst levert geen bericht op.
 */
export function letopEmbed(templateNaam: string, regels: readonly string[]): EmbedBuilder | null {
  if (regels.length === 0) return null;

  const tekst = regels.map((regel) => `• ${regel}`).join('\n');
  return new EmbedBuilder()
    .setTitle(`"${templateNaam}" is uitgerold, met een paar punten`)
    .setColor(0xfee75c)
    .setDescription(tekst.length > 3800 ? `${tekst.slice(0, 3800)}…` : tekst)
    .setFooter({ text: 'Dit staat ook in het logboek van de uitrol.' });
}
