import { Client, Events, Team, type ClientApplication } from 'discord.js';
import { config } from './config.js';
import { koppelBot } from './bot.js';
import { zaaiTemplates } from './templates.js';
import { authEnabled, createDashboard } from './dashboard/server.js';
import { startAutomatischeSync } from './clan/synchroniseren.js';
import { startBackupWacht } from './backupWacht.js';
import { startDriftWacht } from './driftWacht.js';
import { kiesIntents } from './util/intents.js';
import { logger } from './util/logger.js';
import { login } from './util/start.js';

/**
 * Start de bot en zet er een dashboard naast. Het dashboard gebruikt dezelfde
 * client, dus wat je in de browser ziet is de echte staat van je servers.
 */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

// Op een host met een volume begint de templatemap leeg. Dan staan de
// meegeleverde templates er na deze regel wel in.
const gezaaid = await zaaiTemplates(config.templatesDir);
if (gezaaid.length > 0) {
  logger.info(`Templates klaargezet in ${config.templatesDir}: ${gezaaid.join(', ')}`);
}

// Welke intents we mogen vragen hangt af van een schakelaar in het Developer
// Portal; vragen we er een die uitstaat, dan weigert Discord de hele inlog.
const client = new Client({ intents: await kiesIntents(config.token) });

// Dezelfde bot, dus /setup werkt ook als je alleen dit proces draait.
koppelBot(client);

client.once(Events.ClientReady, async (ready) => {
  const local = LOCAL_HOSTS.includes(config.dashboardHost);

  // Buiten localhost staat de pagina open voor iedereen die hem kan bereiken.
  // Zonder inloggen zou dat betekenen: iedereen mag jouw servers herinrichten.
  if (!local && !authEnabled()) {
    logger.error(
      `DASHBOARD_HOST staat op ${config.dashboardHost}, maar inloggen is uit. ` +
        'Zet DISCORD_CLIENT_SECRET erbij (en DASHBOARD_URL op het adres waarop je het ' +
        'dashboard opent), of zet de host terug op 127.0.0.1.',
    );
    process.exit(1);
  }

  // Buiten localhost draaien met een localhost-adres erin betekent: Discord
  // stuurt je na het inloggen terug naar een computer die er niet is. Beter nu
  // een regel in het log dan straks "Ongeldige OAuth2 redirect_uri".
  if (!local && /127\.0\.0\.1|localhost/.test(config.dashboardUrl)) {
    logger.warn(
      `DASHBOARD_URL staat nog op ${config.dashboardUrl}, maar dit draait niet op je eigen computer. ` +
        'Zet hem op het adres waarop jij het dashboard opent, en zet datzelfde adres + /auth/callback ' +
        'in het Developer Portal onder OAuth2 -> Redirects.',
    );
  }

  const application = await ready.application.fetch();
  const owners = ownersOf(application);

  if (authEnabled() && owners.length === 0 && config.dashboardOwners.length === 0) {
    logger.warn('Geen eigenaar gevonden en DASHBOARD_OWNERS is leeg — niemand kan inloggen.');
  }

  // Ook hier, want wie alleen het dashboard draait heeft verder geen proces dat
  // de clanrangen bijhoudt.
  if (config.clanSyncMinuten > 0) startAutomatischeSync(ready, config.clanDir, config.clanSyncMinuten);

  // En hetzelfde voor de controle of een server is afgedwaald: dit is het proces
  // dat op een host dag en nacht draait.
  if (config.driftCheckUren > 0) {
    startDriftWacht(ready, {
      historyDir: config.historyDir,
      templatesDir: config.templatesDir,
      toegestaneServers: config.toegestaneServers,
      uren: config.driftCheckUren,
    });
    logger.info(`Elke ${config.driftCheckUren} uur wordt gekeken of een server is afgedwaald.`);
  }

  // En af en toe een momentopname, ook als er niets gebeurt: anders heb je er
  // alleen een van vlak voor de laatste uitrol, en die kan maanden oud zijn.
  if (config.backupUren > 0) {
    startBackupWacht(ready, {
      backupsDir: config.backupsDir,
      toegestaneServers: config.toegestaneServers,
      uren: config.backupUren,
      bewaar: config.backupBewaar,
    });
    logger.info(`Elke ${config.backupUren} uur een momentopname; de laatste ${config.backupBewaar} blijven staan.`);
  }

  const server = createDashboard(ready, { applicationOwners: owners });

  server.listen(config.dashboardPort, config.dashboardHost, () => {
    logger.info(`Ingelogd als ${ready.user.tag} — ${ready.guilds.cache.size} server(s)`);
    logger.info(`Dashboard: http://${config.dashboardHost}:${config.dashboardPort}`);
    logger.info(
      authEnabled()
        ? `Inloggen met Discord staat aan. Redirect-URL in het portal: ${config.dashboardUrl}/auth/callback`
        : 'Inloggen staat uit — het dashboard is alleen bereikbaar vanaf deze computer.',
    );
  });

  server.on('error', (error) => {
    logger.error(`Dashboard kon poort ${config.dashboardPort} niet gebruiken`, error);
    process.exit(1);
  });
});

/** De eigenaar van de applicatie, of alle leden van het team dat hem beheert. */
function ownersOf(application: ClientApplication): string[] {
  const owner = application.owner;
  if (!owner) return [];
  if (owner instanceof Team) return [...owner.members.values()].map((member) => member.user.id);
  return [owner.id];
}

process.on('unhandledRejection', (reason) => logger.error('Onafgehandelde rejection', reason));

await login(client, config.token);
