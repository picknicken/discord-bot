import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from 'discord.js';
import { config } from '../config.js';
import { bouwEmbed, geldigeKleur, geldigeUrl, MAX_BESCHRIJVING, MAX_FOOTER, MAX_TITEL, type EmbedVelden } from '../embedVelden.js';
import { nieuweAankondiging, schrijfGeplandeAankondigingen, leesGeplandeAankondigingen } from '../geplandeAankondiging.js';
import { kiesTaal, t, type Taal } from '../taal.js';
import { serverToegestaan } from '../toegestaan.js';

/**
 * Een bericht als embed sturen, of vast klaarzetten voor later.
 *
 * Zoals Dyno en MEE6 dat als los commando aanbieden. Geen builder met knoppen:
 * dat is voor een paar velden meer moeite dan het oplevert. Twee subcommando's
 * dekken waar dit voor gebruikt wordt - een aankondiging nu, of een die om drie
 * uur 's nachts moet verschijnen zonder dat daar iemand wakker voor hoeft te
 * blijven.
 */

const en = (tekst: string) => ({ 'en-US': tekst, 'en-GB': tekst });

const MAX_DAGEN_VOORUIT = 365;

export const data = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Stuur een bericht als embed')
  .setDescriptionLocalizations(en('Send a message as an embed'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('stuur')
      .setDescription('Stuur de embed meteen')
      .setDescriptionLocalizations(en('Send the embed right away'))
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
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('plan')
      .setDescription('Zet de embed klaar om later vanzelf te plaatsen')
      .setDescriptionLocalizations(en('Queue the embed to post itself later'))
      .addIntegerOption((option) =>
        option
          .setName('over')
          .setNameLocalizations(en('in'))
          .setDescription('Over hoeveel tijd (samen met de eenheid hieronder)')
          .setDescriptionLocalizations(en('How far from now (together with the unit below)'))
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('eenheid')
          .setNameLocalizations(en('unit'))
          .setDescription('Eenheid voor "over"')
          .setDescriptionLocalizations(en('Unit for "in"'))
          .setRequired(true)
          .addChoices(
            { name: 'minuten', value: 'minuten', name_localizations: en('minutes') },
            { name: 'uren', value: 'uren', name_localizations: en('hours') },
            { name: 'dagen', value: 'dagen', name_localizations: en('days') },
          ),
      )
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
      ),
  );

/** De opties die beide subcommando's delen, uitgelezen en gevalideerd. */
function verzamelVelden(
  taal: Taal,
  interaction: ChatInputCommandInteraction,
): { velden: EmbedVelden } | { fout: string } {
  const titel = interaction.options.getString('titel');
  const beschrijving = interaction.options.getString('beschrijving');

  if (!titel && !beschrijving) return { fout: t(taal, 'embed.leeg') };

  const ruweKleur = interaction.options.getString('kleur');
  let kleur: number | null = null;
  if (ruweKleur) {
    kleur = geldigeKleur(ruweKleur);
    if (kleur === null) return { fout: t(taal, 'embed.kleur.ongeldig', { kleur: ruweKleur }) };
  }

  const urls: Record<'afbeelding' | 'thumbnail', string | null> = { afbeelding: null, thumbnail: null };
  for (const veld of ['afbeelding', 'thumbnail'] as const) {
    const ruw = interaction.options.getString(veld);
    if (!ruw) continue;
    const url = geldigeUrl(ruw);
    if (!url) return { fout: t(taal, 'embed.url.ongeldig', { url: ruw }) };
    urls[veld] = url;
  }

  return {
    velden: {
      titel,
      beschrijving,
      kleur,
      afbeelding: urls.afbeelding,
      thumbnail: urls.thumbnail,
      footer: interaction.options.getString('footer'),
    },
  };
}

/** Het kanaal om in te posten: de optie als die er is, anders waar het commando getypt is. */
function bepaalKanaal(interaction: ChatInputCommandInteraction): GuildTextBasedChannel | null {
  const gekozen = interaction.options.getChannel('kanaal', false, [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
  ]);
  const kanaal = gekozen ?? interaction.channel;
  return kanaal && kanaal.isTextBased() ? (kanaal as GuildTextBasedChannel) : null;
}

const DUUR_MS = {
  minuten: 60 * 1000,
  uren: 60 * 60 * 1000,
  dagen: 24 * 60 * 60 * 1000,
} satisfies Record<string, number>;

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

  const uitkomst = verzamelVelden(taal, interaction);
  if ('fout' in uitkomst) {
    await interaction.reply({ content: uitkomst.fout, flags: MessageFlags.Ephemeral });
    return;
  }

  const kanaal = bepaalKanaal(interaction);
  if (!kanaal) {
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

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'stuur') {
    try {
      // Los versturen, niet als antwoord op de interactie: zo staat de embed er
      // gewoon namens de bot, zonder het "gebruikte /embed" label dat een reply
      // erbij zou zetten.
      await kanaal.send({ embeds: [bouwEmbed(uitkomst.velden)] });
    } catch (error) {
      const fout = error instanceof Error ? error.message : String(error);
      await interaction.reply({ content: t(taal, 'embed.mislukt', { fout }), flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: t(taal, 'embed.gelukt', { kanaal: kanaal.toString() }), flags: MessageFlags.Ephemeral });
    return;
  }

  // subcommand === 'plan'
  const over = interaction.options.getInteger('over', true);
  const eenheid = interaction.options.getString('eenheid', true);
  const ms = Object.hasOwn(DUUR_MS, eenheid) ? DUUR_MS[eenheid as keyof typeof DUUR_MS] : undefined;
  if (!ms) {
    await interaction.reply({ content: t(taal, 'embed.eenheid.ongeldig'), flags: MessageFlags.Ephemeral });
    return;
  }

  const wanneer = new Date(Date.now() + over * ms);
  const maxWanneer = new Date(Date.now() + MAX_DAGEN_VOORUIT * DUUR_MS.dagen);
  if (wanneer > maxWanneer) {
    await interaction.reply({
      content: t(taal, 'embed.teverweg', { dagen: MAX_DAGEN_VOORUIT }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lijst = await leesGeplandeAankondigingen(config.historyDir);
  lijst.push(
    nieuweAankondiging({
      wanneer: wanneer.toISOString(),
      guildId: interaction.guildId,
      channelId: kanaal.id,
      door: interaction.user.tag,
      ...uitkomst.velden,
    }),
  );
  await schrijfGeplandeAankondigingen(config.historyDir, lijst);

  const unix = Math.floor(wanneer.getTime() / 1000);
  await interaction.reply({
    content: t(taal, 'embed.gepland', { kanaal: kanaal.toString(), tijd: `<t:${unix}:f>` }),
    flags: MessageFlags.Ephemeral,
  });
}
