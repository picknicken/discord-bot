import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import { config } from '../config.js';
import { kiesTaal, t, type Taal } from '../taal.js';
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
  .setDescriptionLocalizations({
    'en-US': 'Link your OSRS name and get the role that matches your clan rank',
    'en-GB': 'Link your OSRS name and get the role that matches your clan rank',
  })
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('koppel')
      // Wie Discord in het Engels heeft staan typt /clan link. Hetzelfde
      // commando, andere naam - dat scheelt een lid dat niet weet wat
      // "koppel" betekent en er dus vanaf ziet.
      .setNameLocalizations({ 'en-US': 'link', 'en-GB': 'link' })
      .setDescription('Geef je OSRS-naam op en krijg je clanrol')
      .setDescriptionLocalizations({
        'en-US': 'Enter your OSRS name and get your clan role',
        'en-GB': 'Enter your OSRS name and get your clan role',
      })
      .addStringOption((option) =>
        option
          .setName('rsn')
          .setDescription('Je OSRS-naam')
          .setDescriptionLocalizations({ 'en-US': 'Your OSRS name', 'en-GB': 'Your OSRS name' })
          .setRequired(true)
          .setMaxLength(12),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('mij')
      .setNameLocalizations({ 'en-US': 'me', 'en-GB': 'me' })
      .setDescription('Werk je eigen clanrol nu bij')
      .setDescriptionLocalizations({
        'en-US': 'Update your own clan role now',
        'en-GB': 'Update your own clan role now',
      }),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ontkoppel')
      .setNameLocalizations({ 'en-US': 'unlink', 'en-GB': 'unlink' })
      .setDescription('Haal je OSRS-naam hier weg')
      .setDescriptionLocalizations({
        'en-US': 'Remove your OSRS name from this server',
        'en-GB': 'Remove your OSRS name from this server',
      }),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Welke clans hier meetellen')
      .setDescriptionLocalizations({ 'en-US': 'Which clans count here', 'en-GB': 'Which clans count here' }),
  )
  .addSubcommand((sub) =>
    sub
      .setName('wie')
      .setNameLocalizations({ 'en-US': 'who', 'en-GB': 'who' })
      .setDescription('Beheer: welke OSRS-naam hoort bij dit lid')
      .setDescriptionLocalizations({
        'en-US': 'Admin: which OSRS name belongs to this member',
        'en-GB': 'Admin: which OSRS name belongs to this member',
      })
      .addUserOption((option) =>
        option
          .setName('lid')
          .setNameLocalizations({ 'en-US': 'member', 'en-GB': 'member' })
          .setDescription('Welk lid')
          .setDescriptionLocalizations({ 'en-US': 'Which member', 'en-GB': 'Which member' })
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('sync')
      .setDescription('Beheer: werk de clanrollen van iedereen bij')
      .setDescriptionLocalizations({
        'en-US': "Admin: update everyone's clan roles",
        'en-GB': "Admin: update everyone's clan roles",
      }),
  )
  .addSubcommand((sub) =>
    sub
      .setName('knop')
      .setNameLocalizations({ 'en-US': 'button', 'en-GB': 'button' })
      .setDescription('Beheer: zet hier een knop neer waarmee leden hun OSRS-naam koppelen')
      .setDescriptionLocalizations({
        'en-US': 'Admin: put a button here for members to link their OSRS name',
        'en-GB': 'Admin: put a button here for members to link their OSRS name',
      }),
  );

/** De subcommando's die iets over andere mensen zeggen of doen. */
const ALLEEN_BEHEER = new Set(['wie', 'sync', 'knop']);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // De taal van degene die het commando typt. Bijna alles hier is ephemeral, dus
  // hij is de enige die het antwoord leest.
  const taal = kiesTaal(interaction.locale);

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: t(taal, 'cmd.alleen.server'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverToegestaan(interaction.guildId, config.toegestaneServers)) {
    await interaction.reply({
      content: t(taal, 'server.niet.toegestaan'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (ALLEEN_BEHEER.has(subcommand) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: t(taal, 'recht.rollen'),
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
      await interaction.reply({ content: t(taal, 'cmd.onbekend'), flags: MessageFlags.Ephemeral });
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
    taal: kiesTaal(interaction.locale),
  });

  await interaction.editReply(uitkomst.bericht);
}

async function handleMij(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const taal = kiesTaal(interaction.locale);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dossier = await leesDossier(config.clanDir, guild.id);
  const eigen = dossier.koppelingen[interaction.user.id];

  if (!eigen) {
    await interaction.editReply(t(taal, 'mij.geenkoppeling'));
    return;
  }

  if (dossier.instellingen.clans.length === 0) {
    await interaction.editReply(t(taal, 'clan.nietgekozen'));
    return;
  }

  await interaction.editReply(
    (await werkBij(config.clanDir, guild, interaction.user.id, eigen.rsn, taal)).bericht,
  );
}

async function handleOntkoppel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const taal = kiesTaal(interaction.locale);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dossier = await leesDossier(config.clanDir, guild.id);
  if (!dossier.koppelingen[interaction.user.id]) {
    await interaction.editReply(t(taal, 'ontkoppel.niets'));
    return;
  }

  // Eerst de rollen afnemen, dan de koppeling weghalen: andersom weet de bot
  // niet meer welke rollen bij deze koppeling hoorden.
  const afgenomen = await neemRollenAf(guild, dossier, interaction.user.id);
  await ontkoppel(config.clanDir, guild.id, interaction.user.id);

  await interaction.editReply(
    afgenomen > 0 ? t(taal, 'ontkoppel.weg.rollen', { aantal: afgenomen }) : t(taal, 'ontkoppel.weg'),
  );
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const taal = kiesTaal(interaction.locale);
  const dossier = await leesDossier(config.clanDir, guild.id);
  const eigen = dossier.koppelingen[interaction.user.id];

  const clans = dossier.instellingen.clans;

  const embed = new EmbedBuilder()
    .setTitle(t(taal, 'status.titel'))
    .setColor(clans.length > 0 ? 0x5865f2 : 0x949ba4)
    .addFields(
      {
        name: t(taal, 'status.clans'),
        value:
          clans.length > 0
            ? clans
                .map((clan) => `• ${clan.naam || `clan ${clan.groupId}`} — wiseoldman.net/groups/${clan.groupId}`)
                .join('\n')
            : t(taal, 'status.nogeen'),
      },
      { name: t(taal, 'status.leden'), value: String(Object.keys(dossier.koppelingen).length), inline: true },
      {
        name: t(taal, 'status.jij'),
        value: eigen ? beschrijfKoppeling(eigen.rsn, eigen.gezien, taal) : t(taal, 'status.nietgekoppeld'),
      },
    );

  if (dossier.laatsteSync) embed.setFooter({ text: t(taal, 'status.voet', { tijd: dossier.laatsteSync }) });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleWie(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const taal = kiesTaal(interaction.locale);
  const lid = interaction.options.getUser('lid', true);

  const dossier = await leesDossier(config.clanDir, guild.id);
  const koppeling = dossier.koppelingen[lid.id];

  await interaction.reply({
    content: koppeling
      ? t(taal, 'wie.gekoppeld', {
          id: lid.id,
          wat: beschrijfKoppeling(koppeling.rsn, koppeling.gezien, taal),
          gezien: koppeling.gezienOp
            ? t(taal, 'wie.gezienop', { datum: koppeling.gezienOp.slice(0, 10) })
            : '',
          door: koppeling.door,
        })
      : t(taal, 'wie.niets', { id: lid.id }),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSync(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const taal = kiesTaal(interaction.locale);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const uitkomst = await synchroniseerServer(config.clanDir, guild, {
      vers: true,
      reden: `Clanrangen bijgewerkt door ${interaction.user.username}`,
    });

    const regels = [
      uitkomst.groepen
        .map((groep) => t(taal, 'sync.groep', { clan: groep.naam, aantal: groep.leden.length }))
        .join('\n'),
      t(taal, 'sync.bijgewerkt', {
        aantal: uitkomst.aangepast,
        ongewijzigd: uitkomst.plan.ongewijzigd,
      }),
    ];

    if (uitkomst.mislukt > 0) regels.push(t(taal, 'sync.mislukt', { aantal: uitkomst.mislukt }));

    const zonder = uitkomst.plan.ongekoppeld.reduce((som, regel) => som + regel.leden.length, 0);
    if (zonder > 0) regels.push(t(taal, 'sync.ongekoppeld', { aantal: zonder }));

    for (const fout of uitkomst.fouten.slice(0, 5)) regels.push(`• ${fout}`);
    for (const waarschuwing of uitkomst.plan.waarschuwingen.slice(0, 5)) regels.push(`⚠ ${waarschuwing}`);

    await interaction.editReply(regels.join('\n'));
  } catch (error) {
    await interaction.editReply(
      error instanceof Error ? t(taal, 'sync.fout', { fout: error.message }) : t(taal, 'sync.fout.kaal'),
    );
  }
}

/**
 * Een knop neerzetten die blijft staan. Het welkomstbericht bereikt alleen wie
 * ná vandaag binnenkomt; hiermee kunnen de leden die er al zijn hem ook vinden.
 */
async function handleKnop(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const taal = kiesTaal(interaction.locale);
  const dossier = await leesDossier(config.clanDir, guild.id);

  if (dossier.instellingen.clans.length === 0) {
    await interaction.reply({
      content: t(taal, 'knop.geenclan'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({
      content: t(taal, 'knop.geenkanaal'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Het bericht blijft staan en wordt door iedereen gelezen, dus dat volgt de
  // taal van de server - ook als de beheerder die het neerzet iets anders heeft.
  await interaction.channel.send(koppelBericht(dossier, false, kiesTaal(guild.preferredLocale)));
  await interaction.reply({ content: t(taal, 'knop.geplaatst'), flags: MessageFlags.Ephemeral });
}

// --- gedeeld ---------------------------------------------------------------

/** "Tess — Corporal in Mijn Clan", of gewoon de naam als er nog niets gezien is. */
function beschrijfKoppeling(
  rsn: string,
  gezien: Array<{ clan: string; rang: string }>,
  taal: Taal,
): string {
  if (gezien.length === 0) return t(taal, 'koppeling.onbekend', { rsn });
  return (
    `**${rsn}** — ` +
    gezien.map((plek) => t(taal, 'koppeling.rang', { rang: netteRang(plek.rang), clan: plek.clan })).join(', ')
  );
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
