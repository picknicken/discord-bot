import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { bouwEmbed, geldigeKleur, geldigeUrl, MAX_BESCHRIJVING, MAX_FOOTER, MAX_TITEL, type EmbedVelden } from '../embedVelden.js';
import { kiesTaal, t, type Taal } from '../taal.js';
import { serverToegestaan } from '../toegestaan.js';
import {
  geldigeTagNaam,
  leesTagDossier,
  normaliseerTagNaam,
  verwijderTag,
  zetTag,
  type TagDefinitie,
} from '../tags/opslag.js';

/**
 * Eigen commando's per server, zoals Dyno's en MEE6's "custom commands" - maar
 * als slash-commando in plaats van een prefix in de chat. Dat scheelt de
 * Message Content Intent (die niet elke server aanzet, zie de waarschuwing bij
 * het opstarten) en het scheelt uitzoeken welk teken deze server als prefix
 * gebruikt. `/tag toon` heeft autocomplete op de naam, dus je hoeft ook niet te
 * onthouden hoe een tag precies heet.
 */

const en = (tekst: string) => ({ 'en-US': tekst, 'en-GB': tekst });

const MAX_NAAM = 32;
const MAX_TEKST = 2000;
const ALLEEN_BEHEER = new Set(['maak', 'bewerk', 'verwijder']);

const naamOptieBeschrijving = 'Naam van de tag: kleine letters, cijfers en streepjes, max 32 tekens';
const naamOptieBeschrijvingEn = 'Tag name: lowercase letters, numbers and hyphens, 32 characters max';

export const data = new SlashCommandBuilder()
  .setName('tag')
  .setDescription("Eigen commando's voor deze server: sla tekst of een embed op onder een naam")
  .setDescriptionLocalizations(en("This server's own commands: save text or an embed under a name"))
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('maak')
      .setDescription('Maak een nieuwe tag')
      .setDescriptionLocalizations(en('Create a new tag'))
      .addStringOption((option) =>
        option
          .setName('naam')
          .setNameLocalizations(en('name'))
          .setDescription(naamOptieBeschrijving)
          .setDescriptionLocalizations(en(naamOptieBeschrijvingEn))
          .setRequired(true)
          .setMaxLength(MAX_NAAM),
      )
      .addStringOption((option) =>
        option
          .setName('tekst')
          .setNameLocalizations(en('text'))
          .setDescription('Losse tekst, of het hele bericht als er verder niets is ingevuld')
          .setDescriptionLocalizations(en('Plain text, or the whole message if nothing else below is filled in'))
          .setMaxLength(MAX_TEKST),
      )
      .addStringOption((option) =>
        option
          .setName('titel')
          .setNameLocalizations(en('title'))
          .setDescription('Titel bovenaan een embed')
          .setDescriptionLocalizations(en('Title at the top of an embed'))
          .setMaxLength(MAX_TITEL),
      )
      .addStringOption((option) =>
        option
          .setName('beschrijving')
          .setNameLocalizations(en('description'))
          .setDescription('Hoofdtekst van een embed')
          .setDescriptionLocalizations(en('Main text of an embed'))
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
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('bewerk')
      .setDescription('Vervang de inhoud van een bestaande tag')
      .setDescriptionLocalizations(en('Replace the content of an existing tag'))
      .addStringOption((option) =>
        option
          .setName('naam')
          .setNameLocalizations(en('name'))
          .setDescription('Welke tag')
          .setDescriptionLocalizations(en('Which tag'))
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('tekst')
          .setNameLocalizations(en('text'))
          .setDescription('Losse tekst, of het hele bericht als er verder niets is ingevuld')
          .setDescriptionLocalizations(en('Plain text, or the whole message if nothing else below is filled in'))
          .setMaxLength(MAX_TEKST),
      )
      .addStringOption((option) =>
        option
          .setName('titel')
          .setNameLocalizations(en('title'))
          .setDescription('Titel bovenaan een embed')
          .setDescriptionLocalizations(en('Title at the top of an embed'))
          .setMaxLength(MAX_TITEL),
      )
      .addStringOption((option) =>
        option
          .setName('beschrijving')
          .setNameLocalizations(en('description'))
          .setDescription('Hoofdtekst van een embed')
          .setDescriptionLocalizations(en('Main text of an embed'))
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
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('verwijder')
      .setDescription('Verwijder een tag')
      .setDescriptionLocalizations(en('Delete a tag'))
      .addStringOption((option) =>
        option
          .setName('naam')
          .setNameLocalizations(en('name'))
          .setDescription('Welke tag')
          .setDescriptionLocalizations(en('Which tag'))
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('lijst')
      .setDescription("Toon alle tags van deze server")
      .setDescriptionLocalizations(en('Show every tag on this server')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('toon')
      .setDescription('Plaats een tag')
      .setDescriptionLocalizations(en('Post a tag'))
      .addStringOption((option) =>
        option
          .setName('naam')
          .setNameLocalizations(en('name'))
          .setDescription('Welke tag')
          .setDescriptionLocalizations(en('Which tag'))
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

/** De embedvelden van `maak`/`bewerk`, gevalideerd - en de tekst ernaast. */
function verzamelTagVelden(
  taal: Taal,
  interaction: ChatInputCommandInteraction,
): { velden: EmbedVelden & { tekst: string | null } } | { fout: string } {
  const titel = interaction.options.getString('titel');
  const beschrijving = interaction.options.getString('beschrijving');
  const tekst = interaction.options.getString('tekst');

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

  const footer = interaction.options.getString('footer');

  if (!tekst && !titel && !beschrijving && !urls.afbeelding && !urls.thumbnail && !footer) {
    return { fout: t(taal, 'tag.leeg') };
  }

  return { velden: { titel, beschrijving, kleur, afbeelding: urls.afbeelding, thumbnail: urls.thumbnail, footer, tekst } };
}

function heeftEmbedInhoud(tag: TagDefinitie): boolean {
  return Boolean(tag.titel || tag.beschrijving || tag.afbeelding || tag.thumbnail || tag.footer || tag.kleur !== null);
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  try {
    const dossier = await leesTagDossier(config.tagsDir, interaction.guildId);
    const namen = Object.keys(dossier.tags)
      .filter((naam) => naam.includes(focused))
      .slice(0, 25);
    await interaction.respond(namen.map((naam) => ({ name: naam, value: naam })));
  } catch {
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const taal: Taal = kiesTaal(interaction.locale);

  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: t(taal, 'cmd.alleen.server'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverToegestaan(interaction.guildId, config.toegestaneServers)) {
    await interaction.reply({ content: t(taal, 'server.niet.toegestaan'), flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'lijst') {
    const dossier = await leesTagDossier(config.tagsDir, interaction.guildId);
    const namen = Object.keys(dossier.tags).sort();
    await interaction.reply({
      content:
        namen.length > 0
          ? t(taal, 'tag.lijst', { namen: namen.map((naam) => `\`${naam}\``).join(', ') })
          : t(taal, 'tag.lijst.leeg'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'toon') {
    const naam = normaliseerTagNaam(interaction.options.getString('naam', true));
    const dossier = await leesTagDossier(config.tagsDir, interaction.guildId);
    const tag = dossier.tags[naam];
    if (!tag) {
      await interaction.reply({ content: t(taal, 'tag.onbekend', { naam }), flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      content: tag.tekst ?? undefined,
      embeds: heeftEmbedInhoud(tag) ? [bouwEmbed(tag)] : [],
    });
    return;
  }

  // De rest (maak, bewerk, verwijder) verandert iets - dat mag niet iedereen.
  if (ALLEEN_BEHEER.has(subcommand) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: t(taal, 'tag.geen.rechten'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'verwijder') {
    const naam = normaliseerTagNaam(interaction.options.getString('naam', true));
    const verwijderd = await verwijderTag(config.tagsDir, interaction.guildId, naam);
    await interaction.reply({
      content: t(taal, verwijderd ? 'tag.verwijderd' : 'tag.onbekend', { naam }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // maak of bewerk
  const naamRuw = interaction.options.getString('naam', true);
  if (!geldigeTagNaam(naamRuw)) {
    await interaction.reply({ content: t(taal, 'tag.naam.ongeldig', { naam: naamRuw }), flags: MessageFlags.Ephemeral });
    return;
  }

  const naam = normaliseerTagNaam(naamRuw);
  const dossier = await leesTagDossier(config.tagsDir, interaction.guildId);
  const bestaatAl = naam in dossier.tags;

  if (subcommand === 'maak' && bestaatAl) {
    await interaction.reply({ content: t(taal, 'tag.bestaatal', { naam }), flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === 'bewerk' && !bestaatAl) {
    await interaction.reply({ content: t(taal, 'tag.onbekend', { naam }), flags: MessageFlags.Ephemeral });
    return;
  }

  const uitkomst = verzamelTagVelden(taal, interaction);
  if ('fout' in uitkomst) {
    await interaction.reply({ content: uitkomst.fout, flags: MessageFlags.Ephemeral });
    return;
  }

  await zetTag(config.tagsDir, interaction.guildId, naam, uitkomst.velden, interaction.user.tag);
  await interaction.reply({
    content: t(taal, subcommand === 'maak' ? 'tag.gemaakt' : 'tag.bijgewerkt', { naam }),
    flags: MessageFlags.Ephemeral,
  });
}
