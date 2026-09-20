import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type BaseMessageOptions,
  type ButtonInteraction,
  type Guild,
  type ModalSubmitInteraction,
} from 'discord.js';
import { koppelEnMeld } from './koppelen.js';
import { leesDossier, type ClanDossier } from './opslag.js';
import { logger } from '../util/logger.js';

/**
 * De knop "Koppel je OSRS-naam".
 *
 * Een nieuw lid dat binnenkomt is niet te herkennen: Discord weet zijn
 * Discord-naam, en verder niets. Welke OSRS-speler daarachter zit weet alleen
 * hij zelf. Een commando typen op een telefoon is daarvoor een hoge drempel,
 * dus: één knop, een venstertje met één veld, klaar.
 *
 * Het antwoord is ephemeral — alleen hij ziet het. Wie in de clan zit krijgt de
 * rol die daarbij hoort; wie er niet in zit krijgt geen rol, maar zijn naam
 * blijft wel gekoppeld. Zo weet je later alsnog wie wie is.
 */

export const KOPPEL_KNOP = 'clan-koppel';
export const KOPPEL_VENSTER = 'clan-koppel-venster';
const NAAM_VELD = 'rsn';

export function koppelKnopRij(label = 'Koppel je OSRS-naam'): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(KOPPEL_KNOP).setLabel(label).setStyle(ButtonStyle.Primary).setEmoji('🎣'),
  );
}

/**
 * Het bericht met de knop. Dezelfde tekst voor een nieuw lid als voor de
 * knop die een beheerder ergens vastzet met `/clan knop`.
 */
export function koppelBericht(dossier: ClanDossier, welkom = false): BaseMessageOptions {
  const clans = dossier.instellingen.clans.map((clan) => clan.naam || `clan ${clan.groupId}`);
  const namen = clans.length > 0 ? clans.map((naam) => `**${naam}**`).join(' of ') : 'onze clan';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(welkom ? 'Welkom! Zit je in de clan?' : 'Koppel je OSRS-naam')
    .setDescription(
      `Zit je in ${namen}? Koppel dan je OSRS-naam, dan krijg je meteen de rol die bij je rang hoort.\n\n` +
        'Zit je er niet in? Koppel hem gerust — je krijgt er geen rol van, maar dan weten we wel wie je ' +
        'bent in het spel, en zodra je lid wordt telt hij vanzelf mee.',
    )
    .setFooter({ text: 'Alleen jij ziet het antwoord.' });

  return { embeds: [embed], components: [koppelKnopRij()] };
}

/** De knop is aangeklikt: een venstertje met één veld erin. */
export async function toonKoppelVenster(interaction: ButtonInteraction): Promise<void> {
  const venster = new ModalBuilder().setCustomId(KOPPEL_VENSTER).setTitle('Koppel je OSRS-naam');

  venster.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(NAAM_VELD)
        .setLabel('Je naam in Old School RuneScape')
        .setPlaceholder('bijvoorbeeld: Sparc Mac')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(12)
        .setRequired(true),
    ),
  );

  await interaction.showModal(venster);
}

/** Het venstertje is ingevuld: koppelen, rollen zetten, en zeggen wat er gebeurde. */
export async function verwerkKoppelVenster(
  interaction: ModalSubmitInteraction,
  clanDir: string,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Dit werkt alleen in een server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Opzoeken bij WiseOldMan kan even duren; zonder dit loopt de interactie af.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rsn = interaction.fields.getTextInputValue(NAAM_VELD);

  try {
    const uitkomst = await koppelEnMeld({
      clanDir,
      guild: interaction.guild as Guild,
      discordId: interaction.user.id,
      rsn,
      door: 'zelf',
    });

    await interaction.editReply(uitkomst.bericht);
  } catch (error) {
    logger.error(`Koppelen via de knop mislukte voor ${interaction.user.id}`, error);
    await interaction.editReply('Er ging iets mis bij het koppelen. Probeer het zo nog eens.');
  }
}

/** Of deze server een koppelknop aan nieuwe leden hoort te tonen. */
export async function welkomAan(clanDir: string, guildId: string): Promise<ClanDossier | null> {
  const dossier = await leesDossier(clanDir, guildId);
  if (!dossier.instellingen.welkom) return null;
  if (dossier.instellingen.clans.length === 0) return null;
  return dossier;
}
