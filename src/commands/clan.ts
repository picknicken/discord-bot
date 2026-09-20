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
import { geldigeNaam, haalSpeler, normaliseerNaam, RuneScapeFout } from '../clan/runescape.js';
import { CLAN_RANGEN } from '../clan/rangen.js';
import {
  alGekoppeldAan,
  koppel,
  leesDossier,
  ontkoppel,
  type ClanDossier,
} from '../clan/opslag.js';
import { synchroniseerServer } from '../clan/synchroniseren.js';
import { logger } from '../util/logger.js';

/**
 * De clankant van de bot in Discord zelf. Een lid geeft zijn RuneScape-naam op,
 * de bot kijkt bij Jagex in welke clan hij zit en met welke rang, en zet daar de
 * bijbehorende rol op. Alles wat daarvoor ingesteld moet worden — welke clan,
 * welke rol bij welke rang — gebeurt in het dashboard onder "Clan".
 *
 * Bewust een eigen commando naast /setup: dit gaat niet over het inrichten van
 * een server maar over wie er in zit, en die twee horen niet door elkaar te
 * lopen in hetzelfde menu.
 */
export const data = new SlashCommandBuilder()
  .setName('clan')
  .setDescription('Koppel je RuneScape-naam en krijg de rol die bij je clanrang hoort')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('koppel')
      .setDescription('Geef je RuneScape-naam op en krijg je clanrol')
      .addStringOption((option) =>
        option.setName('rsn').setDescription('Je RuneScape-naam').setRequired(true).setMaxLength(12),
      ),
  )
  .addSubcommand((sub) => sub.setName('mij').setDescription('Werk je eigen clanrol nu bij'))
  .addSubcommand((sub) => sub.setName('ontkoppel').setDescription('Haal je RuneScape-naam hier weg'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Wat er voor deze server is ingesteld'))
  .addSubcommand((sub) =>
    sub
      .setName('wie')
      .setDescription('Beheer: welke RuneScape-naam hoort bij dit lid')
      .addUserOption((option) => option.setName('lid').setDescription('Welk lid').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('sync').setDescription('Beheer: werk de clanrollen van iedereen bij'),
  );

/** De twee subcommando's die iets over andere mensen zeggen of doen. */
const ALLEEN_BEHEER = new Set(['wie', 'sync']);

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
    default:
      await interaction.reply({ content: 'Onbekend subcommando.', flags: MessageFlags.Ephemeral });
  }
}

async function handleKoppel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const rsn = interaction.options.getString('rsn', true).trim();

  if (!geldigeNaam(rsn)) {
    await interaction.reply({
      content: `"${rsn}" kan geen RuneScape-naam zijn: maximaal 12 tekens, alleen letters, cijfers, spaties en streepjes.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dossier = await leesDossier(config.clanDir, guild.id);

  const bezet = alGekoppeldAan(dossier, rsn, interaction.user.id);
  if (bezet) {
    // Twee mensen op dezelfde naam betekent dat de een de rol van de ander
    // krijgt. Dat moet een beheerder oplossen, niet een van de twee.
    await interaction.editReply(
      `"${rsn}" staat al gekoppeld aan <@${bezet}>. Klopt dat niet? Vraag een beheerder om het recht te zetten.`,
    );
    return;
  }

  // De naam eerst opzoeken: een typefout hoort eruit te komen voordat hij
  // opgeslagen wordt en elke synchronisatie hem opnieuw langsloopt.
  let gevonden: Awaited<ReturnType<typeof haalSpeler>> = null;
  try {
    gevonden = await haalSpeler(rsn);
    if (!gevonden) {
      await interaction.editReply(`RuneScape kent geen speler "${rsn}". Staat de naam er precies zo?`);
      return;
    }
  } catch (error) {
    // Jagex plat betekent niet dat de koppeling niet mag; hij wordt alleen niet
    // meteen gecontroleerd.
    if (!(error instanceof RuneScapeFout)) throw error;
    logger.warn(`Spelerlookup mislukte voor "${rsn}"`, error);
  }

  const naam = gevonden?.naam ?? rsn;
  await koppel(config.clanDir, guild.id, interaction.user.id, naam, 'zelf');

  if (!dossier.instellingen.clan) {
    await interaction.editReply(
      `Genoteerd: **${naam}**. Er is voor deze server nog geen clan ingesteld, dus er is nog geen rol aan te geven.`,
    );
    return;
  }

  await interaction.editReply(await werkBij(guild, interaction.user.id, naam, gevonden?.clan ?? null));
}

async function handleMij(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dossier = await leesDossier(config.clanDir, guild.id);
  const eigen = dossier.koppelingen[interaction.user.id];

  if (!eigen) {
    await interaction.editReply('Je hebt nog geen RuneScape-naam gekoppeld. Doe `/clan koppel rsn:jouwnaam`.');
    return;
  }

  if (!dossier.instellingen.clan) {
    await interaction.editReply('Er is voor deze server nog geen clan ingesteld.');
    return;
  }

  await interaction.editReply(await werkBij(guild, interaction.user.id, eigen.rsn, null));
}

async function handleOntkoppel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dossier = await leesDossier(config.clanDir, guild.id);
  if (!dossier.koppelingen[interaction.user.id]) {
    await interaction.editReply('Er stond hier geen RuneScape-naam van jou.');
    return;
  }

  // Eerst de rollen afnemen, dan de koppeling weghalen: andersom weet de bot
  // niet meer welke rollen bij deze koppeling hoorden.
  const afgenomen = await neemRollenAf(guild, dossier, interaction.user.id);
  await ontkoppel(config.clanDir, guild.id, interaction.user.id);

  await interaction.editReply(
    afgenomen > 0
      ? `Koppeling weg, en ${afgenomen} clanrol(len) afgenomen.`
      : 'Koppeling weg.',
  );
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild as Guild;
  const dossier = await leesDossier(config.clanDir, guild.id);
  const eigen = dossier.koppelingen[interaction.user.id];

  const gekoppeldeRangen = CLAN_RANGEN.filter((rang) => dossier.instellingen.rangRollen[rang]);

  const embed = new EmbedBuilder()
    .setTitle('Clanrangen')
    .setColor(dossier.instellingen.clan ? 0x5865f2 : 0x949ba4)
    .addFields(
      { name: 'Clan', value: dossier.instellingen.clan || 'nog niet ingesteld', inline: true },
      { name: 'Gekoppelde leden', value: String(Object.keys(dossier.koppelingen).length), inline: true },
      {
        name: 'Rangen met een rol',
        value: gekoppeldeRangen.length > 0 ? gekoppeldeRangen.join(', ') : 'nog geen',
      },
      {
        name: 'Jij',
        value: eigen
          ? `${eigen.rsn}${eigen.rang ? ` — ${eigen.rang}` : ''}`
          : 'nog niet gekoppeld (`/clan koppel`)',
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
      ? `<@${lid.id}> is **${koppeling.rsn}**` +
        (koppeling.rang ? ` — ${koppeling.rang}` : ' — rang nog onbekend') +
        (koppeling.gezienOp ? ` (gezien op ${koppeling.gezienOp.slice(0, 10)})` : '') +
        `. Gekoppeld door ${koppeling.door}.`
      : `<@${lid.id}> heeft hier geen RuneScape-naam gekoppeld.`,
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
      `**${uitkomst.ledenlijst.clan}** — ${uitkomst.ledenlijst.leden.length} clanleden opgehaald.`,
      `${uitkomst.aangepast} lid/leden bijgewerkt, ${uitkomst.plan.ongewijzigd} stonden al goed.`,
    ];

    if (uitkomst.mislukt > 0) regels.push(`${uitkomst.mislukt} mislukt.`);
    if (uitkomst.plan.ongekoppeld.length > 0) {
      regels.push(`${uitkomst.plan.ongekoppeld.length} clanleden hebben hier nog geen Discord-koppeling.`);
    }
    for (const fout of uitkomst.fouten.slice(0, 5)) regels.push(`• ${fout}`);
    for (const waarschuwing of uitkomst.plan.waarschuwingen.slice(0, 5)) regels.push(`⚠ ${waarschuwing}`);

    await interaction.editReply(regels.join('\n'));
  } catch (error) {
    await interaction.editReply(
      error instanceof RuneScapeFout || error instanceof Error
        ? `Dat lukte niet: ${error.message}`
        : 'Dat lukte niet.',
    );
  }
}

// --- gedeeld ---------------------------------------------------------------

/** Eén lid bijwerken en er een leesbare zin over teruggeven. */
async function werkBij(guild: Guild, discordId: string, rsn: string, clanVolgensJagex: string | null): Promise<string> {
  try {
    const uitkomst = await synchroniseerServer(config.clanDir, guild, {
      alleen: [discordId],
      reden: 'Clanrol bijgewerkt via /clan',
    });

    const wissel = uitkomst.plan.wissels[0];
    const ingesteld = (await leesDossier(config.clanDir, guild.id)).instellingen.clan;

    if (!wissel) {
      // Niets te doen kan twee dingen betekenen, en het verschil is precies wat
      // iemand wil weten.
      const staatErin = uitkomst.ledenlijst.leden.some(
        (lid) => normaliseerNaam(lid.naam) === normaliseerNaam(rsn),
      );
      return staatErin
        ? `**${rsn}** staat in ${ingesteld} — je rollen klopten al.`
        : buitenDeClan(rsn, ingesteld, clanVolgensJagex);
    }

    if (!wissel.inClan) return buitenDeClan(rsn, ingesteld, clanVolgensJagex);

    const regels = [`**${rsn}** staat in ${ingesteld} als **${wissel.rang}**.`, wissel.reden];
    if (uitkomst.mislukt > 0) regels.push(`Let op: ${uitkomst.fouten[0] ?? 'aanpassen mislukte'}`);
    return regels.join('\n');
  } catch (error) {
    if (error instanceof RuneScapeFout) return `Genoteerd, maar RuneScape antwoordde niet: ${error.message}`;
    throw error;
  }
}

function buitenDeClan(rsn: string, clan: string, clanVolgensJagex: string | null): string {
  if (clanVolgensJagex && normaliseerNaam(clanVolgensJagex) !== normaliseerNaam(clan)) {
    return `**${rsn}** zit in clan **${clanVolgensJagex}**, niet in ${clan}.`;
  }
  return `**${rsn}** staat niet in de ledenlijst van ${clan}. Net lid geworden? Jagex werkt die lijst eens per dag bij.`;
}

/**
 * De rollen die bij de clankoppeling horen weer afnemen. Gebruikt bij
 * ontkoppelen; andere rollen blijven staan.
 */
async function neemRollenAf(guild: Guild, dossier: ClanDossier, discordId: string): Promise<number> {
  const beheerd = [
    ...Object.values(dossier.instellingen.rangRollen),
    dossier.instellingen.lidRol,
    dossier.instellingen.gastRol,
  ].filter((id): id is string => Boolean(id));

  if (beheerd.length === 0) return 0;

  try {
    const lid = await guild.members.fetch(discordId);
    const eraf = beheerd.filter((id) => lid.roles.cache.has(id));
    if (eraf.length === 0) return 0;

    await lid.roles.remove(eraf, 'Clankoppeling verwijderd via /clan ontkoppel');
    return eraf.length;
  } catch (error) {
    logger.warn(`Clanrollen afnemen mislukte voor ${discordId} in "${guild.name}"`, error);
    return 0;
  }
}
