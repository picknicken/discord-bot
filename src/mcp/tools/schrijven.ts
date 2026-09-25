import { z } from 'zod';
import type { Client } from 'discord.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../../config.js';
import { haalToegestaneGuild } from '../guildAccess.js';
import { jsonResultaat, foutResultaat, afhandelen } from '../resultaat.js';
import { maakSetupPlan, voerSetupUit } from '../../setupPlan.js';
import { describeActions, summarizePlan } from '../../planner.js';
import { werkTemplateBij } from '../../templateBeheer.js';
import { missingPermissions } from '../../botPermissions.js';
import { maakConfirmatie, verbruikConfirmatie, ConfirmatieFout } from '../confirmaties.js';
import { maakRol, wijzigRol, verwijderRol, RolFout, type RolWijziging } from '../../rolBeheer.js';
import { logMcpActie } from '../logging.js';

const guildIdVeld = z.string().describe('Het Discord-server-id (guild id). Moet op de MCP-allowlist staan.');
const templateIdVeld = z.string().describe('De template-naam, zoals in `/setup list` of het dashboard.');
const variabelenVeld = z
  .record(z.string(), z.string())
  .optional()
  .describe('Waarden voor variabelen die de template gebruikt, bijvoorbeeld { "clan": "Bloody Mayhem" }.');

const WIE = 'Claude (via MCP)';

/** Dezelfde velden als het rechtenformulier in het dashboard, allemaal optioneel. */
const rolVelden = {
  name: z.string().min(1).max(100).optional().describe('Nieuwe naam voor de rol.'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional().describe('Kleur als #rrggbb, of null voor geen kleur.'),
  hoist: z.boolean().optional().describe('Apart tonen in de ledenlijst.'),
  mentionable: z.boolean().optional().describe('Of iedereen deze rol mag pingen.'),
  permissions: z
    .array(z.string())
    .optional()
    .describe('De volledige nieuwe lijst rechten voor deze rol (vervangt de huidige lijst, niet optellen).'),
};

/**
 * Alle tools die iets veranderen: aan een template, aan een rol, of — via
 * `apply_template` — aan een hele server. Elke tool controleert eerst de
 * guild-allowlist, roept daarna precies dezelfde kernfunctie aan als het
 * dashboard en `/setup`, en logt wat er gebeurde.
 */
export function registreerSchrijfTools(server: McpServer, client: Client<true>): void {
  server.registerTool(
    'update_template',
    {
      title: 'Template bijwerken',
      description:
        'Overschrijft één template met nieuwe JSON. Wordt gevalideerd met dezelfde schema-validatie als het ' +
        'dashboard; een ongeldige template wordt nergens weggeschreven. De vorige versie blijft bewaard en is ' +
        'terug te zetten, net als bij een bewerking in het dashboard.',
      inputSchema: {
        templateId: templateIdVeld,
        json: z.string().describe('De volledige, nieuwe inhoud van de template als JSON-tekst.'),
      },
    },
    async ({ templateId, json }) =>
      afhandelen(async () => {
        try {
          const { template } = await werkTemplateBij(config.templatesDir, config.historyDir, templateId, json, WIE);
          logMcpActie('update_template', { templateId, resultaat: 'gelukt' });
          return jsonResultaat({ templateId, template, saved: true });
        } catch (error) {
          const reden = error instanceof Error ? error.message : String(error);
          logMcpActie('update_template', { templateId, resultaat: 'mislukt', reden });
          return foutResultaat(`Template niet opgeslagen: ${reden}`);
        }
      }),
  );

  server.registerTool(
    'preview_template',
    {
      title: 'Preview: wat zou een template op een server veranderen',
      description:
        'Bouwt hetzelfde plan als `/setup preview` en de dashboardpreview: wat er zou gebeuren als deze ' +
        'template op deze server wordt toegepast. Voert niets uit. Geeft een `confirmation_token` terug — die ' +
        'heb je nodig om `apply_template` daadwerkelijk te laten uitvoeren, en hij is maar tien minuten geldig ' +
        'en maar één keer te gebruiken voor precies dit plan.',
      inputSchema: {
        guildId: guildIdVeld,
        templateId: templateIdVeld,
        prune: z.boolean().optional().describe('Kanalen verwijderen die niet in de template staan. Standaard false.'),
        update: z.boolean().optional().describe('Bestaande rollen/kanalen bijwerken. Standaard true.'),
        variabelen: variabelenVeld,
      },
    },
    async ({ guildId, templateId, prune, update, variabelen }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        const { template, plan, aanpassingen, gebruikt, onbekend } = await maakSetupPlan(
          guild,
          config.templatesDir,
          templateId,
          { prune, update, variabelen },
        );

        const confirmatie = maakConfirmatie(guildId, templateId, plan);

        return jsonResultaat({
          guildId,
          templateId,
          templateName: template.name,
          actieAantal: plan.actions.length,
          acties: describeActions(plan),
          samenvatting: summarizePlan(plan),
          warnings: plan.warnings,
          aanpassingenDoorOntbrekendeRechten: aanpassingen,
          gebruikteVariabelen: gebruikt,
          onbekendeVariabelen: onbekend,
          confirmation_token: confirmatie.token,
          confirmation_verloopt: confirmatie.verlooptOm,
        });
      }),
  );

  server.registerTool(
    'apply_template',
    {
      title: 'Template echt toepassen',
      description:
        'Voert een template écht uit op een server: momentopname, aanpassen, loggen — dezelfde stappen als ' +
        '`/setup apply`. Vereist een geldig `confirmation_token` van een recente `preview_template`-aanroep voor ' +
        'precies deze server en template. Is de template of de server intussen veranderd, dan klopt de ' +
        'confirmatie niet meer en wordt er niets uitgevoerd — vraag dan een nieuwe preview op.',
      inputSchema: {
        guildId: guildIdVeld,
        templateId: templateIdVeld,
        confirmation_token: z.string().describe('Het token dat `preview_template` teruggaf.'),
        prune: z.boolean().optional().describe('Moet gelijk zijn aan wat bij de preview is meegegeven.'),
        update: z.boolean().optional().describe('Moet gelijk zijn aan wat bij de preview is meegegeven.'),
        variabelen: variabelenVeld,
      },
    },
    async ({ guildId, templateId, confirmation_token: token, prune, update, variabelen }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);

        const me = await guild.members.fetchMe();
        const missing = missingPermissions(me);
        if (missing.length > 0) {
          logMcpActie('apply_template', { guildId, templateId, resultaat: 'geweigerd', reden: 'bot mist rechten' });
          return foutResultaat(`De bot mist rechten in deze server: ${missing.join(', ')}.`);
        }

        // Precies zoals /setup apply: het plan wordt hier opnieuw gemaakt, tegen
        // de server zoals hij nú is. De confirmatie hieronder zorgt dat dat plan
        // nog steeds hetzelfde is als wat er bij de preview werd getoond.
        const { template, plan, aanpassingen } = await maakSetupPlan(guild, config.templatesDir, templateId, {
          prune,
          update,
          variabelen,
        });

        try {
          verbruikConfirmatie(token, guildId, templateId, plan);
        } catch (error) {
          const reden = error instanceof ConfirmatieFout ? error.message : 'ongeldige confirmatie';
          logMcpActie('apply_template', { guildId, templateId, resultaat: 'geweigerd', reden });
          return foutResultaat(reden);
        }

        if (plan.actions.length === 0) {
          logMcpActie('apply_template', { guildId, templateId, resultaat: 'gelukt', wijzigingen: 0 });
          return jsonResultaat({ applied: 0, failed: 0, message: 'Niets te doen — de server komt al overeen met de template.' });
        }

        const { applied, failed, backupFile, letop } = await voerSetupUit(
          guild,
          config.backupsDir,
          config.historyDir,
          templateId,
          template,
          plan,
          aanpassingen,
          WIE,
        );

        logMcpActie('apply_template', {
          guildId,
          templateId,
          resultaat: failed === 0 ? 'gelukt' : 'mislukt',
          wijzigingen: applied,
        });

        return jsonResultaat({ applied, failed, backupGemaakt: backupFile !== null, letOp: letop });
      }),
  );

  server.registerTool(
    'create_role',
    {
      title: 'Rol aanmaken',
      description:
        'Maakt een nieuwe rol aan in een toegestane server. De bot kan alleen rechten uitdelen die hij zelf ' +
        'heeft; een poging tot meer wordt geweigerd met uitleg, niet stilletjes bijgeschaafd.',
      inputSchema: { guildId: guildIdVeld, ...rolVelden },
    },
    async ({ guildId, ...wijziging }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        try {
          const rol = await maakRol(guild, wijziging as RolWijziging, WIE);
          logMcpActie('create_role', { guildId, resultaat: 'gelukt' });
          return jsonResultaat({ rol });
        } catch (error) {
          const reden = error instanceof RolFout ? error.message : error instanceof Error ? error.message : String(error);
          logMcpActie('create_role', { guildId, resultaat: 'mislukt', reden });
          return foutResultaat(reden);
        }
      }),
  );

  server.registerTool(
    'update_role',
    {
      title: 'Rol aanpassen',
      description:
        'Past een bestaande rol aan. Weigert een rol die boven (of gelijk aan) de rol van de bot staat, van een ' +
        'integratie is, of waarvoor de bot het benodigde recht mist — met de reden erbij, in plaats van het stilletjes ' +
        'over te slaan.',
      inputSchema: { guildId: guildIdVeld, roleId: z.string().describe('Het id van de rol.'), ...rolVelden },
    },
    async ({ guildId, roleId, ...wijziging }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        try {
          const rol = await wijzigRol(guild, roleId, wijziging as RolWijziging, WIE);
          logMcpActie('update_role', { guildId, resultaat: 'gelukt' });
          return jsonResultaat({ rol });
        } catch (error) {
          const reden = error instanceof RolFout ? error.message : error instanceof Error ? error.message : String(error);
          logMcpActie('update_role', { guildId, resultaat: 'mislukt', reden });
          return foutResultaat(reden);
        }
      }),
  );

  server.registerTool(
    'delete_role',
    {
      title: 'Rol verwijderen',
      description:
        'Verwijdert een rol. Weigert @everyone, een rol van een integratie, en een rol boven (of gelijk aan) de ' +
        'rol van de bot.',
      inputSchema: { guildId: guildIdVeld, roleId: z.string().describe('Het id van de rol.') },
    },
    async ({ guildId, roleId }) =>
      afhandelen(async () => {
        const guild = haalToegestaneGuild(client, guildId);
        try {
          const naam = await verwijderRol(guild, roleId, WIE);
          logMcpActie('delete_role', { guildId, resultaat: 'gelukt' });
          return jsonResultaat({ verwijderd: naam });
        } catch (error) {
          const reden = error instanceof RolFout ? error.message : error instanceof Error ? error.message : String(error);
          logMcpActie('delete_role', { guildId, resultaat: 'mislukt', reden });
          return foutResultaat(reden);
        }
      }),
  );
}
