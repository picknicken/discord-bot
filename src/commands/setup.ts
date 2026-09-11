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
import { exportGuild } from '../exporter.js';
import { describeActions, planSetup, summarizePlan } from '../planner.js';
import { snapshotGuildFresh } from '../snapshot.js';
import { listTemplateIds, loadAllTemplates, loadTemplate } from '../templates.js';
import { logger } from '../util/logger.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Richt deze server automatisch in vanuit een template')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('list').setDescription('Toon alle beschikbare templates'))
  .addSubcommand((sub) =>
    sub
      .setName('preview')
      .setDescription('Laat zien wat er zou gebeuren, zonder iets te wijzigen')
      .addStringOption((option) =>
        option.setName('template').setDescription('Welke template').setRequired(true).setAutocomplete(true),
      )
      .addBooleanOption((option) =>
        option.setName('prune').setDescription('Kanalen verwijderen die niet in de template staan'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('apply')
      .setDescription('Voer de template uit op deze server')
      .addStringOption((option) =>
        option.setName('template').setDescription('Welke template').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('bevestig')
          .setDescription('Typ de servernaam exact over om te bevestigen')
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option.setName('prune').setDescription('Kanalen verwijderen die niet in de template staan'),
      )
      .addBooleanOption((option) =>
        option.setName('update').setDescription('Bestaande rollen/kanalen bijwerken (standaard: aan)'),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('export').setDescription('Exporteer de huidige server als template-bestand'),
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

  switch (interaction.options.getSubcommand()) {
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

async function handlePreview(interaction: ChatInputCommandInteraction, guild: Guild): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getString('template', true);

  try {
    const template = await loadTemplate(config.templatesDir, id);
    const plan = planSetup(await snapshotGuildFresh(guild), template, {
      prune: interaction.options.getBoolean('prune') ?? false,
      update: true,
    });

    const embed = new EmbedBuilder()
      .setTitle(`Preview: ${template.name}`)
      .setColor(0xfee75c)
      .setDescription(summarizePlan(plan))
      .addFields({ name: 'Acties', value: codeBlock(describeActions(plan)) });

    if (plan.warnings.length > 0) {
      embed.addFields({ name: 'Waarschuwingen', value: plan.warnings.join('\n') });
    }

    await interaction.editReply({
      embeds: [embed],
      content: 'Er is niets gewijzigd. Gebruik `/setup apply` om dit door te voeren.',
    });
  } catch (error) {
    await interaction.editReply(errorText(error));
  }
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
    const template = await loadTemplate(config.templatesDir, id);
    const plan = planSetup(await snapshotGuildFresh(guild), template, {
      prune: interaction.options.getBoolean('prune') ?? false,
      update: interaction.options.getBoolean('update') ?? true,
    });

    if (plan.actions.length === 0) {
      await interaction.editReply('Niets te doen — de server komt al overeen met de template.');
      return;
    }

    await interaction.editReply(`Bezig met ${plan.actions.length} acties… (${summarizePlan(plan)})`);
    logger.info(`Template "${id}" toepassen op ${guild.name} (${guild.id}) door ${interaction.user.tag}`);

    const result = await applyPlan(guild, template, plan);

    const embed = new EmbedBuilder()
      .setTitle(result.failed === 0 ? 'Setup afgerond' : 'Setup afgerond met fouten')
      .setColor(result.failed === 0 ? 0x57f287 : 0xed4245)
      .setDescription(`${result.applied} acties gelukt, ${result.failed} mislukt.`);

    if (result.errors.length > 0) {
      embed.addFields({ name: 'Fouten', value: codeBlock(result.errors.slice(0, 10)) });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
  } catch (error) {
    await interaction.editReply(errorText(error));
  }
}

async function handleExport(interaction: ChatInputCommandInteraction, guild: Guild): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const template = exportGuild(guild);
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
