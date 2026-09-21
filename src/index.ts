import { Client, Events } from 'discord.js';
import { config } from './config.js';
import { koppelBot } from './bot.js';
import { zaaiTemplates } from './templates.js';
import { buildInviteUrl } from './botPermissions.js';
import { startAutomatischeSync } from './clan/synchroniseren.js';
import { kiesIntents } from './util/intents.js';
import { logger } from './util/logger.js';
import { login } from './util/start.js';

const gezaaid = await zaaiTemplates(config.templatesDir);
if (gezaaid.length > 0) {
  logger.info(`Templates klaargezet in ${config.templatesDir}: ${gezaaid.join(', ')}`);
}

// Welke intents we mogen vragen hangt af van een schakelaar in het Developer
// Portal; vragen we er een die uitstaat, dan weigert Discord de hele inlog.
const client = new Client({ intents: await kiesIntents(config.token) });

client.once(Events.ClientReady, (ready) => {
  logger.info(`Ingelogd als ${ready.user.tag} — actief in ${ready.guilds.cache.size} server(s)`);
  logger.info(`Invite-link met de juiste rechten: ${buildInviteUrl(ready.application.id)}`);
  volgClanrangen(ready);
});

koppelBot(client);

/**
 * Clanrangen lopen achter zodra iemand in het spel promoveert; daar komt geen
 * Discord-gebeurtenis van. Dus kijkt de bot zelf af en toe, maar alleen voor
 * servers die daar in het dashboard om gevraagd hebben.
 */
function volgClanrangen(ready: Client<true>): void {
  if (config.clanSyncMinuten <= 0) return;
  startAutomatischeSync(ready, config.clanDir, config.clanSyncMinuten);
  logger.info(`Clanrangen worden elke ${config.clanSyncMinuten} minuten bijgewerkt waar dat aanstaat.`);
}

process.on('unhandledRejection', (reason) => logger.error('Onafgehandelde rejection', reason));

await login(client, config.token);
