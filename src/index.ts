import { Client, Events } from 'discord.js';
import { config } from './config.js';
import { koppelBot } from './bot.js';
import { zaaiTemplates } from './templates.js';
import { buildInviteUrl } from './botPermissions.js';
import { startAutomatischeSync } from './clan/synchroniseren.js';
import { startBackupWacht } from './backupWacht.js';
import { startGeplandeUitrol } from './gepland.js';
import { startGeplandeAankondigingen } from './geplandeAankondiging.js';
import { startDriftWacht } from './driftWacht.js';
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
  volgAfwijkingen(ready);
  maakMomentopnames(ready);
  startGeplandeUitrol(ready, {
    templatesDir: config.templatesDir,
    backupsDir: config.backupsDir,
    historyDir: config.historyDir,
  });
  startGeplandeAankondigingen(ready, { historyDir: config.historyDir });
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

/**
 * Een server dwaalt af zonder dat iemand het merkt. Het dashboard laat het zien
 * zodra je kijkt, maar je kijkt pas als je al iets vermoedt - dus kijkt de bot
 * zelf, en zegt het in de server zodra er iets verandert.
 */
function volgAfwijkingen(ready: Client<true>): void {
  if (config.driftCheckUren <= 0) return;

  startDriftWacht(ready, {
    historyDir: config.historyDir,
    templatesDir: config.templatesDir,
    toegestaneServers: config.toegestaneServers,
    uren: config.driftCheckUren,
  });
  logger.info(`Elke ${config.driftCheckUren} uur wordt gekeken of een server is afgedwaald.`);
}

/**
 * Een momentopname ook als er niets gebeurt. Er werd er alleen een gemaakt vlak
 * voor een uitrol; gebeurt er een maand niets en gaat er dan iets mis, dan is
 * dat je laatste - of is er geen.
 */
function maakMomentopnames(ready: Client<true>): void {
  if (config.backupUren <= 0) return;

  startBackupWacht(ready, {
    backupsDir: config.backupsDir,
    toegestaneServers: config.toegestaneServers,
    uren: config.backupUren,
    bewaar: config.backupBewaar,
  });
  logger.info(`Elke ${config.backupUren} uur een momentopname; de laatste ${config.backupBewaar} blijven staan.`);
}

process.on('unhandledRejection', (reason) => logger.error('Onafgehandelde rejection', reason));

await login(client, config.token);
