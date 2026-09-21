import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChannelType,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { missingPermissions, rolesAboveBot } from '../botPermissions.js';
import { applyPlan } from '../applier.js';
import { exportGuildFresh } from '../exporter.js';
import { recenteWijzigingen } from '../auditlog.js';
import { driftVanServer } from '../drift.js';
import { opruimlijst } from '../opruimen.js';
import { rolUit } from '../uitvoeren.js';
import { leesGepland, nieuweUitrol, schrijfGepland } from '../gepland.js';
import { templateCode, uitDiscordTemplate } from '../importeren.js';
import { describeActions, planRegels, planSetup, summarizePlan } from '../planner.js';
import { snapshotGuildFresh } from '../snapshot.js';
import { listTemplateIds, loadTemplateMet } from '../templates.js';
import { auditSummary, countBySeverity, lintTemplate } from '../lint.js';
import { PERMISSION_CATALOGUE } from '../permissionCatalogue.js';
import { filterPlan, leesOnderdelen, ONDERDELEN, UITLEG } from '../onderdelen.js';
import { maakHaalbaar } from '../haalbaar.js';
import { logSetup, readSetups } from '../setupLog.js';
import { letopEmbed, meldInServer } from '../util/melden.js';
import { buildInviteUrl, INVITE_PERMISSIONS } from '../botPermissions.js';
import { explainShortfalls, planShortfalls } from '../preflight.js';
import { serverToegestaan } from '../toegestaan.js';
import {
  magBeheren,
  buildAuthorizeUrl,
  buildGuildInviteUrl,
  clearedCookie,
  exchangeCode,
  isAllowed,
  readSessionCookie,
  sessionCookie,
  SessionStore,
  type Session,
} from '../auth.js';
import { backupGuild, leesBackupTekst, listBackups, readBackup, readBackupRaw } from '../backup.js';
import { ALLES, applyReset, countReset, describeReset, planReset, type ResetScope } from '../reset.js';
import { listVersions, readVersion, recordVersion } from '../history.js';
import { describeDiff, diffTemplates, summarizeDiff } from '../diff.js';
import { simulate, simulatableRoles } from '../simulate.js';
import { compare } from '../compare.js';
import { parseTemplate, type ServerTemplate } from '../types.js';
import { parseClanInstellingen, type ClanKeuze, type DiscordLid } from '../clan/rangen.js';
import {
  alGekoppeldAan,
  koppel,
  koppelingenVan,
  leesDossier,
  noteerRangen,
  ontkoppel,
  zetInstellingen,
  type ClanDossier,
} from '../clan/opslag.js';
import { bouwClanPlan, rolInfoVan, verzamelLeden, voerClanPlanUit } from '../clan/synchroniseren.js';
import { geldigeNaam, haalGroep, netteRang, zoekGroepen, type WomGroep } from '../clan/wiseoldman.js';
import { logger } from '../util/logger.js';

/**
 * Lokaal dashboard. Luistert bewust alleen op 127.0.0.1: het praat namens de bot
 * met Discord, dus het mag niet van buiten bereikbaar zijn. De token blijft aan
 * deze kant — de browser krijgt hem nooit te zien.
 */
export interface DashboardOptions {
  /** Discord-ids die sowieso binnen mogen (de eigenaar of het team van de applicatie). */
  applicationOwners?: string[];
  /** Eigen sessieopslag. Alleen de tests gebruiken dit, om er een sessie in te leggen. */
  sessions?: SessionStore;
}

export function createDashboard(client: Client<true>, options: DashboardOptions = {}): Server {
  const sessions = options.sessions ?? new SessionStore();
  const owners = options.applicationOwners ?? [];

  return createServer((request, response) => {
    handle(client, request, response, sessions, owners).catch((error: unknown) => {
      logger.error('Dashboard-verzoek mislukt', error);
      send(response, 500, { error: message(error) });
    });
  });
}

/** Inloggen staat aan zodra er een client secret is; buiten localhost is het verplicht. */
export const authEnabled = () => Boolean(config.clientSecret);

const redirectUri = () => `${config.dashboardUrl}/auth/callback`;

/** Wie er opsloeg, voor de versiegeschiedenis. Zonder inloggen weten we dat niet. */
function wie(session: Session | null): string | undefined {
  if (!session) return undefined;
  return session.user.globalName || session.user.username;
}

async function handle(
  client: Client<true>,
  request: IncomingMessage,
  response: ServerResponse,
  sessions: SessionStore,
  applicationOwners: string[],
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const segments = url.pathname.split('/').filter(Boolean);
  const method = request.method ?? 'GET';
  const session = sessions.get(readSessionCookie(request.headers.cookie));

  // --- Inloggen ------------------------------------------------------------
  if (segments[0] === 'auth') {
    return handleAuth(segments[1], url, request, response, sessions, applicationOwners, session);
  }

  if (method === 'GET' && segments.length === 0) return sendHtml(response);

  if (method === 'GET' && segments.length === 1 && /^[\w-]+\.js$/.test(segments[0] ?? '')) {
    return sendAsset(response, segments[0] as string);
  }

  // Het logo staat bewust voor de inlogpoort: het inlogscherm moet het kunnen tonen.
  if (method === 'GET' && url.pathname === '/logo.png') return sendLogo(response);

  if (segments[0] !== 'api') return send(response, 404, { error: 'Niet gevonden' });
  const [, resource, id, sub] = segments;

  // --- Wie ben ik? ---------------------------------------------------------
  // Deze route mag zonder sessie: de pagina moet kunnen vragen of je moet inloggen.
  if (method === 'GET' && resource === 'session') {
    return send(response, 200, {
      authEnabled: authEnabled(),
      authenticated: !authEnabled() || session !== null,
      user: session?.user ?? null,
      guilds: session ? describeOAuthGuilds(client, session) : [],
      // Het adres dat we naar Discord sturen. Staat dit niet letterlijk zo in
      // het Developer Portal, dan krijg je "Ongeldige OAuth2 redirect_uri" en
      // zie je nergens welk adres hij dan wel stuurde. Nu dus wel. Geheim is
      // het niet: het staat in elke inloglink.
      redirectUri: authEnabled() ? redirectUri() : null,
      // En bij welke applicatie dat adres moet staan. Discord kijkt per
      // applicatie; staat de redirect bij een andere app van jou, dan is de
      // melding precies dezelfde. Dit nummer hoort gelijk te zijn aan het
      // Application ID in het portal.
      clientId: config.clientId,
    });
  }

  if (authEnabled() && !session) {
    return send(response, 401, { error: 'Niet ingelogd.', login: '/auth/login' });
  }

  /**
   * Eén poort voor alle routes die een server aanwijzen. Twee vragen achter
   * elkaar: mag deze installatie aan die server komen (de lijst uit GUILD_IDS),
   * en is deze gebruiker daar zelf beheerder. Geeft de reden terug, want
   * "mag niet" zonder waarom laat je zoeken.
   */
  const weigering = (guildId: string): string | null => {
    if (!serverToegestaan(guildId, config.toegestaneServers)) {
      return 'Die server staat niet in de lijst met servers waar deze bot iets mag.';
    }
    if (!magBeheren(session, guildId)) return 'Je bent geen beheerder van die server.';
    return null;
  };

  const magHier = (guildId: string): boolean => weigering(guildId) === null;

  // --- Status -------------------------------------------------------------
  if (method === 'GET' && resource === 'state') {
    return send(response, 200, {
      botName: client.user.username,
      botId: client.user.id,
      avatarUrl: client.user.displayAvatarURL(),
      templatesDir: config.templatesDir,
      // Alleen de servers waar deze gebruiker zelf beheerder is. Dat de bot
      // ergens in zit maakt hem nog niet van jou.
      guilds: await Promise.all(
        [...client.guilds.cache.values()].filter((guild) => magHier(guild.id)).map(describeGuild),
      ),
      templates: await describeTemplates(),
      backups: (await listBackups(config.backupsDir)).filter((backup) => magHier(backup.guildId)),
      permissions: PERMISSION_CATALOGUE,
      onderdelen: ONDERDELEN.map((onderdeel) => ({ naam: onderdeel, uitleg: UITLEG[onderdeel] })),
      setups: (await readSetups(config.historyDir, 500)).filter((run) => magHier(run.guildId)).slice(0, 15),
      // Waar deze installatie op staat. Geen geheimen: de token en het client
      // secret komen hier niet in voor. Wel het inlogadres, want dat is precies
      // wat je nodig hebt als Discord "ongeldige redirect_uri" zegt.
      instellingen: {
        botNaam: client.user.username,
        clientId: config.clientId,
        host: config.dashboardHost,
        poort: config.dashboardPort,
        dashboardUrl: config.dashboardUrl,
        redirectUri: authEnabled() ? redirectUri() : null,
        inloggen: authEnabled(),
        demo: config.demo,
        toegestaneServers: config.toegestaneServers,
        mappen: {
          templates: config.templatesDir,
          backups: config.backupsDir,
          history: config.historyDir,
        },
        volume: process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || null,
        driftCheckUren: config.driftCheckUren,
        backupUren: config.backupUren,
        backupBewaar: config.backupBewaar,
        inviteUrl: config.clientId ? buildInviteUrl(config.clientId) : null,
      },
    });
  }

  /**
   * Klopt elke server nog met de template die er het laatst op ging?
   *
   * Vergelijken kon al, maar alleen als je er zelf naartoe ging: per template,
   * per server. Terwijl dat juist het getal is dat je wil zien zodra je het
   * dashboard opent. Apart van /state, want hiervoor moet van elke server een
   * verse momentopname worden opgehaald - dat hoeft niet bij elke verversing.
   */
  if (method === 'GET' && resource === 'drift') {
    const runs = await readSetups(config.historyDir, 500);
    const servers = [...client.guilds.cache.values()].filter((guild) => magHier(guild.id));

    // Zelfde antwoord als de controle die vanzelf loopt; die logica staat op
    // één plek, anders zeggen het scherm en het bericht in de server iets anders.
    const status = await Promise.all(
      servers.map((guild) => driftVanServer(guild, runs, config.templatesDir)),
    );

    return send(response, 200, { servers: status });
  }

  /**
   * Wie heeft er iets veranderd in deze server?
   *
   * "Drie verschillen met de template" zegt wat er anders is, niet hoe het zo
   * gekomen is. Dat staat in het auditlog van Discord, en daar kon de bot nog
   * niet bij kijken.
   */
  if (method === 'GET' && resource === 'wijzigingen' && id !== undefined) {
    const nee = weigering(id);
    if (nee) return send(response, 403, { error: nee });

    const guild = client.guilds.cache.get(id);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden.' });

    return send(response, 200, await recenteWijzigingen(guild, 15));
  }

  /**
   * Wat er in deze server is blijven liggen: stille kanalen, rollen die niemand
   * heeft, uitnodigingen die nooit verlopen, webhooks. Alleen kijken.
   */
  if (method === 'GET' && resource === 'opruimen' && id !== undefined) {
    const nee = weigering(id);
    if (nee) return send(response, 403, { error: nee });

    const guild = client.guilds.cache.get(id);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden.' });

    return send(response, 200, await opruimlijst(guild));
  }

  /**
   * Uitrollen op een tijdstip. Dertig kanalen aanmaken terwijl iedereen online
   * is hoeft niet; de bot werkt 's nachts net zo hard.
   */
  if (resource === 'gepland') {
    const lijst = await leesGepland(config.historyDir);

    if (method === 'GET') {
      return send(response, 200, {
        gepland: lijst
          .filter((uitrol) => uitrol.guildIds.every(magHier))
          .sort((a, b) => a.wanneer.localeCompare(b.wanneer)),
      });
    }

    if (method === 'POST') {
      const body = await readJson<{
        wanneer?: string;
        templateId?: string;
        guildIds?: string[];
        prune?: boolean;
        update?: boolean;
        onderdelen?: string[];
        variabelen?: Record<string, string>;
      }>(request);

      const guildIds = body.guildIds ?? [];
      if (!body.templateId || guildIds.length === 0) {
        return send(response, 400, { error: 'Kies een template en minstens een server.' });
      }

      const redenen = [...new Set(guildIds.map((guildId) => weigering(guildId)).filter(Boolean))];
      if (redenen.length > 0) return send(response, 403, { error: redenen.join(' ') });

      const wanneer = new Date(body.wanneer ?? '');
      if (Number.isNaN(wanneer.getTime())) return send(response, 400, { error: 'Geef een geldig tijdstip op.' });
      if (wanneer.getTime() < Date.now()) return send(response, 400, { error: 'Dat tijdstip is al geweest.' });

      const onderdelen = leesOnderdelen(body.onderdelen?.join(','));
      if (!onderdelen) return send(response, 400, { error: `Onbekend onderdeel. Kies uit: ${ONDERDELEN.join(', ')}.` });

      // Nu al controleren of de template te laden is, met deze variabelen. Een
      // fout om drie uur 's nachts ziet niemand.
      try {
        await loadTemplateMet(config.templatesDir, body.templateId, body.variabelen ?? {});
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }

      const uitrol = nieuweUitrol({
        wanneer: wanneer.toISOString(),
        templateId: body.templateId,
        guildIds,
        guildNamen: guildIds.map((guildId) => client.guilds.cache.get(guildId)?.name ?? guildId),
        prune: body.prune ?? false,
        update: body.update ?? true,
        onderdelen,
        variabelen: body.variabelen ?? {},
        door: wie(session) ?? 'dashboard',
      });

      await schrijfGepland(config.historyDir, [...lijst, uitrol]);
      logger.info(`Gepland: "${uitrol.templateId}" op ${uitrol.guildNamen.join(', ')} om ${uitrol.wanneer}`);
      return send(response, 200, { uitrol });
    }

    if (method === 'DELETE' && id !== undefined) {
      const uitrol = lijst.find((kandidaat) => kandidaat.id === id);
      if (!uitrol) return send(response, 404, { error: 'Die geplande uitrol staat er niet (meer).' });

      const redenen = [...new Set(uitrol.guildIds.map((guildId) => weigering(guildId)).filter(Boolean))];
      if (redenen.length > 0) return send(response, 403, { error: redenen.join(' ') });

      await schrijfGepland(config.historyDir, lijst.filter((kandidaat) => kandidaat.id !== id));
      return send(response, 200, { geannuleerd: id });
    }
  }

  if (method === 'GET' && resource === 'setups') {
    // Eerst zeven, dan afkappen. Andersom zie je een lege lijst zodra de laatste
    // regels toevallig van servers van iemand anders waren.
    const eigen = (await readSetups(config.historyDir, 500)).filter((run) => magHier(run.guildId));
    return send(response, 200, { setups: eigen.slice(0, 25) });
  }

  /**
   * Een discord.new-link als beginpunt.
   *
   * Discord heeft zijn eigen templates: een link waarmee je een kopie van een
   * server maakt. Die kun je hier niet bewerken en niet uitrollen op een server
   * die al bestaat - maar als startpunt is het prima.
   */
  if (method === 'POST' && resource === 'importeren') {
    const body = await readJson<{ link?: string; id?: string }>(request);
    const code = templateCode(body.link ?? '');
    if (!code) return send(response, 400, { error: 'Dat lijkt geen discord.new-link.' });

    try {
      const bron = await client.fetchGuildTemplate(code);
      const naam = slug(body.id ?? bron.name) || 'geimporteerd';
      const template = uitDiscordTemplate(bron.serializedGuild, bron.name);

      const bestaat = await readFile(templatePath(naam), 'utf8').catch(() => null);
      if (bestaat) return send(response, 409, { error: `Er is al een template "${naam}".` });

      await writeTemplate(naam, template);
      logger.info(`Dashboard importeerde discord.new/${code} als "${naam}"`);
      return send(response, 200, { id: naam, json: JSON.stringify(template, null, 2) });
    } catch (error) {
      // Een code die niet bestaat geeft een 404 van Discord; dat is geen
      // serverfout van ons, maar een verkeerde link.
      return send(response, 400, { error: `Kon deze template niet ophalen: ${message(error)}` });
    }
  }

  // --- Templates ----------------------------------------------------------
  if (resource === 'templates' && id === undefined) {
    if (method === 'GET') return send(response, 200, { templates: await describeTemplates() });

    if (method === 'POST') {
      const body = await readJson<{ id?: string; from?: string }>(request);
      const newId = slug(body.id ?? '');
      if (!newId) return send(response, 400, { error: 'Geef een naam op (letters, cijfers, streepjes).' });
      if ((await listTemplateIds(config.templatesDir)).includes(newId)) {
        return send(response, 400, { error: `"${newId}" bestaat al.` });
      }

      const source: ServerTemplate = body.from
        ? {
            ...(await loadTemplateMet(config.templatesDir, body.from, {}, { losjes: true })).template,
            name: newId,
          }
        : {
            name: newId,
            description: '',
            variables: {},
            guild: {},
            roles: [],
            categories: [],
            uncategorizedChannels: [],
            emojis: [],
            automod: [],
          };

      await writeTemplate(newId, source);
      return send(response, 200, { id: newId, json: JSON.stringify(source, null, 2) });
    }
  }

  if (resource === 'templates' && id !== undefined) {
    if (method === 'GET' && sub === 'versions') {
      return send(response, 200, { versions: await describeVersions(id) });
    }

    // Eén versie ophalen, om te downloaden of naast de huidige te leggen.
    if (method === 'GET' && sub === 'version') {
      const stamp = url.searchParams.get('stamp');
      if (!stamp) return send(response, 400, { error: 'Geef een versie op.' });
      return send(response, 200, { stamp, json: await readVersion(config.historyDir, id, stamp) });
    }

    if (method === 'GET' && sub === undefined) {
      const json = await readFile(templatePath(id), 'utf8');
      return send(response, 200, { id, json, template: parseTemplate(JSON.parse(json)) });
    }

    if (method === 'PUT') {
      const body = await readJson<{ json?: string }>(request);
      try {
        const template = parseTemplate(JSON.parse(body.json ?? ''));
        // Eerst de oude inhoud bewaren, dan pas overschrijven.
        const previous = await readFile(templatePath(id), 'utf8').catch(() => null);
        if (previous) await recordVersion(config.historyDir, id, previous, wie(session));
        await writeTemplate(id, template);
        return send(response, 200, { id, template, saved: true });
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }
    }

    if (method === 'DELETE') {
      await unlink(templatePath(id));
      return send(response, 200, { deleted: id });
    }
  }

  /**
   * De andere kant op: neem over wat er in de server staat.
   *
   * Tot nu toe kon je alleen de template naar de server duwen. Maar vaak is de
   * afwijking juist bedoeld - iemand heeft een kanaal toegevoegd dat er hoort te
   * zijn. Dan wil je dat in de template hebben zonder met de hand JSON bij te
   * werken.
   *
   * Zonder `toepassen` is dit een preview: je krijgt te zien wat er in de
   * template zou veranderen, en pas daarna gebeurt er iets.
   */
  if (method === 'POST' && resource === 'templates' && id !== undefined && sub === 'overnemen') {
    const body = await readJson<{ guildId?: string; toepassen?: boolean }>(request);
    if (!body.guildId) return send(response, 400, { error: 'Kies een server om over te nemen.' });

    const nee = weigering(body.guildId);
    if (nee) return send(response, 403, { error: nee });

    const guild = client.guilds.cache.get(body.guildId);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden.' });

    const huidigJson = await readFile(templatePath(id), 'utf8').catch(() => null);
    if (huidigJson === null) return send(response, 404, { error: 'Template niet gevonden.' });

    try {
      const huidig = parseTemplate(JSON.parse(huidigJson));
      const uitServer = await exportGuildFresh(guild, huidig.name);

      // Wat van de template is en niet van de server: de naam, de uitleg, de
      // variabelen en de plaatjes - een pad of URL naar een icoon is niet uit
      // een server te lezen.
      const nieuw = parseTemplate({
        ...uitServer,
        name: huidig.name,
        description: huidig.description,
        variables: huidig.variables,
        guild: { ...uitServer.guild, icon: huidig.guild.icon, banner: huidig.guild.banner },
      });

      const verschil = diffTemplates(huidig, nieuw);
      const waarschuwingen = Object.keys(huidig.variables).length
        ? [
            'Deze template gebruikt variabelen. In de server staan de ingevulde waarden, dus die ' +
              'komen er letterlijk in te staan - de variabelen zelf verdwijnen.',
          ]
        : [];

      if (!body.toepassen) {
        return send(response, 200, {
          id,
          samenvatting: summarizeDiff(verschil),
          regels: describeDiff(verschil),
          waarschuwingen,
          json: JSON.stringify(nieuw, null, 2),
        });
      }

      // De oude versie bewaren, zodat dit met één klik terug te draaien is.
      await recordVersion(config.historyDir, id, huidigJson, wie(session));
      await writeTemplate(id, nieuw);

      logger.info(`Dashboard neemt "${guild.name}" over in template "${id}" (${summarizeDiff(verschil)})`);
      return send(response, 200, {
        id,
        saved: true,
        samenvatting: summarizeDiff(verschil),
        regels: describeDiff(verschil),
        waarschuwingen,
        json: JSON.stringify(nieuw, null, 2),
      });
    } catch (error) {
      return send(response, 400, { error: message(error) });
    }
  }

  if (method === 'POST' && resource === 'templates' && id !== undefined && sub === 'restore') {
    const body = await readJson<{ stamp?: string }>(request);
    if (!body.stamp) return send(response, 400, { error: 'Geef een versie op.' });

    const contents = await readVersion(config.historyDir, id, body.stamp);
    const template = parseTemplate(JSON.parse(contents));

    const current = await readFile(templatePath(id), 'utf8').catch(() => null);
    if (current) await recordVersion(config.historyDir, id, current, wie(session));
    await writeTemplate(id, template);

    return send(response, 200, { id, json: JSON.stringify(template, null, 2), restored: body.stamp });
  }

  // --- Back-ups ------------------------------------------------------------
  if (resource === 'backups') {
    if (method === 'GET' && id === undefined) {
      return send(response, 200, {
        backups: (await listBackups(config.backupsDir)).filter((backup) => magHier(backup.guildId)),
      });
    }

    // Downloaden. Zonder dit staat je momentopname op een schijf waar je niet
    // bij kunt, en op een hostingpartij zonder volume is hij na de volgende
    // deploy weg.
    if (method === 'GET' && id !== undefined) {
      let ruw: string;
      try {
        ruw = await readBackupRaw(config.backupsDir, id);
      } catch {
        return send(response, 404, { error: 'Back-up niet gevonden.' });
      }

      const nee = weigering(leesBackupTekst(ruw).guildId);
      if (nee) return send(response, 403, { error: nee });

      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${id}"`,
      });
      response.end(ruw);
      return;
    }

    if (method === 'POST' && id === 'restore') {
      const body = await readJson<{ file?: string; inhoud?: string; guildId?: string; volledig?: boolean }>(request);
      if (!body.file && !body.inhoud) return send(response, 400, { error: 'Geef een back-up op.' });

      // Uit een bestand dat je zelf meestuurt, of uit een die hier al staat.
      let backup;
      try {
        backup = body.inhoud
          ? leesBackupTekst(body.inhoud)
          : await readBackup(config.backupsDir, body.file as string);
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }

      const doelId = body.guildId || backup.guildId;

      // Twee keer kijken: de back-up zelf is een afdruk van een server, dus die
      // mag je niet openen van een server die niet van jou is. En je mag hem
      // ook niet uitrollen op een server waar je niets te zeggen hebt.
      const nee = weigering(backup.guildId) ?? weigering(doelId);
      if (nee) return send(response, 403, { error: nee });

      const guild = client.guilds.cache.get(doelId);
      if (!guild) return send(response, 404, { error: 'Server niet gevonden.' });
      if (config.demo) {
        return send(response, 200, { applied: 0, failed: 0, errors: [], note: 'demo-modus — er is niets teruggezet' });
      }

      /**
       * Aanvullen of echt terugzetten.
       *
       * Aanvullen zet terug wat er in de back-up staat en laat de rest met rust;
       * dat is veilig, maar de server is daarna niet gelijk aan de back-up. Met
       * `volledig` gaat weg wat er niet in stond - dan is "terugzetten" ook echt
       * terugzetten. Berichten komen daarmee niet terug: een back-up bewaart de
       * structuur, niet wat erin gezegd is.
       */
      const volledig = body.volledig === true;
      const plan = planSetup(await snapshotGuildFresh(guild), backup.template, { prune: volledig, update: true });
      if (plan.actions.length === 0) return send(response, 200, { applied: 0, failed: 0, errors: [], note: 'Niets te herstellen.' });

      // Voor een volledige terugzet eerst een momentopname van hoe het nu staat.
      // Je gooit hier dingen weg; dan hoort er een weg terug te zijn.
      const vooraf = volledig
        ? await backupGuild(guild, config.backupsDir, 'voor-terugzetten').catch(() => null)
        : null;

      logger.info(
        `Dashboard herstelt "${body.file}" op "${guild.name}" (${plan.actions.length} acties` +
          `${volledig ? ', volledig' : ''})`,
      );
      const result = await applyPlan(guild, backup.template, plan);

      // Terugzetten vult aan maar verwijdert niets, dus de server kan na afloop
      // nog steeds afwijken. Dat hoort de gebruiker te zien, niet te vermoeden.
      const rest = compare(await snapshotGuildFresh(guild), backup.template);
      return send(response, 200, {
        ...result,
        volledig,
        backup: vooraf,
        leftover: rest.counts.extra,
        mismatch: rest.counts['type-mismatch'],
      });
    }
  }

  // --- Leeghalen ----------------------------------------------------------
  // Het enige wat hier weggooit. Zonder bevestiging is het een preview; met
  // bevestiging moet de servernaam exact kloppen, precies als op de
  // commandoregel. Er gaat altijd eerst een momentopname naar schijf.
  if (method === 'POST' && resource === 'reset') {
    const body = await readJson<{
      guildId?: string;
      bevestig?: string;
      backup?: boolean;
      scope?: { rollen?: boolean; kanalen?: boolean; automod?: boolean; behoudRollen?: string[] };
    }>(request);

    if (!body.guildId) return send(response, 400, { error: 'Kies een server.' });
    const nee = weigering(body.guildId);
    if (nee) return send(response, 403, { error: nee });

    const guild = client.guilds.cache.get(body.guildId);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden.' });

    const scope: ResetScope = {
      ...ALLES,
      roles: body.scope?.rollen !== false,
      channels: body.scope?.kanalen !== false,
      automod: body.scope?.automod !== false,
      behoudRollen: (body.scope?.behoudRollen ?? []).map((naam) => naam.trim()).filter(Boolean),
    };

    if (!scope.roles && !scope.channels && !scope.automod) {
      return send(response, 400, { error: 'Er is niets aangevinkt om weg te halen.' });
    }

    const me = await guild.members.fetchMe();
    const plan = planReset(await snapshotGuildFresh(guild), me.roles.highest.position, scope);
    const totaal = countReset(plan);

    // Preview: alleen laten zien wat er zou verdwijnen.
    if (typeof body.bevestig !== 'string') {
      return send(response, 200, {
        guildName: guild.name,
        counts: { kanalen: plan.channels.length, rollen: plan.roles.length, automod: plan.automod.length },
        totaal,
        acties: describeReset(plan),
        overgeslagen: plan.skipped,
      });
    }

    if (body.bevestig.trim() !== guild.name) {
      return send(response, 400, { error: `De bevestiging klopt niet. Typ de servernaam exact over: "${guild.name}"` });
    }

    if (totaal === 0) return send(response, 200, { deleted: 0, failed: 0, errors: [], note: 'Er valt niets te verwijderen.' });

    if (config.demo) {
      return send(response, 200, { deleted: 0, failed: 0, errors: [], note: 'demo-modus — er is niets verwijderd' });
    }

    const missing = missingPermissions(me);
    if (missing.length > 0) {
      return send(response, 400, { error: `De bot mist rechten in deze server: ${missing.join(', ')}` });
    }

    // Dit is onomkeerbaar, dus de momentopname gaat eraan vooraf en niet erna.
    let backup: string | null = null;
    if (body.backup !== false) backup = await backupGuild(guild, config.backupsDir, 'voor-leeghalen');

    logger.warn(`Dashboard haalt "${guild.name}" leeg (${totaal} onderdelen)`);
    const result = await applyReset(guild, plan, `Leeggehaald via het dashboard door ${wie(session) ?? 'onbekend'}`);

    await logSetup(config.historyDir, {
      at: new Date().toISOString(),
      guildId: guild.id,
      guildName: guild.name,
      template: '(leeghalen)',
      door: wie(session) ?? 'dashboard',
      mode: 'apply',
      onderdelen: [scope.roles && 'rollen', scope.channels && 'kanalen', scope.automod && 'automod'].filter(
        Boolean,
      ) as string[],
      applied: result.deleted,
      failed: result.failed,
      backup,
      notes: result.errors.slice(0, 5),
    });

    return send(response, 200, { ...result, backup });
  }

  // --- Controle en simulatie ---------------------------------------------
  // Werkt op de JSON uit de editor, dus je kunt controleren voor je opslaat.
  if (method === 'POST' && resource === 'analyze') {
    const body = await readJson<{ json?: string; role?: string }>(request);
    try {
      const template = parseTemplate(JSON.parse(body.json ?? ''));
      const roles = simulatableRoles(template);
      const role = roles.find((candidate) => candidate.key === body.role) ?? roles[0];
      const findings = lintTemplate(template);

      return send(response, 200, {
        findings,
        counts: countBySeverity(findings),
        summary: auditSummary(template),
        roles,
        simulation: role ? simulate(template, role.key) : null,
      });
    } catch (error) {
      return send(response, 400, { error: message(error) });
    }
  }

  // --- Template naast de echte server ------------------------------------
  if (method === 'POST' && resource === 'compare') {
    const body = await readJson<{ json?: string; guildId?: string }>(request);
    const nee = body.guildId ? weigering(body.guildId) : null;
    if (nee) return send(response, 403, { error: nee });

    const guild = body.guildId ? client.guilds.cache.get(body.guildId) : undefined;
    if (!guild) return send(response, 404, { error: 'Kies een server om mee te vergelijken.' });

    try {
      const template = parseTemplate(JSON.parse(body.json ?? ''));
      return send(response, 200, compare(await snapshotGuildFresh(guild), template));
    } catch (error) {
      return send(response, 400, { error: message(error) });
    }
  }

  // --- Plannen en toepassen ----------------------------------------------
  if (method === 'POST' && (resource === 'plan' || resource === 'apply')) {
    const body = await readJson<{
      templateId?: string;
      guildId?: string;
      guildIds?: string[];
      prune?: boolean;
      update?: boolean;
      backup?: boolean;
      onderdelen?: string[];
      variabelen?: Record<string, string>;
    }>(request);

    const guildIds = body.guildIds?.length ? body.guildIds : body.guildId ? [body.guildId] : [];
    if (!body.templateId || guildIds.length === 0) {
      return send(response, 400, { error: 'Kies een template en minstens een server.' });
    }

    // Eén server die niet mag en er gebeurt niets — ook niet met de rest. Stil
    // overslaan zou erger zijn: dan denk je dat het gelukt is.
    const redenen = [...new Set(guildIds.map((guildId) => weigering(guildId)).filter(Boolean))];
    if (redenen.length > 0) return send(response, 403, { error: redenen.join(' ') });

    let geladen;
    try {
      geladen = await loadTemplateMet(config.templatesDir, body.templateId, body.variabelen ?? {});
    } catch (error) {
      // Een ontbrekende waarde is geen serverfout maar iets wat de gebruiker
      // moet invullen; met een 400 laat het dashboard de melding netjes zien.
      return send(response, 400, { error: message(error) });
    }

    const template = geladen.template;
    const options = { prune: body.prune ?? false, update: body.update ?? true };

    // Een lege lijst is niet hetzelfde als "geen keuze gemaakt". Wie alles
    // uitvinkt bedoelt niet "doe dan maar alles".
    if (Array.isArray(body.onderdelen) && body.onderdelen.length === 0) {
      return send(response, 400, { error: 'Er is geen enkel onderdeel aangevinkt — er valt zo niets te doen.' });
    }

    const onderdelen = leesOnderdelen(body.onderdelen?.join(','));
    if (!onderdelen) {
      return send(response, 400, { error: `Onbekend onderdeel. Kies uit: ${ONDERDELEN.join(', ')}.` });
    }

    if (resource === 'plan') {
      const plans = [];
      for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        const plan = filterPlan(planSetup(await snapshotGuildFresh(guild), template, options), onderdelen);
        const me = await guild.members.fetchMe();
        const tekort = planShortfalls(plan, me.permissions);
        const haalbaar = maakHaalbaar(plan, me.permissions, {
          alCommunity: guild.features.includes('COMMUNITY'),
        });

        plans.push({
          guildId,
          guildName: guild.name,
          summary: summarizePlan(haalbaar.plan),
          actions: describeActions(haalbaar.plan, 1000),
          regels: planRegels(haalbaar.plan),
          // Wat er is bijgesteld hoort bij het plan: dat wil je zien voordat je
          // op uitrollen drukt, niet pas in de foutenlijst erna.
          warnings: [...haalbaar.plan.warnings, ...haalbaar.aanpassingen],
          shortfalls: tekort,
          count: haalbaar.plan.actions.length,
        });
      }
      if (plans.length === 0) return send(response, 404, { error: 'Geen van de servers is gevonden.' });
      return send(response, 200, { plans, ...plans[0] });
    }

    if (config.demo) {
      return send(response, 200, {
        results: guildIds.map((guildId) => ({
          guildId,
          guildName: client.guilds.cache.get(guildId)?.name ?? guildId,
          applied: 0,
          failed: 0,
          errors: [],
          note: 'demo-modus — er is geen bot verbonden, dus er is niets gewijzigd',
        })),
        applied: 0,
        failed: 0,
        errors: [],
      });
    }

    // Dezelfde volgorde als een geplande uitrol: momentopname, plan, bijstellen
    // naar wat de bot mag, uitvoeren, logboek, bericht in de server.
    const results = [];
    for (const guildId of guildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        results.push({ guildId, guildName: guildId, applied: 0, failed: 0, errors: ['server niet gevonden'] });
        continue;
      }

      results.push(
        await rolUit(guild, template, {
          templateId: body.templateId,
          onderdelen,
          prune: options.prune,
          update: options.update,
          door: session?.user.globalName || session?.user.username || 'dashboard',
          backupsDir: config.backupsDir,
          historyDir: config.historyDir,
          backup: body.backup,
        }),
      );
    }

    return send(response, 200, {
      results,
      applied: results.reduce((sum, result) => sum + result.applied, 0),
      failed: results.reduce((sum, result) => sum + result.failed, 0),
      errors: results.flatMap((result) => result.errors.map((error) => `${result.guildName}: ${error}`)),
    });
  }


  // --- Clanrangen ----------------------------------------------------------
  // De tweede tak van deze bot: welke OSRS-clans meetellen, welke rol bij welke
  // rang hoort, en wie is wie. Alles hangt aan een server, dus alles gaat door
  // dezelfde poort als de rest.
  if (resource === 'clan' && id !== undefined) {
    const nee = weigering(id);
    if (nee) return send(response, 403, { error: nee });

    const guild = client.guilds.cache.get(id);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden.' });

    const dossier = await leesDossier(config.clanDir, id);
    const me = await guild.members.fetchMe();
    const rollen = [...rolInfoVan(guild, me).values()].sort((a, b) => a.naam.localeCompare(b.naam));

    if (method === 'GET' && sub === undefined) {
      return send(response, 200, {
        guildId: id,
        guildName: guild.name,
        instellingen: dossier.instellingen,
        laatsteSync: dossier.laatsteSync,
        rollen,
        // Per gekozen clan: de rangen die daar in gebruik zijn. Die lijst komt
        // uit de ledenlijst zelf — een OSRS-clan bepaalt zijn eigen rangen, dus
        // een vaste lijst zou voor de helft niet kloppen.
        clans: await Promise.all(dossier.instellingen.clans.map(beschrijfClan)),
        koppelingen: await beschrijfKoppelingen(guild, dossier),
        // Kanalen waar het welkomstbericht in kan. Alleen tekstkanalen, en
        // alleen die waar de bot ook echt mag praten.
        kanalen: tekstkanalen(guild, me),
        magRollen: me.permissions.has(PermissionFlagsBits.ManageRoles),
        magBijnamen: me.permissions.has(PermissionFlagsBits.ManageNicknames),
        // Zonder de Server Members Intent hoort de bot niemand binnenkomen, en
        // blijft het welkomstbericht dus uit. Dat hoort op het scherm te staan
        // en niet alleen in een logregel die niemand openslaat. null = niet te
        // zien (demo, of een nagemaakte client): dan zeggen we er niets over.
        ledenIntent: client.options?.intents?.has(GatewayIntentBits.GuildMembers) ?? null,
        demo: config.demo,
      });
    }

    if (method === 'PUT' && sub === undefined) {
      const body = await readJson<{ instellingen?: unknown }>(request);
      try {
        const instellingen = parseClanInstellingen(body.instellingen ?? {});
        await zetInstellingen(config.clanDir, id, instellingen);
        return send(response, 200, { instellingen, saved: true });
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }
    }

    // Een clan zoeken op naam, zodat niemand een groepsnummer hoeft op te zoeken.
    if (method === 'POST' && sub === 'zoek') {
      const body = await readJson<{ naam?: string }>(request);
      try {
        return send(response, 200, { gevonden: await zoekGroepen(body.naam ?? '') });
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }
    }

    // Een clan laten meetellen. We halen hem meteen op: zo weten we zeker dat
    // het nummer bestaat, en staat de naam er goed in.
    if (method === 'POST' && sub === 'toevoegen') {
      const body = await readJson<{ groupId?: number }>(request);
      const groupId = Number(body.groupId);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        return send(response, 400, { error: 'Kies een clan uit de zoeklijst.' });
      }
      if (dossier.instellingen.clans.some((clan) => clan.groupId === groupId)) {
        return send(response, 400, { error: 'Die clan telt al mee.' });
      }

      try {
        const groep = await haalGroep(groupId);
        const instellingen = parseClanInstellingen({
          ...dossier.instellingen,
          clans: [...dossier.instellingen.clans, { groupId, naam: groep.naam, lidRol: null, rangRollen: {} }],
        });

        await zetInstellingen(config.clanDir, id, instellingen);
        return send(response, 200, {
          instellingen,
          clans: await Promise.all(instellingen.clans.map(beschrijfClan)),
        });
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }
    }

    if (method === 'POST' && sub === 'verwijderen') {
      const body = await readJson<{ groupId?: number }>(request);
      const instellingen = parseClanInstellingen({
        ...dossier.instellingen,
        clans: dossier.instellingen.clans.filter((clan) => clan.groupId !== Number(body.groupId)),
      });

      await zetInstellingen(config.clanDir, id, instellingen);
      return send(response, 200, {
        instellingen,
        clans: await Promise.all(instellingen.clans.map(beschrijfClan)),
      });
    }

    // De ledenlijst opnieuw ophalen, los van alle Discord-rollen.
    if (method === 'POST' && sub === 'leden') {
      const body = await readJson<{ groupId?: number }>(request);
      const clan = dossier.instellingen.clans.find((kandidaat) => kandidaat.groupId === Number(body.groupId));
      if (!clan) return send(response, 400, { error: 'Die clan telt hier niet mee.' });

      try {
        await haalGroep(clan.groupId, { vers: true });
        return send(response, 200, { clan: await beschrijfClan(clan) });
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }
    }

    if (method === 'POST' && (sub === 'plan' || sub === 'sync')) {
      const body = await readJson<{ vers?: boolean }>(request);

      let uitkomst;
      try {
        uitkomst = await bouwClanPlan(guild, dossier, { vers: body.vers === true });
      } catch (error) {
        return send(response, 400, { error: message(error) });
      }

      const { plan, groepen } = uitkomst;

      if (sub === 'plan') {
        return send(response, 200, { plan, groepen: groepen.map(samenvatting) });
      }

      if (config.demo) {
        return send(response, 200, {
          plan,
          groepen: groepen.map(samenvatting),
          aangepast: 0,
          mislukt: 0,
          fouten: [],
          note: 'demo-modus — er is geen bot verbonden, dus er zijn geen rollen gewijzigd',
        });
      }

      logger.info(`Dashboard werkt clanrangen bij in "${guild.name}" (${plan.wissels.length} leden)`);
      const resultaat = await voerClanPlanUit(
        guild,
        plan,
        `Clanrangen bijgewerkt via het dashboard door ${wie(session) ?? 'onbekend'}`,
      );

      await noteerRangen(
        config.clanDir,
        id,
        plan.wissels.map((w) => ({ discordId: w.discordId, gevonden: w.gevonden, rsn: w.rsn })),
      );

      return send(response, 200, { plan, groepen: groepen.map(samenvatting), ...resultaat });
    }

    if (method === 'POST' && sub === 'koppel') {
      const body = await readJson<{ discordId?: string; rsn?: string }>(request);
      const discordId = (body.discordId ?? '').trim();
      const rsn = (body.rsn ?? '').trim();

      if (!/^\d{1,25}$/.test(discordId)) return send(response, 400, { error: 'Dat is geen Discord-gebruikers-id: alleen cijfers.' });
      if (!geldigeNaam(rsn)) return send(response, 400, { error: `"${rsn}" kan geen OSRS-naam zijn.` });

      const bezet = alGekoppeldAan(dossier, rsn, discordId);
      if (bezet) return send(response, 400, { error: `"${rsn}" staat al gekoppeld aan ${bezet}.` });

      const bijgewerkt = await koppel(config.clanDir, id, discordId, rsn, wie(session) ?? 'dashboard');
      return send(response, 200, { koppelingen: await beschrijfKoppelingen(guild, bijgewerkt) });
    }

    if (method === 'POST' && sub === 'ontkoppel') {
      const body = await readJson<{ discordId?: string }>(request);
      if (!body.discordId) return send(response, 400, { error: 'Geef op wie je wilt ontkoppelen.' });

      await ontkoppel(config.clanDir, id, body.discordId);
      const bijgewerkt = await leesDossier(config.clanDir, id);
      return send(response, 200, { koppelingen: await beschrijfKoppelingen(guild, bijgewerkt) });
    }

    // Rollen aanmaken: de rol voor de clan zelf, of de rangen die er nog geen
    // hebben. Met de hand acht rollen aanmaken is precies het werk dat deze bot
    // afneemt.
    if (method === 'POST' && sub === 'rol') {
      const body = await readJson<{ groupId?: number }>(request);
      const clan = dossier.instellingen.clans.find((kandidaat) => kandidaat.groupId === Number(body.groupId));
      if (!clan) return send(response, 400, { error: 'Die clan telt hier niet mee.' });

      if (config.demo) {
        return send(response, 200, { note: 'demo-modus — er is geen rol aangemaakt' });
      }
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return send(response, 400, { error: 'De bot mist het recht "Rollen beheren".' });
      }

      // De rol heet naar de clan. Staat er al een rol met die naam, dan pakken
      // we die in plaats van er een tweede naast te zetten.
      const naam = (clan.naam || `clan ${clan.groupId}`).slice(0, 100);
      const bestaand = guild.roles.cache.find((rol) => rol.name.toLowerCase() === naam.toLowerCase());

      let rol;
      try {
        rol = bestaand ?? (await guild.roles.create({ name: naam, reason: 'Clanrol via het dashboard' }));
      } catch (error) {
        return send(response, 400, { error: `"${naam}" aanmaken lukte niet: ${message(error)}` });
      }

      const instellingen = parseClanInstellingen({
        ...dossier.instellingen,
        clans: dossier.instellingen.clans.map((kandidaat) =>
          kandidaat.groupId === clan.groupId ? { ...kandidaat, lidRol: rol.id } : kandidaat,
        ),
      });

      await zetInstellingen(config.clanDir, id, instellingen);
      return send(response, 200, { naam, bestond: Boolean(bestaand), instellingen });
    }
  }

  // --- Bestaande server exporteren ---------------------------------------
  if (method === 'GET' && resource === 'export' && id !== undefined) {
    const nee = weigering(id);
    if (nee) return send(response, 403, { error: nee });

    const guild = client.guilds.cache.get(id);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden' });
    const template = await exportGuildFresh(guild);
    return send(response, 200, { id: slug(guild.name), json: JSON.stringify(template, null, 2) });
  }

  send(response, 404, { error: 'Niet gevonden' });
}

// --- Helpers --------------------------------------------------------------

/**
 * De koppelingen met erbij hoe iemand in Discord heet. Lukt dat ophalen niet
 * (geen bot verbonden, of het lid is weg), dan blijft de OSRS-naam staan —
 * een lijst zonder namen is nog altijd beter dan een lege lijst.
 */
async function beschrijfKoppelingen(guild: Guild, dossier: ClanDossier) {
  const koppelingen = koppelingenVan(dossier);
  if (koppelingen.length === 0) return [];

  const leden = await verzamelLeden(
    guild,
    koppelingen.map((koppeling) => koppeling.discordId),
  ).catch(() => new Map<string, DiscordLid>());

  return koppelingen.map((koppeling) => {
    const gegevens = dossier.koppelingen[koppeling.discordId];
    const lid = leden.get(koppeling.discordId);
    return {
      discordId: koppeling.discordId,
      rsn: koppeling.rsn,
      // Waar dit lid voor het laatst gezien is, met de rang netjes geschreven.
      gezien: (gegevens?.gezien ?? []).map((plek) => ({ ...plek, rangNaam: netteRang(plek.rang) })),
      gezienOp: gegevens?.gezienOp ?? null,
      door: gegevens?.door ?? '',
      weergavenaam: lid ? lid.bijnaam || lid.naam : null,
      inServer: Boolean(lid),
    };
  });
}

/**
 * De tekstkanalen waar de bot mag praten, voor de keuze van het welkomstkanaal.
 * In de demo bestaan die rechten niet; daar tellen alle tekstkanalen mee.
 */
function tekstkanalen(guild: Guild, me: GuildMember) {
  return [...guild.channels.cache.values()]
    .filter((kanaal): kanaal is TextChannel => kanaal.type === ChannelType.GuildText)
    .filter((kanaal) => {
      if (typeof kanaal.permissionsFor !== 'function') return true;
      return Boolean(
        kanaal.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
      );
    })
    .map((kanaal) => ({ id: kanaal.id, naam: kanaal.name }))
    .sort((a, b) => a.naam.localeCompare(b.naam));
}

/** De ledenlijst zonder de honderden regels zelf — die hoeft de pagina niet. */
function samenvatting(groep: WomGroep) {
  return { groupId: groep.id, naam: groep.naam, aantal: groep.leden.length, opgehaaldOp: groep.opgehaaldOp };
}

/**
 * Eén gekozen clan zoals het scherm hem wil hebben. De rangen staan erbij als
 * informatie — hoeveel leden er op elke rang staan — maar er valt niets aan te
 * koppelen: een rang uitdelen blijft mensenwerk. Lukt het ophalen niet, dan komt
 * dat als `fout` terug in plaats van dat het hele scherm leeg blijft.
 */
async function beschrijfClan(clan: ClanKeuze) {
  const basis = {
    ...clan,
    aantal: 0,
    rangen: [] as Array<{ rang: string; naam: string; aantal: number }>,
    fout: null as string | null,
  };

  try {
    const groep = await haalGroep(clan.groupId);
    const telling = new Map<string, number>();
    for (const lid of groep.leden) telling.set(lid.rang, (telling.get(lid.rang) ?? 0) + 1);

    return {
      ...basis,
      naam: groep.naam || clan.naam,
      aantal: groep.leden.length,
      rangen: [...telling.entries()]
        .map(([rang, aantal]) => ({ rang, naam: netteRang(rang), aantal }))
        .sort((a, b) => b.aantal - a.aantal || a.naam.localeCompare(b.naam)),
    };
  } catch (error) {
    return { ...basis, fout: message(error) };
  }
}


/**
 * De versielijst met per regel wat die opslag veranderde. Een versie bevat de
 * inhoud van vlak voor het opslaan, dus het verschil met de eerstvolgende
 * nieuwere staat is precies wat er toen gebeurde.
 */
async function describeVersions(id: string) {
  const versions = (await listVersions(config.historyDir, id)).slice(0, 25);
  if (versions.length === 0) return [];

  const huidig = await readFile(templatePath(id), 'utf8').catch(() => null);
  const beschreven = [];

  for (const [index, version] of versions.entries()) {
    const nieuwer = index === 0 ? huidig : await readVersion(config.historyDir, id, versions[index - 1]!.stamp);

    let summary = '';
    try {
      if (nieuwer) {
        summary = summarizeDiff(
          diffTemplates(
            parseTemplate(JSON.parse(await readVersion(config.historyDir, id, version.stamp))),
            parseTemplate(JSON.parse(nieuwer)),
          ),
        );
      }
    } catch {
      summary = '';
    }

    beschreven.push({ ...version, summary });
  }

  return beschreven;
}

/** De rechten waar de invite-link om vraagt. */
function permissionsBit(): string {
  return INVITE_PERMISSIONS.bitfield.toString();
}

async function describeGuild(guild: Guild) {
  const me = await guild.members.fetchMe();
  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL({ size: 64 }),
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.filter((channel) => !channel.isThread()).size,
    roleCount: guild.roles.cache.size - 1,
    missing: missingPermissions(me),
    rolesAbove: rolesAboveBot(guild, me),
    // Zonder Administrator lukt community-modus niet en blijven bijzondere
    // rolrechten leeg. Dat hoor je te zien voordat je uitrolt.
    admin: me.permissions.has(PermissionFlagsBits.Administrator),
    inviteUrl: config.clientId ? buildGuildInviteUrl(config.clientId, permissionsBit(), guild.id) : null,
  };
}

async function describeTemplates() {
  const ids = await listTemplateIds(config.templatesDir);
  const described = [];

  for (const id of ids) {
    try {
      const { template } = await loadTemplateMet(config.templatesDir, id, {}, { losjes: true });
      described.push({
        id,
        name: template.name,
        description: template.description,
        variables: template.variables,
        roles: template.roles.length,
        categories: template.categories.length,
        channels:
          template.categories.reduce((sum, category) => sum + category.channels.length, 0) +
          template.uncategorizedChannels.length,
        error: null as string | null,
      });
    } catch (error) {
      described.push({
        id,
        name: id,
        description: '',
        roles: 0,
        categories: 0,
        channels: 0,
        error: message(error),
      });
    }
  }

  return described;
}

function templatePath(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Ongeldige template-naam: "${id}"`);
  return path.join(config.templatesDir, `${id}.json`);
}

async function writeTemplate(id: string, template: ServerTemplate): Promise<void> {
  await writeFile(templatePath(id), `${JSON.stringify(template, null, 2)}\n`, 'utf8');
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new Error('Verzoek te groot');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function sendHtml(response: ServerResponse): Promise<void> {
  const candidates = [
    fileURLToPath(new URL('./index.html', import.meta.url)),
    path.join(process.cwd(), 'src/dashboard/index.html'),
  ];

  for (const candidate of candidates) {
    try {
      const html = await readFile(candidate, 'utf8');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html);
      return;
    } catch {
      continue;
    }
  }

  send(response, 500, { error: 'index.html niet gevonden' });
}

/** Losse scriptbestanden naast index.html, zodat de pagina niet een muur JavaScript wordt. */
async function sendAsset(response: ServerResponse, name: string): Promise<void> {
  for (const candidate of assetCandidates(name)) {
    try {
      const contents = await readFile(candidate, 'utf8');
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(contents);
      return;
    } catch {
      continue;
    }
  }
  send(response, 404, { error: `${name} niet gevonden` });
}

/** De afbeelding uit BOT_AVATAR, zodat het inlogscherm hetzelfde logo toont als de bot. */
async function sendLogo(response: ServerResponse): Promise<void> {
  try {
    const image = await readFile(config.avatarFile);
    response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=300' });
    response.end(image);
  } catch {
    send(response, 404, { error: 'Geen logo ingesteld' });
  }
}

function assetCandidates(name: string): string[] {
  return [
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    path.join(process.cwd(), 'src/dashboard', name),
  ];
}

async function handleAuth(
  action: string | undefined,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  sessions: SessionStore,
  applicationOwners: string[],
  session: Session | null,
): Promise<void> {
  if (!authEnabled()) {
    return send(response, 400, {
      error: 'Inloggen staat uit. Zet DISCORD_CLIENT_SECRET in .env om het aan te zetten.',
    });
  }

  if (action === 'login') {
    const target = buildAuthorizeUrl(config.clientId, redirectUri(), sessions.issueState());
    response.writeHead(302, { location: target, 'cache-control': 'no-store' });
    response.end();
    return;
  }

  if (action === 'logout') {
    sessions.destroy(session?.id);
    response.writeHead(302, { location: '/', 'set-cookie': clearedCookie });
    response.end();
    return;
  }

  if (action === 'callback') {
    const code = url.searchParams.get('code');
    if (!code) return sendLoginError(response, 'Geen inlogcode ontvangen.');
    if (!sessions.consumeState(url.searchParams.get('state'))) {
      return sendLoginError(response, 'De inlogpoging is verlopen of hoort niet bij dit venster.');
    }

    try {
      const { user, guilds } = await exchangeCode(config.clientId, config.clientSecret, redirectUri(), code);

      if (!isAllowed(user.id, config.dashboardOwners, applicationOwners[0] ?? null) &&
          !applicationOwners.includes(user.id)) {
        logger.warn(`Inlogpoging geweigerd voor ${user.username} (${user.id})`);
        return sendLoginError(
          response,
          `${user.username} mag hier niet bij. Zet het gebruikers-id in DASHBOARD_OWNERS om toegang te geven: ${user.id}`,
        );
      }

      const created = sessions.create(user, guilds);
      logger.info(`Dashboard-login: ${user.username} (${user.id})`);
      response.writeHead(302, {
        location: '/',
        'set-cookie': sessionCookie(created.id, config.dashboardUrl.startsWith('https://')),
      });
      response.end();
      return;
    } catch (error) {
      return sendLoginError(response, message(error));
    }
  }

  send(response, 404, { error: 'Niet gevonden' });
}

/** Jouw servers, met per server of de bot er al in zit en zo niet een klaargezette invite. */
function describeOAuthGuilds(client: Client<true>, session: Session) {
  const permissions = INVITE_PERMISSIONS.bitfield.toString();

  return session.guilds
    .filter((guild) => guild.canManage)
    .map((guild) => ({
      ...guild,
      botPresent: client.guilds.cache.has(guild.id),
      inviteUrl: client.guilds.cache.has(guild.id)
        ? null
        : buildGuildInviteUrl(config.clientId, permissions, guild.id),
    }))
    .sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
}

function sendLoginError(response: ServerResponse, reason: string): void {
  response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Inloggen mislukt</title>` +
      `<body style="font:14px system-ui;max-width:34rem;margin:15vh auto;padding:0 1rem;color:#16181d">` +
      `<h1 style="font-size:18px">Inloggen mislukt</h1><p>${escapeHtml(reason)}</p>` +
      `<p><a href="/auth/login">Opnieuw proberen</a></p></body>`,
  );
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
