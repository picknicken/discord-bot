import {
  MessageFlags,
  PollLayoutType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { kiesTaal, t, type Taal } from '../taal.js';
import { serverToegestaan } from '../toegestaan.js';

/**
 * Een poll plaatsen, bovenop de polls die Discord zelf al aanbiedt.
 *
 * Discord heeft dit al ingebouwd — stemmen, resultaten, een sluitingstijd — dus
 * dit commando bouwt geen eigen versie met reacties, het maakt alleen makkelijk
 * wat anders alleen met de "..." -knop bij een bericht kan: een vraag met
 * meerdere opties in één regel, zonder daar met de muis doorheen te hoeven.
 */

const en = (tekst: string) => ({ 'en-US': tekst, 'en-GB': tekst });

const MAX_VRAAG = 300;
const MAX_OPTIE = 55;
const MIN_OPTIES = 2;
const MAX_OPTIES = 10;
const STANDAARD_UREN = 24;
const MAX_UREN = 32 * 24;

export const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Plaats een poll in dit kanaal')
  .setDescriptionLocalizations(en('Post a poll in this channel'))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('vraag')
      .setNameLocalizations(en('question'))
      .setDescription('De vraag')
      .setDescriptionLocalizations(en('The question'))
      .setRequired(true)
      .setMaxLength(MAX_VRAAG),
  )
  .addStringOption((option) =>
    option
      .setName('opties')
      .setNameLocalizations(en('options'))
      .setDescription('De keuzes, gescheiden door een komma (2 tot 10)')
      .setDescriptionLocalizations(en('The choices, separated by a comma (2 to 10)'))
      .setRequired(true)
      .setMaxLength(600),
  )
  .addIntegerOption((option) =>
    option
      .setName('duur')
      .setNameLocalizations(en('duration'))
      .setDescription('Hoe lang de poll openstaat, in uren (standaard 24)')
      .setDescriptionLocalizations(en('How long the poll stays open, in hours (default 24)'))
      .setMinValue(1)
      .setMaxValue(MAX_UREN),
  )
  .addBooleanOption((option) =>
    option
      .setName('meerkeuze')
      .setNameLocalizations(en('multiselect'))
      .setDescription('Mag iemand meer dan één optie kiezen? (standaard nee)')
      .setDescriptionLocalizations(en('Can someone pick more than one option? (default no)')),
  );

/** De komma-gescheiden tekst uit elkaar halen, of zeggen waarom dat niet kan. */
export function verwerkOpties(taal: Taal, ruw: string): { opties: string[] } | { fout: string } {
  const opties = ruw
    .split(',')
    .map((optie) => optie.trim())
    .filter(Boolean);

  if (opties.length < MIN_OPTIES) return { fout: t(taal, 'poll.tewinig', { aantal: opties.length }) };
  if (opties.length > MAX_OPTIES) return { fout: t(taal, 'poll.teveel', { aantal: opties.length }) };

  const gezien = new Set<string>();
  for (const optie of opties) {
    if (optie.length > MAX_OPTIE) {
      return { fout: t(taal, 'poll.telang', { optie, lengte: optie.length }) };
    }
    const sleutel = optie.toLowerCase();
    if (gezien.has(sleutel)) return { fout: t(taal, 'poll.dubbel', { optie }) };
    gezien.add(sleutel);
  }

  return { opties };
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const taal = kiesTaal(interaction.locale);

  if (!interaction.inGuild()) {
    await interaction.reply({ content: t(taal, 'cmd.alleen.server'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverToegestaan(interaction.guildId, config.toegestaneServers)) {
    await interaction.reply({ content: t(taal, 'server.niet.toegestaan'), flags: MessageFlags.Ephemeral });
    return;
  }

  const vraag = interaction.options.getString('vraag', true);
  const uitkomst = verwerkOpties(taal, interaction.options.getString('opties', true));

  if ('fout' in uitkomst) {
    await interaction.reply({ content: uitkomst.fout, flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    // De poll zelf is het antwoord — zichtbaar voor iedereen, niet ephemeral,
    // precies zoals wanneer je hem met de hand via de "+"-knop zou maken.
    await interaction.reply({
      poll: {
        question: { text: vraag },
        answers: uitkomst.opties.map((text) => ({ text })),
        duration: interaction.options.getInteger('duur') ?? STANDAARD_UREN,
        allowMultiselect: interaction.options.getBoolean('meerkeuze') ?? false,
        layoutType: PollLayoutType.Default,
      },
    });
  } catch (error) {
    const fout = error instanceof Error ? error.message : String(error);
    await interaction.reply({ content: t(taal, 'poll.mislukt', { fout }), flags: MessageFlags.Ephemeral });
  }
}
