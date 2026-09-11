import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';
import * as setup from './commands/setup.js';
import { handleGuildCreate } from './events/guildCreate.js';
import { buildInviteUrl } from './botPermissions.js';
import { logger } from './util/logger.js';
import { login } from './util/start.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  logger.info(`Ingelogd als ${ready.user.tag} — actief in ${ready.guilds.cache.size} server(s)`);
  logger.info(`Invite-link met de juiste rechten: ${buildInviteUrl(ready.application.id)}`);
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await handleGuildCreate(guild);
  } catch (error) {
    logger.error(`Afhandelen van join in "${guild.name}" mislukt`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete() && interaction.commandName === setup.data.name) {
      await setup.autocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === setup.data.name) {
      await setup.execute(interaction);
    }
  } catch (error) {
    logger.error('Interactie mislukt', error);
    if (interaction.isRepliable()) {
      const message = { content: 'Er ging iets mis bij het uitvoeren van dit commando.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(message).catch(() => undefined);
      } else {
        await interaction.reply(message).catch(() => undefined);
      }
    }
  }
});

process.on('unhandledRejection', (reason) => logger.error('Onafgehandelde rejection', reason));

await login(client, config.token);
