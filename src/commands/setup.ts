import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import { config } from '../config.js';
import { missingPermissions } from '../botPermissions.js';
import { applyPlan } from '../applier.js';
import { exportGuildFresh } from '../exporter.js';
import { describeActions, planSetup, summarizePlan } from '../planner.js';
import { snapshotGuildFresh } from '../snapshot.js';
import { listTemplateIds, loadAllTemplates, loadTemplateMet } from '../templates.js';
import { maakHaalbaar } from '../haalbaar.js';
import { backupGuild } from '../backup.js';
import { logSetup } from '../setupLog.js';
import { leesWaarden } from '../variabelen.js';
import { serverToegestaan } from '../toegestaan.js';
import { logger } from '../util/logger.js';

/** Dezelfde omschrijving in het Engels, voor wie Discord zo heeft staan. */
const en = (tekst: string) => ({ 'en-US': tekst, 'en-GB': tekst });

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Richt deze server automatisch in vanuit een template')
  .setDescriptionLocalizations(en('Set this server up automatically from a template'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Toon alle beschikbare templates')
      .setDescriptionLocalizations(en('Show every available template')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('preview')
      .setDescription('Laat zien wat er zou gebeuren, zonder iets te wijzigen')
      .setDescriptionLocalizations(en('Show what would happen, without changing anything'))
      .addStringOption((option) =>
        option
          .setName('template')
          .setDescription('Welke template')
          .setDescriptionLocalizations(en('Which template'))
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addBooleanOption((option) =>
        option
          .setName('prune')
          .setDescription('Kanalen verwijderen die niet in de template staan')
          .setDescriptionLocalizations(en('Delete channels that are not in the template')),
      )
      .addStringOption((option) =>
        option
          .setName('variabelen')
          .setNameLocalizations(en('variables'))
          .setDescription('Waarden invullen, bijv: clan=Bloody Mayhem')
          .setDescriptionLocalizations(en('Fill in values, e.g. clan=Bloody Mayhem')),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('apply')
      .setDescription('Voer de template uit op deze server')
      .setDescriptionLocalizations(en('Carry out the template on this server'))
      .addStringOption((option) =>
        option
          .setName('template')
          .setDescription('Welke template')
          .setDescriptionLocalizations(en('Which template'))
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('bevestig')
          .setNameLocalizations(en('confirm'))
          .setDescription('Typ de servernaam exact over om te bevestigen')
          .setDescriptionLocalizations(en('Type the server name exactly to confirm'))
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName('prune')
          .setDescription('Kanalen verwijderen die niet in de template staan')
          .setDescriptionLocalizations(en('Delete channels that are not in the template')),
      )
      .addBooleanOption((option) =>
        option
          .setName('update')
          .setDescription('Bestaande rollen/kanalen bijwerken (standaard: aan)')
          .setDescriptionLocalizations(en('Update existing roles/channels (default: on)')),
      )
      .addStringOption((option) =>
        option
          .setName('variabelen')
          .setNameLocalizations(en('variables'))
          .setDescription('Waarden invullen, bijv: clan=Bloody Mayhem')
          .setDescriptionLocalizations(en('Fill in values, e.g. clan=Bloody Mayhem')),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('export')
      .setDescription('Exporteer de huidige server als template-bestand')
      .setDescriptionLocalizations(en('Export the current server as a template file')),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  try {
    const ids = await listTemplateIds(config.templatesDir);
    await interaction.respond(
      ids
        .filter((id) => id.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((id) => ({ name: id, value: id })),
    );
  } catch {
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Dit commando werkt alleen in een server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  // list toont alleen de templates en raakt de server niet aan; de rest wel.
  if (subcommand !== 'list') {
    // setDefaultMemberPermissions hierboven is maar een standaard: een
    // serverbeheerder kan die onder Instellingen -> Integraties opzij zetten en
    // het commando alsnog aan iedereen geven. Deze controle kan hij niet
    // wegklikken.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'Alleen beheerders van deze server kunnen hem inrichten. Je mist het recht "Server beheren".',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!serverToegestaan(interaction.guildId, config.toegestaneServers)) {
      await interaction.reply({
        content: 'Deze server staat niet in de lijst met servers waar deze bot iets mag. Er is niets veranderd.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  switch (subcommand) {
    case 'list':
      return handleList(interaction);
    case 'preview':
      return handlePreview(interaction, interaction.guild);
    case 'apply':
      return handleApply(interaction, interaction.guild);
    case 'export':
      return handleExport(interaction, interaction.guild);
  }
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const templates = await loadAllTemplates(config.templatesDir);

  if (templates.length === 0) {
    await interaction.editReply(`Geen templates gevonden in \`${config.templatesDir}\`.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Beschikbare templates')
    .setColor(0x5865f2)
    .setDescription(
      templates
        .map(({ id, template }) => {
          const channels =
            template.categories.reduce((sum, category) => sum + category.channels.length, 0) +
            template.uncategorizedChannels.length;
          return `**${id}** — ${template.description || template.name}\n${template.roles.length} rollen · ${template.categories.length} categorieen · ${channels} kanalen`;
        })
        .join('\n\n'),
    );

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Hetzelfde plan als op de commandoregel en in het dashboard: eerst bijstellen
 * naar wat deze bot op deze server mag, dan pas iets doen. Dat liep hier langs
 * elkaar heen, waardoor via Discord nog de oude fouten terugkwamen.
 */
async function maakPlan(interaction: ChatInputCommandInteraction, guild: Guild, id: string) {
  const geladen = await loadTemplateMet(
    config.templatesDir,
    id,
    leesWaarden([interaction.options.getString('variabelen') ?? '']),
  );

  const plan = planSetup(await snapshotGuildFresh(guild, geladen.template), geladen.template, {
    prune: interaction.options.getBoolean('prune') ?? false,
    update: interaction.options.getBoolean('update') ?? true,
  });

  const me = await guild.members.fetchMe();
  const haalbaar = maakHaalbaar(plan, me.permissions, {
    alCommunity: guild.features.includes('COMMUNITY'),
  });

  return { ...geladen, plan: haalbaar.plan, aanpassingen: haalbaar.aanpassingen };
}

async function handlePreview(interaction: ChatInputCommandInteraction, guild: Guild): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getString('template', true);

  try {
    const { template, plan, aanpassingen, onbekend } = await maakPlan(interaction, guild, id);

    const embed = new EmbedBuilder()
      .setTitle(`Preview: ${template.name}`)
      .setColor(0xfee75c)
      .setDescription(summarizePlan(plan))
      .addFields({ name: 'Acties', value: codeBlock(describeActions(plan)) });

    if (plan.warnings.length > 0) {
      embed.addFields({ name: 'Waarschuwingen', value: kort(plan.warnings) });
    }
    if (aanpassingen.length > 0) {
      embed.addFields({ name: 'Bijgesteld naar wat ik kan', value: kort(aanpassingen) });
    }
    if (onbekend.length > 0) {
      embed.addFields({ name: 'Onbekende variabelen', value: kort(onbekend) });
    }

    await interaction.editReply({
      embeds: [embed],
      content: 'Er is niets gewijzigd. Gebruik `/setup apply` om dit door te voeren.',
    });
  } catch (error) {
    await interaction.editReply(errorText(error));
  }
}

/** Een lijstje dat binnen een embedveld past (Discord staat 1024 tekens toe). */
function kort(regels: readonly string[]): string {
  const tekst = regels.join('\n');
  return tekst.length <= 1000 ? tekst : `${tekst.slice(0, 1000)}…`;
}

async function handleApply(interaction: ChatInputCommandInteraction, guild: Guild): Promise<void> {
  const confirmation = interaction.options.getString('bevestig', true);
  if (confirmation.trim() !== guild.name) {
    await interaction.reply({
      content: `Bevestiging klopt niet. Typ de servernaam exact over: \`${guild.name}\``,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const me = await guild.members.fetchMe();
  const missing = missingPermissions(me);
  if (missing.length > 0) {
    await interaction.reply({
      content: `De bot mist rechten: ${missing.map((name) => `\`${name}\``).join(', ')}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getString('template', true);

  try {
    const { template, plan, aanpassingen } = await maakPlan(interaction, guild, id);

    if (plan.actions.length === 0) {
      await interaction.editReply('Niets te doen — de server komt al overeen met de template.');
      return;
    }

    await interaction.editReply(`Bezig met ${plan.actions.length} acties… (${summarizePlan(plan)})`);
    logger.info(`Template "${id}" toepassen op ${guild.name} (${guild.id}) door ${interaction.user.tag}`);

    // Eerst een momentopname, net als het dashboard en de commandoregel.
    const backupFile = await backupGuild(guild, config.backupsDir, id).catch(() => null);
    const result = await applyPlan(guild, template, plan);
    const letop = [...result.errors, ...aanpassingen];

    await logSetup(config.historyDir, {
      at: new Date().toISOString(),
      guildId: guild.id,
      guildName: guild.name,
      template: id,
      door: interaction.user.tag,
      mode: 'apply',
      onderdelen: [],
      applied: result.applied,
      failed: result.failed,
      backup: backupFile,
      notes: letop,
    });

    const embed = new EmbedBuilder()
      .setTitle(result.failed === 0 ? 'Setup afgerond' : 'Setup afgerond met fouten')
      .setColor(result.failed === 0 ? 0x57f287 : 0xed4245)
      .setDescription(
        `${result.applied} acties gelukt, ${result.failed} mislukt.` +
          (backupFile ? '\nEr is vooraf een momentopname bewaard.' : ''),
      );

    if (letop.length > 0) {
      embed.addFields({ name: 'Let op', value: kort(letop.slice(0, 10)) });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
  } catch (error) {
    await interaction.editReply(errorText(error));
  }
}

async function handleExport(interaction: ChatInputCommandInteraction, guild: Guild): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const template = await exportGuildFresh(guild);
  const json = JSON.stringify(template, null, 2);
  const file = new AttachmentBuilder(Buffer.from(json, 'utf8'), {
    name: `${guild.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
  });

  await interaction.editReply({
    content: 'Zet dit bestand in de templates-map om deze server elders te herhalen.',
    files: [file],
  });
}

function codeBlock(lines: string[]): string {
  const body = lines.join('\n').slice(0, 1000);
  return `\`\`\`diff\n${body || 'geen'}\n\`\`\``;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Er ging iets mis:\n\`\`\`\n${message.slice(0, 1800)}\n\`\`\``;
}
