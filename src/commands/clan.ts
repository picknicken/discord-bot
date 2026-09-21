import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import { config } from '../config.js';
import { serverToegestaan } from '../toegestaan.js';
import { netteRang } from '../clan/wiseoldman.js';
import { leesDossier, ontkoppel, type ClanDossier } from '../clan/opslag.js';
import { synchroniseerServer } from '../clan/synchroniseren.js';
import { koppelEnMeld, werkBij } from '../clan/koppelen.js';
import { koppelBericht } from '../clan/knop.js';
import { logger } from '../util/logger.js';

/**
 * De clankant van de bot in Discord zelf. Een lid geeft zijn OSRS-naam op, de
 * bot kijkt bij WiseOldMan of die naam in een van de gekozen clans staat en met
 * welke rang, en zet daar de bijbehorende rol op. Welke clans meetellen en welke
 * rol bij welke rang hoort stel je in het dashboard in, onder "Clan".
 *
 * Bewust een eigen commando naast /setup: dit gaat niet over het inrichten van
 * een server maar over wie er in zit, en die twee horen niet door elkaar te
 * lopen in hetzelfde menu.
 */
export const data = new SlashCommandBuilder()
  .setName('clan')
  .setDescription('Koppel je OSRS-naam en krijg de rol die bij je clanrang hoort')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('koppel')
      .setDescription('Geef je OSRS-naam op en krijg je clanrol')
      .addStringOption((option) =>
        option.setName('rsn').setDescription('Je OSRS-naam').setRequired(true).setMaxLength(12),
      ),
  )
  .addSubcommand((sub) => sub.setName('mij').setDescription('Werk je eigen clanrol nu bij'))
  .addSubcommand((sub) => sub.setName('ontkoppel').setDescription('Haal je OSRS-naam hier weg'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Welke clans hier meetellen'))
  .addSubcommand((sub) =>
    sub
      .setName('wie')
      .setDescription('Beheer: welke OSRS-naam hoort bij dit lid')
      .addUserOption((option) => option.setName('lid').setDescription('Welk lid').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('sync').setDescription('Beheer: werk de clanrollen van iedereen bij'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('knop')
      .setDescription('Beheer: zet hier een knop neer waarmee leden hun OSRS-naam koppelen'),
  );

/** De subcommando's die iets over andere mensen zeggen of doen. */
const ALLEEN_BEHEER = new Set(['wie', 'sync', 'knop']);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Dit commando werkt alleen in een server.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverToegestaan(interaction.guildId, config.toegestaneServers)) {
    await interaction.reply({
      content: 'Deze server staat niet in de lijst met servers waar deze bot iets mag.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (ALLEEN_BEHEER.has(subcommand) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: 'Hier heb je het recht "Rollen beheren" voor nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (subcommand) {
    case 'koppel':
      return handleKoppel(interaction);
    case 'mij':
      return handleMij(interaction);
    case 'ontkoppel':
      return handleOntkoppel(interaction);
    case 'status':
      return handleStatus(interaction);
    case 'wie':
      return handleWie(interaction);
    case 'sync':
      return handleSync(interaction);
    case 'knop':
      return handleKnop(interaction);
    default:
      await interaction.reply({ content: 'Onbekend subcommando.', flags: MessageFlags.Ephemeral });
  }
}

async function handleKoppel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const rsn = interaction.options.getString('rsn', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Precies hetzelfde pad als de knop "Koppel je OSRS-naam", zodat beide
  // hetzelfde doen en hetzelfde antwoorden.
  const uitkomst = await koppelEnMeld({
    clanDir: config.clanDir,
    guild,
    discordId: interaction.user.id,
    rsn,
    door: 'zelf',
  });

  await interaction.editReply(uitkomst.bericht);
}

async function handleMij(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dossier = await leesDossier(config.clanDir, guild.id);
  const eigen = dossier.koppelingen[interaction.user.id];

  if (!eigen) {
    await interaction.editReply('Je hebt nog geen OSRS-naam gekoppeld. Doe `/clan koppel rsn:jouwnaam`.');
    return;
  }

  if (dossier.instellingen.clans.length === 0) {
    await interaction.editReply('Er is voor deze server nog geen clan gekozen.');
    return;
  }

  await interaction.editReply((await werkBij(config.clanDir, guild, interaction.user.id, eigen.rsn)).bericht);
}

async function handleOntkoppel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dossier = await leesDossier(config.clanDir, guild.id);
  if (!dossier.koppelingen[interaction.user.id]) {
    await interaction.editReply('Er stond hier geen OSRS-naam van jou.');
    return;
  }

  // Eerst de rollen afnemen, dan de koppeling weghalen: andersom weet de bot
  // niet meer welke rollen bij deze koppeling hoorden.
  const afgenomen = await neemRollenAf(guild, dossier, interaction.user.id);
  await ontkoppel(config.clanDir, guild.id, interaction.user.id);

  await interaction.editReply(
    afgenomen > 0 ? `Koppeling weg, en ${afgenomen} clanrol(len) afgenomen.` : 'Koppeling weg.',
  );
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const dossier = await leesDossier(config.clanDir, guild.id);
  const eigen = dossier.koppelingen[interaction.user.id];

  const clans = dossier.instellingen.clans;

  const embed = new EmbedBuilder()
    .setTitle('Clanrangen')
    .setColor(clans.length > 0 ? 0x5865f2 : 0x949ba4)
    .addFields(
      {
        name: 'Clans die hier meetellen',
        value:
          clans.length > 0
            ? clans
                .map((clan) => `• ${clan.naam || `clan ${clan.groupId}`} — wiseoldman.net/groups/${clan.groupId}`)
                .join('\n')
            : 'nog geen',
      },
      { name: 'Gekoppelde leden', value: String(Object.keys(dossier.koppelingen).length), inline: true },
      {
        name: 'Jij',
        value: eigen ? beschrijfKoppeling(eigen.rsn, eigen.gezien) : 'nog niet gekoppeld (`/clan koppel`)',
      },
    );

  if (dossier.laatsteSync) embed.setFooter({ text: `Laatst bijgewerkt: ${dossier.laatsteSync}` });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleWie(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const lid = interaction.options.getUser('lid', true);

  const dossier = await leesDossier(config.clanDir, guild.id);
  const koppeling = dossier.koppelingen[lid.id];

  await interaction.reply({
    content: koppeling
      ? `<@${lid.id}> is ${beschrijfKoppeling(koppeling.rsn, koppeling.gezien)}` +
        (koppeling.gezienOp ? ` (gezien op ${koppeling.gezienOp.slice(0, 10)})` : '') +
        `. Gekoppeld door ${koppeling.door}.`
      : `<@${lid.id}> heeft hier geen OSRS-naam gekoppeld.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSync(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const uitkomst = await synchroniseerServer(config.clanDir, guild, {
      vers: true,
      reden: `Clanrangen bijgewerkt door ${interaction.user.username}`,
    });

    const regels = [
      uitkomst.groepen
        .map((groep) => `**${groep.naam}** — ${groep.leden.length} leden opgehaald.`)
        .join('\n'),
      `${uitkomst.aangepast} lid/leden bijgewerkt, ${uitkomst.plan.ongewijzigd} stonden al goed.`,
    ];

    if (uitkomst.mislukt > 0) regels.push(`${uitkomst.mislukt} mislukt.`);

    const zonder = uitkomst.plan.ongekoppeld.reduce((som, regel) => som + regel.leden.length, 0);
    if (zonder > 0) regels.push(`${zonder} clanleden hebben hier nog geen Discord-koppeling.`);

    for (const fout of uitkomst.fouten.slice(0, 5)) regels.push(`• ${fout}`);
    for (const waarschuwing of uitkomst.plan.waarschuwingen.slice(0, 5)) regels.push(`⚠ ${waarschuwing}`);

    await interaction.editReply(regels.join('\n'));
  } catch (error) {
    await interaction.editReply(
      error instanceof Error ? `Dat lukte niet: ${error.message}` : 'Dat lukte niet.',
    );
  }
}

/**
 * Een knop neerzetten die blijft staan. Het welkomstbericht bereikt alleen wie
 * ná vandaag binnenkomt; hiermee kunnen de leden die er al zijn hem ook vinden.
 */
async function handleKnop(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const dossier = await leesDossier(config.clanDir, guild.id);

  if (dossier.instellingen.clans.length === 0) {
    await interaction.reply({
      content: 'Kies eerst een clan in het dashboard, anders valt er nog niets te koppelen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({
      content: 'Hier kan de bot geen bericht plaatsen. Probeer het in een ander kanaal.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.channel.send(koppelBericht(dossier));
  await interaction.reply({ content: 'De knop staat er. Hij blijft werken, ook voor wie later komt.', flags: MessageFlags.Ephemeral });
}

// --- gedeeld ---------------------------------------------------------------

/** "Tess — Corporal in Mijn Clan", of gewoon de naam als er nog niets gezien is. */
function beschrijfKoppeling(rsn: string, gezien: Array<{ clan: string; rang: string }>): string {
  if (gezien.length === 0) return `**${rsn}** — clan nog onbekend`;
  return `**${rsn}** — ${gezien.map((plek) => `${netteRang(plek.rang)} in ${plek.clan}`).join(', ')}`;
}

/**
 * De rollen die bij de clankoppeling horen weer afnemen. Gebruikt bij
 * ontkoppelen; andere rollen blijven staan.
 */
async function neemRollenAf(guild: Guild, dossier: ClanDossier, discordId: string): Promise<number> {
  const beheerd = [
    ...dossier.instellingen.clans.map((clan) => clan.lidRol),
    dossier.instellingen.gastRol,
  ].filter((id): id is string => Boolean(id));

  if (beheerd.length === 0) return 0;

  try {
    const lid = await guild.members.fetch(discordId);
    const eraf = [...new Set(beheerd)].filter((id) => lid.roles.cache.has(id));
    if (eraf.length === 0) return 0;

    await lid.roles.remove(eraf, 'Clankoppeling verwijderd via /clan ontkoppel');
    return eraf.length;
  } catch (error) {
    logger.warn(`Clanrollen afnemen mislukte voor ${discordId} in "${guild.name}"`, error);
    return 0;
  }
}
