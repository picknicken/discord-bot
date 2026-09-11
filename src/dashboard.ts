import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { createDashboard } from './dashboard/server.js';
import { logger } from './util/logger.js';

/**
 * Start de bot en zet er een lokaal dashboard naast. Het dashboard gebruikt
 * dezelfde client, dus wat je in de browser ziet is de echte staat van je servers.
 */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  const server = createDashboard(ready);

  server.listen(config.dashboardPort, '127.0.0.1', () => {
    logger.info(`Ingelogd als ${ready.user.tag} — ${ready.guilds.cache.size} server(s)`);
    logger.info(`Dashboard: http://127.0.0.1:${config.dashboardPort}`);
  });

  server.on('error', (error) => {
    logger.error(`Dashboard kon poort ${config.dashboardPort} niet gebruiken`, error);
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason) => logger.error('Onafgehandelde rejection', reason));

await client.login(config.token);
