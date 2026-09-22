import { REST } from 'discord.js';
import { config } from './config.js';
import { COMMANDS } from './bot.js';
import { buildInviteUrl } from './botPermissions.js';
import { inServer, meldCommandosAan, overal, type CommandoJSON, type CommandoKoppeling } from './commandos.js';
import { logger } from './util/logger.js';

/**
 * De commando's aanmelden bij Discord, met de hand.
 *
 * Sinds de bot dit bij het opstarten zelf doet is dit niet meer nodig voor het
 * gewone geval. Waar het nog wel voor is: meteen zichtbaar maken in één server
 * (dat duurt globaal tot een uur), en de kopieën die daardoor in die server
 * ontstaan weer opruimen.
 *
 * Wat Discord terugstuurt drukken we af, niet wat wij verstuurden: "geregistreerd"
 * omdat een verzoek niet klapte is geen bewijs. Nu staat er zwart op wit wat er
 * nu echt geregistreerd staat.
 */
const body = COMMANDS.map((command) => command.data.toJSON() as CommandoJSON);
const rest = new REST().setToken(config.token);

const koppeling: CommandoKoppeling = {
  get: (route) => rest.get(route as `/${string}`),
  put: (route, inhoud) => rest.put(route as `/${string}`, { body: inhoud }),
};

const modus = (process.env.COMMANDS_MODUS ?? '').trim().toLowerCase();
const weghalen = modus === 'weghalen';

if (weghalen && !config.devGuildId) {
  logger.error('Weghalen kan alleen in een server: geef DISCORD_DEV_GUILD_ID mee.');
  process.exit(1);
}

const route = config.devGuildId ? inServer(config.clientId, config.devGuildId) : overal(config.clientId);

let uitkomst;

try {
  // Weghalen is hetzelfde verzoek met een lege lijst: Discord vervangt wat er
  // staat door niets. De globale commando's blijven staan, en die nemen het in
  // die server dus weer over.
  uitkomst = await meldCommandosAan(koppeling, route, weghalen ? [] : body, { altijd: true });
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

for (const command of uitkomst.commandos) {
  const opties = Array.isArray(command['options']) ? (command['options'] as { name: string }[]) : [];
  const subs = opties.map((optie) => optie.name).join(', ');
  logger.info(`/${command.name}${subs ? ` (${subs})` : ''}`);
}

if (weghalen) {
  logger.info(
    `De eigen kopieën in server ${config.devGuildId} zijn weg. ` +
      'Wat daar nu staat zijn de commando\'s die overal gelden.',
  );
} else {
  logger.info(
    config.devGuildId
      ? `${uitkomst.commandos.length} commando('s) staan nu in server ${config.devGuildId}. ` +
          'Let op: dit zijn kopieën naast de globale. Haal ze weg als je ze niet meer nodig hebt.'
      : `${uitkomst.commandos.length} commando('s) staan nu overal waar de bot in zit (tot een uur zichtbaar).`,
  );
}

// Het valkuiltje dat je pas merkt als je in Discord staat te typen: is de bot
// ooit toegevoegd met alleen de scope "bot", dan mag hij wel praten maar horen
// zijn commando's daar niet bij. Opnieuw uitnodigen met dezelfde link herstelt
// dat zonder hem eruit te gooien.
logger.info(
  'Zie je ze niet in Discord? Dan is de bot waarschijnlijk toegevoegd zonder de scope ' +
    '"applications.commands". Opnieuw toevoegen met deze link zet dat recht:\n' +
    `  ${buildInviteUrl(config.clientId)}`,
);
