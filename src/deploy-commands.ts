import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { COMMANDS } from './bot.js';
import { buildInviteUrl } from './botPermissions.js';
import { logger } from './util/logger.js';

/**
 * De commando's aanmelden bij Discord. Tot dit gedraaid heeft bestaat /setup of
 * /clan daar niet, hoe goed de bot verder ook draait.
 *
 * Wat Discord terugstuurt drukken we af, niet wat wij verstuurden: "geregistreerd"
 * omdat een verzoek niet klapte is geen bewijs. Nu staat er zwart op wit wat er
 * nu echt geregistreerd staat.
 */
const body = COMMANDS.map((command) => command.data.toJSON());
const rest = new REST().setToken(config.token);

const route = config.devGuildId
  ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
  : Routes.applicationCommands(config.clientId);

let geregistreerd: Array<{ name: string; id: string; options?: Array<{ name: string }> }>;

try {
  geregistreerd = (await rest.put(route, { body })) as typeof geregistreerd;
} catch (error) {
  const tekst = error instanceof Error ? error.message : String(error);

  // Missing Access op een server-route betekent bijna altijd hetzelfde: de bot
  // zit niet in die server, of het server-id klopt niet.
  if (config.devGuildId && /missing access|unknown guild|50001|10004/i.test(tekst)) {
    logger.error(
      `Discord laat de bot niet bij server ${config.devGuildId}.\n` +
        '  - Klopt het server-id? (Discord -> rechtermuisknop op de server -> ID kopieren)\n' +
        '  - Zit de bot in die server? Uitnodigen kan hiermee:\n' +
        `    ${buildInviteUrl(config.clientId)}`,
    );
    process.exit(1);
  }

  logger.error(`Commands aanmelden mislukt: ${tekst}`);
  process.exit(1);
}

for (const command of geregistreerd) {
  const subs = (command.options ?? []).map((optie) => optie.name).join(', ');
  logger.info(`/${command.name}${subs ? ` (${subs})` : ''}`);
}

logger.info(
  config.devGuildId
    ? `${geregistreerd.length} commando('s) staan nu in server ${config.devGuildId}.`
    : `${geregistreerd.length} commando('s) staan nu overal waar de bot in zit (tot een uur zichtbaar).`,
);

// Het valkuiltje dat je pas merkt als je in Discord staat te typen: is de bot
// ooit toegevoegd met alleen de scope "bot", dan mag hij wel praten maar horen
// zijn commando's daar niet bij. Opnieuw uitnodigen met dezelfde link herstelt
// dat zonder hem eruit te gooien.
logger.info(
  'Zie je ze niet in Discord? Dan is de bot waarschijnlijk toegevoegd zonder de scope ' +
    '"applications.commands". Opnieuw toevoegen met deze link zet dat recht:\n' +
    `  ${buildInviteUrl(config.clientId)}`,
);
