import { Client, Events, GatewayIntentBits, Team, type ClientApplication } from 'discord.js';
import { config } from './config.js';
import { koppelBot } from './bot.js';
import { zaaiTemplates } from './templates.js';
import { authEnabled, createDashboard } from './dashboard/server.js';
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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

  const application = await ready.application.fetch();
  const owners = ownersOf(application);

  if (authEnabled() && owners.length === 0 && config.dashboardOwners.length === 0) {
    logger.warn('Geen eigenaar gevonden en DASHBOARD_OWNERS is leeg — niemand kan inloggen.');
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
