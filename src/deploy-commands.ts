import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import * as setup from './commands/setup.js';
import { logger } from './util/logger.js';

const body = [setup.data.toJSON()];
const rest = new REST().setToken(config.token);

const route = config.devGuildId
  ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
  : Routes.applicationCommands(config.clientId);

await rest.put(route, { body });

logger.info(
  config.devGuildId
    ? `Commands geregistreerd in testserver ${config.devGuildId} (direct actief).`
    : 'Commands globaal geregistreerd (kan tot een uur duren voor ze overal zichtbaar zijn).',
);
