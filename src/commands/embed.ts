import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { kiesTaal, t, type Taal } from '../taal.js';
import { serverToegestaan } from '../toegestaan.js';

/**
 * Een bericht als embed sturen, zoals Dyno en MEE6 dat als los commando aanbieden.
 *
 * Geen builder met knoppen: dat is voor een paar velden meer moeite dan het
 * oplevert. Eén commando met opties dekt waar dit voor gebruikt wordt - een
 * aankondiging, regels, een linkje dat opvalt - en werkt ook via een bot-token
 * zonder dat er een venster open hoeft te blijven staan.
 */

const en = (tekst: string) => ({ 'en-US': tekst, 'en-GB': tekst });

const MAX_TITEL = 256;
const MAX_BESCHRIJVING = 4096;
const MAX_FOOTER = 2048;
const HEX_KLEUR = /^#?[0-9a-f]{6}$/i;

export const data = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Stuur een bericht als embed')
  .setDescriptionLocalizations(en('Send a message as an embed'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('titel')
      .setNameLocalizations(en('title'))
      .setDescription('De titel bovenaan de embed')
      .setDescriptionLocalizations(en('The title at the top of the embed'))
      .setMaxLength(MAX_TITEL),
  )
  .addStringOption((option) =>
    option
      .setName('beschrijving')
      .setNameLocalizations(en('description'))
      .setDescription('De hoofdtekst van de embed')
      .setDescriptionLocalizations(en('The main text of the embed'))
      .setMaxLength(MAX_BESCHRIJVING),
  )
  .addStringOption((option) =>
    option
      .setName('kleur')
      .setNameLocalizations(en('color'))
      .setDescription('Kleur van de streep links, als hex (bv. #5865F2)')
      .setDescriptionLocalizations(en('Color of the left-hand stripe, as hex (e.g. #5865F2)')),
  )
  .addStringOption((option) =>
    option
      .setName('afbeelding')
      .setNameLocalizations(en('image'))
      .setDescription('URL van een grote afbeelding onderin de embed')
      .setDescriptionLocalizations(en('URL of a large image at the bottom of the embed')),
  )
  .addStringOption((option) =>
    option
      .setName('thumbnail')
      .setDescription('URL van een kleine afbeelding rechtsboven')
      .setDescriptionLocalizations(en('URL of a small image in the top-right corner')),
  )
  .addStringOption((option) =>
    option
      .setName('footer')
      .setDescription('Kleine tekst onderaan de embed')
      .setDescriptionLocalizations(en('Small text at the bottom of the embed'))
      .setMaxLength(MAX_FOOTER),
  )
  .addChannelOption((option) =>
    option
      .setName('kanaal')
      .setNameLocalizations(en('channel'))
      .setDescription('Waar de embed komt te staan (standaard dit kanaal)')
      .setDescriptionLocalizations(en('Where the embed gets posted (default: this channel)'))
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

/** "#5865F2" of "5865F2" naar een getal, of null als het geen geldige hexkleur is. */
function geldigeKleur(ruw: string): number | null {
  const schoon = ruw.trim();
  if (!HEX_KLEUR.test(schoon)) return null;
  return parseInt(schoon.replace('#', ''), 16);
}

/** Alleen http(s)-links; Discord haalt de afbeelding zelf op en heeft niets aan een ander schema. */
function geldigeUrl(ruw: string): string | null {
  try {
    const url = new URL(ruw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const taal: Taal = kiesTaal(interaction.locale);

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: t(taal, 'cmd.alleen.server'), flags: MessageFlags.Ephemeral });
    return;
  }

  // setDefaultMemberPermissions hierboven is maar een standaard: een
  // serverbeheerder kan die opzij zetten onder Instellingen -> Integraties.
  // Deze controle kan hij niet wegklikken.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: t(taal, 'embed.geen.rechten'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverToegestaan(interaction.guildId, config.toegestaneServers)) {
    await interaction.reply({ content: t(taal, 'server.niet.toegestaan'), flags: MessageFlags.Ephemeral });
    return;
  }

  const titel = interaction.options.getString('titel');
  const beschrijving = interaction.options.getString('beschrijving');

  if (!titel && !beschrijving) {
    await interaction.reply({ content: t(taal, 'embed.leeg'), flags: MessageFlags.Ephemeral });
    return;
  }

  const ruweKleur = interaction.options.getString('kleur');
  let kleur: number | null = null;
  if (ruweKleur) {
    kleur = geldigeKleur(ruweKleur);
    if (kleur === null) {
      await interaction.reply({
        content: t(taal, 'embed.kleur.ongeldig', { kleur: ruweKleur }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const afbeeldingUrls: Partial<Record<'afbeelding' | 'thumbnail', string>> = {};
  for (const veld of ['afbeelding', 'thumbnail'] as const) {
    const ruw = interaction.options.getString(veld);
    if (!ruw) continue;
    const url = geldigeUrl(ruw);
    if (!url) {
      await interaction.reply({ content: t(taal, 'embed.url.ongeldig', { url: ruw }), flags: MessageFlags.Ephemeral });
      return;
    }
    afbeeldingUrls[veld] = url;
  }

  const gekozenKanaal = interaction.options.getChannel('kanaal', false, [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
  ]);
  const kanaal = gekozenKanaal ?? interaction.channel;

  if (!kanaal || !kanaal.isTextBased()) {
    await interaction.reply({ content: t(taal, 'embed.kanaal.ongeldig'), flags: MessageFlags.Ephemeral });
    return;
  }

  const ikBen = interaction.guild.members.me;
  const rechten = ikBen ? kanaal.permissionsFor(ikBen) : null;
  if (
    !rechten?.has(PermissionFlagsBits.ViewChannel) ||
    !rechten.has(PermissionFlagsBits.SendMessages) ||
    !rechten.has(PermissionFlagsBits.EmbedLinks)
  ) {
    await interaction.reply({
      content: t(taal, 'embed.geen.kanaalrechten', { kanaal: kanaal.toString() }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder();
  if (titel) embed.setTitle(titel);
  if (beschrijving) embed.setDescription(beschrijving);
  if (kleur !== null) embed.setColor(kleur);
  if (afbeeldingUrls.afbeelding) embed.setImage(afbeeldingUrls.afbeelding);
  if (afbeeldingUrls.thumbnail) embed.setThumbnail(afbeeldingUrls.thumbnail);

  const footer = interaction.options.getString('footer');
  if (footer) embed.setFooter({ text: footer });

  try {
    // Los versturen, niet als antwoord op de interactie: zo staat de embed er
    // gewoon namens de bot, zonder het "gebruikte /embed" label dat een reply
    // erbij zou zetten.
    await kanaal.send({ embeds: [embed] });
  } catch (error) {
    const fout = error instanceof Error ? error.message : String(error);
    await interaction.reply({ content: t(taal, 'embed.mislukt', { fout }), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: t(taal, 'embed.gelukt', { kanaal: kanaal.toString() }), flags: MessageFlags.Ephemeral });
}
