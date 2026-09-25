import { PermissionFlagsBits, type GuildMember, type TextChannel } from 'discord.js';
import { config } from '../config.js';
import { koppelBericht, welkomAan } from '../clan/knop.js';
import { kiesTaal } from '../taal.js';
import { eersteSchrijfbareKanaal } from '../util/melden.js';
import { logger } from '../util/logger.js';

/**
 * Iemand komt de server binnen. Discord vertelt de bot alleen zijn
 * Discord-naam — welke OSRS-speler daarachter zit weet niemand. Dus vraagt hij
 * het meteen, met een knop, op het moment dat het lid er toch is.
 *
 * Wie niet reageert houdt gewoon geen rol; er gebeurt verder niets.
 */
export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  const dossier = await welkomAan(config.clanDir, member.guild.id);
  if (!dossier) return;

  // Al gekoppeld? Dan is hij hier eerder geweest en hoeft hij niets te doen.
  if (dossier.koppelingen[member.id]) return;

  // Verplichte naamkoppeling: de wachtkamerrol regelt zelf, via zijn eigen
  // kanaalrechten, wat een nieuw lid nog niet ziet. De bot hoeft alleen die
  // rol erop en er weer af te halen; welke kanalen dat precies zijn stelt de
  // server zelf in, net als bij elke andere rol.
  if (dossier.instellingen.verplicht && dossier.instellingen.wachtkamerRol) {
    try {
      await member.roles.add(dossier.instellingen.wachtkamerRol, 'Verplichte naamkoppeling: nog niet gekoppeld');
    } catch (error) {
      logger.warn(`Wachtkamerrol niet gezet voor ${member.user.username} in "${member.guild.name}"`, error);
    }
  }

  // Dit bericht blijft in een kanaal staan, dus de taal van de server telt -
  // niet die van het lid dat toevallig net binnenkomt.
  const bericht = koppelBericht(dossier, true, kiesTaal(member.guild.preferredLocale));
  const kanaal = welkomKanaal(member, dossier.instellingen.welkomKanaal);

  if (kanaal) {
    try {
      await kanaal.send({ content: `<@${member.id}>`, ...bericht });
      return;
    } catch (error) {
      logger.warn(`Welkomstbericht kon niet in #${kanaal.name} van "${member.guild.name}"`, error);
    }
  }

  // Geen kanaal, of de bot mag er niet praten: dan maar een privébericht. Staan
  // die dicht, dan houdt het op — dat is geen reden om iets te laten klappen.
  try {
    await member.send(bericht);
  } catch {
    logger.warn(
      `Geen kanaal en geen DM mogelijk voor ${member.user.username} in "${member.guild.name}" — welkomstbericht overgeslagen.`,
    );
  }
}

/** Het ingestelde kanaal, anders het systeemkanaal, anders het eerste waar hij mag praten. */
function welkomKanaal(member: GuildMember, gekozenId: string | null): TextChannel | null {
  const me = member.guild.members.me;
  if (!me) return null;

  if (gekozenId) {
    const kanaal = member.guild.channels.cache.get(gekozenId);
    // Een kanaal dat niet meer bestaat of waar hij niet in mag: dan liever het
    // systeemkanaal dan helemaal geen welkom.
    if (
      kanaal?.isTextBased() &&
      !kanaal.isDMBased() &&
      kanaal.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    ) {
      return kanaal as TextChannel;
    }
  }

  return eersteSchrijfbareKanaal(member.guild, me);
}
