import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'discord.js';

/**
 * Het echte dashboard, maar met een nagemaakte Discord-client ervoor. Bedoeld om
 * lokaal te kijken of alles draait voordat je een bot aanmaakt: geen token, geen
 * applicatie, geen risico. Je bewerkingen gaan naar een aparte map, dus je echte
 * templates blijven ongemoeid.
 *
 * De vier servers die je hier ziet zijn met opzet verschillend: eentje die klopt,
 * eentje die is afgedwaald, een lege, en eentje waar de bot te weinig rechten
 * heeft. Zo kun je elk scherm bouwen en nakijken zonder Discord.
 */
const SANDBOX = '.demo';

process.env.DEMO = '1';
process.env.DISCORD_TOKEN ||= 'demo';
process.env.DISCORD_CLIENT_ID ||= '000000000000000000';
process.env.DISCORD_CLIENT_SECRET = '';
process.env.TEMPLATES_DIR = path.join(SANDBOX, 'templates');
process.env.BACKUPS_DIR = path.join(SANDBOX, 'backups');
process.env.HISTORY_DIR = path.join(SANDBOX, 'history');

const { config } = await import('./config.js');
const { createDashboard } = await import('./dashboard/server.js');
const { demoGuilds, DEMO_SERVERS } = await import('./demoServers.js');
const { logger } = await import('./util/logger.js');

// Eén keer kopiëren; daarna blijven je bewerkingen in de sandbox staan.
if (!existsSync(config.templatesDir)) {
  await mkdir(SANDBOX, { recursive: true });
  await cp('templates', config.templatesDir, { recursive: true });
}

const client = {
  user: {
    username: config.botName,
    id: config.clientId,
    displayAvatarURL: () => '/logo.png',
  },
  guilds: { cache: demoGuilds() },
  application: { id: config.clientId },
  // Een Discord dat de commando's kent die deze versie van de bot heeft. Zo laat
  // het instellingenscherm in de demo hetzelfde zien als straks in het echt.
  rest: {
    get: async () => {
      const { COMMANDS } = await import('./bot.js');
      return COMMANDS.map((command) => command.data.toJSON());
    },
    put: async () => [],
  },
  // Een nagemaakte discord.new-template, zodat ook dat scherm zonder Discord
  // werkt. Elke code levert dezelfde op.
  fetchGuildTemplate: async (code: string) => ({
    code,
    name: 'Voorbeeld van Discord',
    serializedGuild: {
      name: 'Voorbeeld van Discord',
      verification_level: 1,
      roles: [
        { id: 0, name: '@everyone', permissions: '104324673' },
        { id: 1, name: 'Moderator', color: 0xed4245, hoist: true, permissions: '8192' },
      ],
      channels: [
        { id: 10, type: 4, name: 'Algemeen', permission_overwrites: [] },
        { id: 11, type: 0, name: 'welkom', parent_id: 10, topic: 'Begin hier' },
        { id: 12, type: 2, name: 'Praatkanaal', parent_id: 10 },
      ],
    },
  }),
} as unknown as Client<true>;

createDashboard(client).listen(config.dashboardPort, '127.0.0.1', () => {
  logger.info('Demo — geen bot verbonden, geen echte server wordt gewijzigd.');
  logger.info(`Dashboard: http://127.0.0.1:${config.dashboardPort}`);
  for (const server of DEMO_SERVERS) logger.info(`  ${server.naam} — ${server.scenario}`);
  logger.info(`Bewerkingen gaan naar ${config.templatesDir} (je echte templates blijven ongemoeid).`);
});
