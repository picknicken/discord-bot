import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { COMMANDS } from './bot.js';
import { logger } from './util/logger.js';

const body = COMMANDS.map((command) => command.data.toJSON());
const rest = new REST().setToken(config.token);

const route = config.devGuildId
  ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
  : Routes.applicationCommands(config.clientId);

await rest.put(route, { body });

const namen = COMMANDS.map((command) => `/${command.data.name}`).join(', ');

logger.info(
  config.devGuildId
    ? `${namen} geregistreerd in testserver ${config.devGuildId} (direct actief).`
    : `${namen} globaal geregistreerd (kan tot een uur duren voor ze overal zichtbaar zijn).`,
);
