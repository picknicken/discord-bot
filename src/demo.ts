import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

/**
 * Het echte dashboard, maar met een nagemaakte Discord-client ervoor. Bedoeld om
 * lokaal te kijken of alles draait voordat je een bot aanmaakt: geen token, geen
 * applicatie, geen risico. Je bewerkingen gaan naar een aparte map, dus je echte
 * templates blijven ongemoeid.
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
const { logger } = await import('./util/logger.js');

// Eén keer kopiëren; daarna blijven je bewerkingen in de sandbox staan.
if (!existsSync(config.templatesDir)) {
  await mkdir(SANDBOX, { recursive: true });
  await cp('templates', config.templatesDir, { recursive: true });
}

const role = (id: string, name: string, position: number, color = 0x99aab5, managed = false) => ({
  id, name, color, hoist: false, mentionable: false,
  permissions: new PermissionsBitField(0n), position, managed,
});

const channel = (id: string, name: string, type: ChannelType, parentId: string | null, position = 0) => ({
  id, name, type, parentId, rawPosition: position,
  topic: null, nsfw: false, rateLimitPerUser: 0, userLimit: 0,
  isThread: () => false,
  permissionOverwrites: { cache: new Collection() },
});

/** Een server die half op de community-template lijkt, zodat de Server-tab iets te tonen heeft. */
function demoGuild(id: string, name: string, members: number, complete: boolean) {
  const channels = new Collection<string, ReturnType<typeof channel>>();
  const roles = new Collection<string, ReturnType<typeof role>>();

  roles.set(id, role(id, '@everyone', 0));
  if (complete) {
    for (const [key, label, position, color] of [
      ['r1', 'Lid', 1, 0x57f287],
      ['r2', 'Oud-lid', 2, 0x99aab5],
    ] as const) {
      roles.set(key, role(key, label, position, color));
    }
    roles.set('r3', role('r3', 'Een andere bot', 3, 0x5865f2, true));

    for (const c of [
      channel('c1', 'Welkom', ChannelType.GuildCategory, null, 0),
      channel('c2', 'welkom', ChannelType.GuildText, 'c1', 0),
      channel('c3', 'Gesprekken', ChannelType.GuildCategory, null, 1),
      channel('c4', 'algemeen', ChannelType.GuildText, 'c3', 0),
      channel('c5', 'oude-memes', ChannelType.GuildText, 'c3', 1),
      channel('c6', 'Archief', ChannelType.GuildCategory, null, 2),
      channel('c7', 'stof', ChannelType.GuildText, 'c6', 0),
    ]) channels.set(c.id, c);
  }

  const rights = complete
    ? PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageGuild
    : PermissionFlagsBits.ViewChannel;

  return {
    id, name, memberCount: members,
    iconURL: () => null,
    description: null,
    features: [] as string[],
    systemChannelId: null, afkChannelId: null, rulesChannelId: null, publicUpdatesChannelId: null,
    roles: { cache: roles },
    channels: { cache: channels },
    emojis: { cache: new Collection() },
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection() },
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(rights),
        roles: { highest: { position: 9 } },
      }),
    },
  };
}

const guilds = new Collection<string, ReturnType<typeof demoGuild>>();
guilds.set('1', demoGuild('1', 'Mijn Testserver', 428, true));
guilds.set('2', demoGuild('2', 'Clan Server', 76, false));

const client = {
  user: {
    username: config.botName,
    id: config.clientId,
    displayAvatarURL: () => '/logo.png',
  },
  guilds: { cache: guilds },
} as unknown as Client<true>;

createDashboard(client).listen(config.dashboardPort, '127.0.0.1', () => {
  logger.info('Demo — geen bot verbonden, geen echte server wordt gewijzigd.');
  logger.info(`Dashboard: http://127.0.0.1:${config.dashboardPort}`);
  logger.info(`Bewerkingen gaan naar ${config.templatesDir} (je echte templates blijven ongemoeid).`);
});
