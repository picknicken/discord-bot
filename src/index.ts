import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { koppelBot } from './bot.js';
import { buildInviteUrl } from './botPermissions.js';
import { logger } from './util/logger.js';
import { login } from './util/start.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  logger.info(`Ingelogd als ${ready.user.tag} — actief in ${ready.guilds.cache.size} server(s)`);
  logger.info(`Invite-link met de juiste rechten: ${buildInviteUrl(ready.application.id)}`);
});

koppelBot(client);

process.on('unhandledRejection', (reason) => logger.error('Onafgehandelde rejection', reason));

await login(client, config.token);
