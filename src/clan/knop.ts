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
import { kiesTaal, t, type Taal } from '../taal.js';
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

export function koppelKnopRij(taal: Taal = 'nl'): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(KOPPEL_KNOP)
      .setLabel(t(taal, 'knop.label'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎣'),
  );
}

/**
 * Het bericht met de knop. Dezelfde tekst voor een nieuw lid als voor de
 * knop die een beheerder ergens vastzet met `/clan knop`.
 */
export function koppelBericht(dossier: ClanDossier, welkom = false, taal: Taal = 'nl'): BaseMessageOptions {
  const clans = dossier.instellingen.clans.map((clan) => clan.naam || `clan ${clan.groupId}`);
  const namen =
    clans.length > 0 ? clans.map((naam) => `**${naam}**`).join(t(taal, 'knop.of')) : t(taal, 'knop.onzeclan');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(welkom ? t(taal, 'knop.titel.welkom') : t(taal, 'knop.titel'))
    .setDescription(t(taal, 'knop.uitleg', { clans: namen }))
    .setFooter({ text: t(taal, 'knop.voet') });

  return { embeds: [embed], components: [koppelKnopRij(taal)] };
}

/** De knop is aangeklikt: een venstertje met één veld erin. */
export async function toonKoppelVenster(interaction: ButtonInteraction): Promise<void> {
  // De taal van degene die klikt, niet die van de server: dit venster ziet hij
  // alleen zelf.
  const taal = kiesTaal(interaction.locale);
  const venster = new ModalBuilder().setCustomId(KOPPEL_VENSTER).setTitle(t(taal, 'knop.titel'));

  venster.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(NAAM_VELD)
        .setLabel(t(taal, 'venster.veld'))
        .setPlaceholder(t(taal, 'venster.voorbeeld'))
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
  const taal = kiesTaal(interaction.locale);

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: t(taal, 'alleen.server'), flags: MessageFlags.Ephemeral });
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
      taal,
    });

    await interaction.editReply(uitkomst.bericht);
  } catch (error) {
    logger.error(`Koppelen via de knop mislukte voor ${interaction.user.id}`, error);
    await interaction.editReply(t(taal, 'koppel.mislukt'));
  }
}

/** Of deze server een koppelknop aan nieuwe leden hoort te tonen. */
export async function welkomAan(clanDir: string, guildId: string): Promise<ClanDossier | null> {
  const dossier = await leesDossier(clanDir, guildId);
  if (!dossier.instellingen.welkom) return null;
  if (dossier.instellingen.clans.length === 0) return null;
  return dossier;
}
