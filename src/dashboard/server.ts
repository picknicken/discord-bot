import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client, Guild } from 'discord.js';
import { config } from '../config.js';
import { missingPermissions, rolesAboveBot } from '../botPermissions.js';
import { applyPlan } from '../applier.js';
import { exportGuild } from '../exporter.js';
import { describeActions, planSetup, summarizePlan } from '../planner.js';
import { snapshotGuildFresh } from '../snapshot.js';
import { listTemplateIds, loadTemplate } from '../templates.js';
import { auditSummary, countBySeverity, lintTemplate } from '../lint.js';
import { PERMISSION_CATALOGUE } from '../permissionCatalogue.js';
import { INVITE_PERMISSIONS } from '../botPermissions.js';
import {
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
import { backupGuild, listBackups, readBackup } from '../backup.js';
import { listVersions, readVersion, recordVersion } from '../history.js';
import { diffTemplates, summarizeDiff } from '../diff.js';
import { simulate, simulatableRoles } from '../simulate.js';
import { compare } from '../compare.js';
import { parseTemplate, type ServerTemplate } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Lokaal dashboard. Luistert bewust alleen op 127.0.0.1: het praat namens de bot
 * met Discord, dus het mag niet van buiten bereikbaar zijn. De token blijft aan
 * deze kant — de browser krijgt hem nooit te zien.
 */
export interface DashboardOptions {
  /** Discord-ids die sowieso binnen mogen (de eigenaar of het team van de applicatie). */
  applicationOwners?: string[];
}

export function createDashboard(client: Client<true>, options: DashboardOptions = {}): Server {
  const sessions = new SessionStore();
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
    });
  }

  if (authEnabled() && !session) {
    return send(response, 401, { error: 'Niet ingelogd.', login: '/auth/login' });
  }

  // --- Status -------------------------------------------------------------
  if (method === 'GET' && resource === 'state') {
    return send(response, 200, {
      botName: client.user.username,
      botId: client.user.id,
      avatarUrl: client.user.displayAvatarURL(),
      templatesDir: config.templatesDir,
      guilds: await Promise.all(client.guilds.cache.map(describeGuild)),
      templates: await describeTemplates(),
      backups: await listBackups(config.backupsDir),
      permissions: PERMISSION_CATALOGUE,
    });
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
        ? { ...(await loadTemplate(config.templatesDir, body.from)), name: newId }
        : {
            name: newId,
            description: '',
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
      return send(response, 200, { backups: await listBackups(config.backupsDir) });
    }

    if (method === 'POST' && id === 'restore') {
      const body = await readJson<{ file?: string; guildId?: string }>(request);
      if (!body.file) return send(response, 400, { error: 'Geef een back-up op.' });

      const backup = await readBackup(config.backupsDir, body.file);
      const guild = client.guilds.cache.get(body.guildId || backup.guildId);
      if (!guild) return send(response, 404, { error: 'Server niet gevonden.' });
      if (config.demo) {
        return send(response, 200, { applied: 0, failed: 0, errors: [], note: 'demo-modus — er is niets teruggezet' });
      }

      // Terugzetten vult aan en werkt bij; het verwijdert nooit, want wat weg is
      // krijgt deze back-up toch niet terug.
      const plan = planSetup(await snapshotGuildFresh(guild), backup.template, { prune: false, update: true });
      if (plan.actions.length === 0) return send(response, 200, { applied: 0, failed: 0, errors: [], note: 'Niets te herstellen.' });

      logger.info(`Dashboard herstelt "${body.file}" op "${guild.name}" (${plan.actions.length} acties)`);
      const result = await applyPlan(guild, backup.template, plan);

      // Terugzetten vult aan maar verwijdert niets, dus de server kan na afloop
      // nog steeds afwijken. Dat hoort de gebruiker te zien, niet te vermoeden.
      const rest = compare(await snapshotGuildFresh(guild), backup.template);
      return send(response, 200, {
        ...result,
        leftover: rest.counts.extra,
        mismatch: rest.counts['type-mismatch'],
      });
    }
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
    }>(request);

    const guildIds = body.guildIds?.length ? body.guildIds : body.guildId ? [body.guildId] : [];
    if (!body.templateId || guildIds.length === 0) {
      return send(response, 400, { error: 'Kies een template en minstens een server.' });
    }

    const template = await loadTemplate(config.templatesDir, body.templateId);
    const options = { prune: body.prune ?? false, update: body.update ?? true };

    if (resource === 'plan') {
      const plans = [];
      for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        const plan = planSetup(await snapshotGuildFresh(guild), template, options);
        plans.push({
          guildId,
          guildName: guild.name,
          summary: summarizePlan(plan),
          actions: describeActions(plan, 1000),
          warnings: plan.warnings,
          count: plan.actions.length,
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

    const results = [];
    for (const guildId of guildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        results.push({ guildId, guildName: guildId, applied: 0, failed: 0, errors: ['server niet gevonden'] });
        continue;
      }

      const me = await guild.members.fetchMe();
      const missing = missingPermissions(me);
      if (missing.length > 0) {
        results.push({
          guildId,
          guildName: guild.name,
          applied: 0,
          failed: 0,
          errors: [`de bot mist rechten: ${missing.join(', ')}`],
        });
        continue;
      }

      const plan = planSetup(await snapshotGuildFresh(guild), template, options);
      if (plan.actions.length === 0) {
        results.push({ guildId, guildName: guild.name, applied: 0, failed: 0, errors: [], note: 'niets te doen' });
        continue;
      }

      // Altijd eerst een momentopname, tenzij het dashboard er expliciet om vraagt.
      let backupFile: string | null = null;
      if (body.backup !== false) {
        backupFile = await backupGuild(guild, config.backupsDir, body.templateId).catch(() => null);
      }

      logger.info(`Dashboard past "${body.templateId}" toe op "${guild.name}" (${plan.actions.length} acties)`);
      const result = await applyPlan(guild, template, plan);
      results.push({ guildId, guildName: guild.name, backup: backupFile, ...result });
    }

    return send(response, 200, {
      results,
      applied: results.reduce((sum, result) => sum + result.applied, 0),
      failed: results.reduce((sum, result) => sum + result.failed, 0),
      errors: results.flatMap((result) => result.errors.map((error) => `${result.guildName}: ${error}`)),
    });
  }

  // --- Bestaande server exporteren ---------------------------------------
  if (method === 'GET' && resource === 'export' && id !== undefined) {
    const guild = client.guilds.cache.get(id);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden' });
    const template = exportGuild(guild);
    return send(response, 200, { id: slug(guild.name), json: JSON.stringify(template, null, 2) });
  }

  send(response, 404, { error: 'Niet gevonden' });
}

// --- Helpers --------------------------------------------------------------

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
  };
}

async function describeTemplates() {
  const ids = await listTemplateIds(config.templatesDir);
  const described = [];

  for (const id of ids) {
    try {
      const template = await loadTemplate(config.templatesDir, id);
      described.push({
        id,
        name: template.name,
        description: template.description,
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
