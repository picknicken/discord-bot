import { z } from 'zod';
import type { Client } from 'discord.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../../config.js';
import { haalToegestaneGuild, toegestaneGuilds } from '../guildAccess.js';
import { jsonResultaat, afhandelen } from '../resultaat.js';
import { snapshotGuild, snapshotGuildFresh } from '../../snapshot.js';
import { beschrijfRollen } from '../../rolBeheer.js';
import { loadAllTemplates, loadTemplateMet } from '../../templates.js';
import { compare } from '../../compare.js';
import { driftVanServer } from '../../drift.js';
import { recenteWijzigingen } from '../../auditlog.js';
import { readSetups } from '../../setupLog.js';
import { aangegevenVariabelen } from '../../variabelen.js';

const guildIdVeld = z.string().describe('Het Discord-server-id (guild id). Moet op de MCP-allowlist staan.');
const templateIdVeld = z.string().describe('De template-naam, zoals in `/setup list` of het dashboard.');

/**
 * Alle tools die alleen lezen. Geen enkele hiervan verandert iets aan Discord
 * of aan een template op schijf - dat maakt ze veilig genoeg om zonder
 * confirmatie te draaien.
 */
export function registreerLeesTools(server: McpServer, client: Client<true>): void {
  server.registerTool(
    'list_allowed_servers',
    {
      title: 'Toegestane servers',
      description:
        'Geeft alleen de Discord-servers terug die op de MCP-allowlist staan (MCP_ALLOWED_GUILD_IDS) én ' +
        'waar deze bot daadwerkelijk in zit. Nooit servers daarbuiten.',
      inputSchema: {},
    },
    async () =>
      jsonResultaat({
        servers: toegestaneGuilds(client).map((guild) => ({
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount,
        })),
      }),
  );

  server.registerTool(
    'get_server',
    {
      title: 'Serverinformatie',
      description: 'Informatie over één toegestane server: naam, aantal leden, rollen en kanalen.',
      inputSchema: { guildId: guildIdVeld },
    },
    async ({ guildId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        const snapshot = snapshotGuild(guild);
        return jsonResultaat({
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount,
          roleCount: snapshot.roles.length,
          categoryCount: snapshot.categories.length,
          channelCount: snapshot.channels.length,
          features: guild.features,
        });
      }),
  );

  server.registerTool(
    'list_channels',
    {
      title: 'Kanalen van een server',
      description: 'De categorieën en kanalen van één toegestane server, zoals ze nu in Discord staan.',
      inputSchema: { guildId: guildIdVeld },
    },
    async ({ guildId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        const snapshot = snapshotGuild(guild);
        const categorieNaam = new Map(snapshot.categories.map((cat) => [cat.id, cat.name]));

        return jsonResultaat({
          categories: snapshot.categories.map((cat) => ({ id: cat.id, name: cat.name })),
          channels: snapshot.channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            categoryId: channel.parentId,
            categoryName: channel.parentId ? (categorieNaam.get(channel.parentId) ?? null) : null,
          })),
        });
      }),
  );

  server.registerTool(
    'list_roles',
    {
      title: 'Rollen van een server',
      description:
        'De rollen van één toegestane server, met per rol of de bot hem kan beheren en zo niet, waarom niet ' +
        '(bijvoorbeeld: staat boven de bot, of hoort bij een integratie).',
      inputSchema: { guildId: guildIdVeld },
    },
    async ({ guildId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        return jsonResultaat(await beschrijfRollen(guild));
      }),
  );

  server.registerTool(
    'get_role',
    {
      title: 'Eén rol',
      description: 'Details van één rol in een toegestane server.',
      inputSchema: { guildId: guildIdVeld, roleId: z.string().describe('Het id van de rol.') },
    },
    async ({ guildId, roleId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        const { rollen } = await beschrijfRollen(guild);
        const rol = rollen.find((kandidaat) => kandidaat.id === roleId);
        if (!rol) return jsonResultaat({ error: 'Die rol bestaat niet (meer) in deze server.' });
        return jsonResultaat(rol);
      }),
  );

  server.registerTool(
    'get_permissions',
    {
      title: 'Rechten van een rol',
      description:
        'De rechten van een rol. Met `channelId` erbij: de effectieve rechten van die rol in dat specifieke ' +
        'kanaal, zoals Discord ze zelf uitrekent (overwrites van kanaal en categorie meegenomen). Zonder ' +
        '`channelId`: de basisrechten van de rol, zonder kanaal-overwrites.',
      inputSchema: {
        guildId: guildIdVeld,
        roleId: z.string().describe('Het id van de rol.'),
        channelId: z.string().optional().describe('Optioneel: reken de rechten uit voor dit ene kanaal.'),
      },
    },
    async ({ guildId, roleId, channelId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        const role = guild.roles.cache.get(roleId);
        if (!role) return jsonResultaat({ error: 'Die rol bestaat niet (meer) in deze server.' });

        if (!channelId) {
          return jsonResultaat({ guildId, roleId, permissions: role.permissions.toArray() });
        }

        const channel = guild.channels.cache.get(channelId);
        if (!channel || !('permissionsFor' in channel)) {
          return jsonResultaat({ error: 'Dat kanaal bestaat niet (meer) in deze server.' });
        }

        const effectief = channel.permissionsFor(role);
        return jsonResultaat({
          guildId,
          roleId,
          channelId,
          permissions: effectief ? effectief.toArray() : [],
        });
      }),
  );

  server.registerTool(
    'list_templates',
    {
      title: 'Beschikbare templates',
      description: 'Alle templates in de templates-map, met een korte samenvatting van elk.',
      inputSchema: {},
    },
    async () =>
      afhandelen(async () => {
        const templates = await loadAllTemplates(config.templatesDir);
        return jsonResultaat({
          templates: templates.map(({ id, template }) => ({
            id,
            name: template.name,
            description: template.description,
            roleCount: template.roles.length,
            categoryCount: template.categories.length,
            channelCount:
              template.categories.reduce((sum, cat) => sum + cat.channels.length, 0) +
              template.uncategorizedChannels.length,
            variables: Object.keys(template.variables),
          })),
        });
      }),
  );

  server.registerTool(
    'get_template',
    {
      title: 'Eén template',
      description:
        'De volledig gevalideerde inhoud van één template (na het toepassen van een eventuele basis). Zonder ' +
        'ingevulde variabelen blijven placeholders als `{{naam}}` zichtbaar staan.',
      inputSchema: { templateId: templateIdVeld },
    },
    async ({ templateId }) =>
      afhandelen(async () => {
        const { template, onbekend } = await loadTemplateMet(config.templatesDir, templateId, {}, { losjes: true });
        return jsonResultaat({
          template,
          variables: aangegevenVariabelen(JSON.stringify(template)),
          onbekendeVariabelenInTemplate: onbekend,
        });
      }),
  );

  server.registerTool(
    'compare_server',
    {
      title: 'Server vergelijken met een template',
      description:
        'Legt een toegestane server naast een template: wat staat er al, wat zou erbij komen, en vooral wat ' +
        'op de server staat dat niet in de template voorkomt (drift). Verandert niets.',
      inputSchema: { guildId: guildIdVeld, templateId: templateIdVeld },
    },
    async ({ guildId, templateId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        const { template } = await loadTemplateMet(config.templatesDir, templateId, {}, { losjes: true });
        const snapshot = await snapshotGuildFresh(guild, template);
        return jsonResultaat(compare(snapshot, template));
      }),
  );

  server.registerTool(
    'get_drift',
    {
      title: 'Afwijking van de laatst uitgerolde template',
      description:
        'Hoeveel een server nu afwijkt van de template die er het laatst écht op is toegepast (niet een ' +
        'preview). Geen enkele uitrol op deze server geeft een lege uitkomst, geen fout.',
      inputSchema: { guildId: guildIdVeld },
    },
    async ({ guildId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        const runs = await readSetups(config.historyDir, 500);
        return jsonResultaat(await driftVanServer(guild, runs, config.templatesDir));
      }),
  );

  server.registerTool(
    'get_recent_changes',
    {
      title: 'Recente wijzigingen (auditlog)',
      description: 'Wie er recent iets aan rollen, kanalen, rechten of serverinstellingen heeft veranderd.',
      inputSchema: {
        guildId: guildIdVeld,
        limiet: z.number().int().min(1).max(100).optional().describe('Hoeveel regels, standaard 25.'),
      },
    },
    async ({ guildId, limiet }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        return jsonResultaat(await recenteWijzigingen(guild, limiet ?? 25));
      }),
  );
}
