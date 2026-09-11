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
import { countBySeverity, lintTemplate } from '../lint.js';
import { PERMISSION_CATALOGUE } from '../permissionCatalogue.js';
import { backupGuild, listBackups, readBackup } from '../backup.js';
import { listVersions, readVersion, recordVersion } from '../history.js';
import { simulate, simulatableRoles } from '../simulate.js';
import { parseTemplate, type ServerTemplate } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Lokaal dashboard. Luistert bewust alleen op 127.0.0.1: het praat namens de bot
 * met Discord, dus het mag niet van buiten bereikbaar zijn. De token blijft aan
 * deze kant — de browser krijgt hem nooit te zien.
 */
export function createDashboard(client: Client<true>): Server {
  return createServer((request, response) => {
    handle(client, request, response).catch((error: unknown) => {
      logger.error('Dashboard-verzoek mislukt', error);
      send(response, 500, { error: message(error) });
    });
  });
}

async function handle(client: Client<true>, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const segments = url.pathname.split('/').filter(Boolean);
  const method = request.method ?? 'GET';

  if (method === 'GET' && segments.length === 0) return sendHtml(response);

  if (method === 'GET' && segments.length === 1 && /^[\w-]+\.js$/.test(segments[0] ?? '')) {
    return sendAsset(response, segments[0] as string);
  }

  if (segments[0] !== 'api') return send(response, 404, { error: 'Niet gevonden' });
  const [, resource, id, sub] = segments;

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
      return send(response, 200, { versions: await listVersions(config.historyDir, id) });
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
        if (previous) await recordVersion(config.historyDir, id, previous);
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
    if (current) await recordVersion(config.historyDir, id, current);
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

      // Terugzetten vult aan en werkt bij; het verwijdert nooit, want wat weg is
      // krijgt deze back-up toch niet terug.
      const plan = planSetup(await snapshotGuildFresh(guild), backup.template, { prune: false, update: true });
      if (plan.actions.length === 0) return send(response, 200, { applied: 0, failed: 0, errors: [], note: 'Niets te herstellen.' });

      logger.info(`Dashboard herstelt "${body.file}" op "${guild.name}" (${plan.actions.length} acties)`);
      return send(response, 200, await applyPlan(guild, backup.template, plan));
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
        roles,
        simulation: role ? simulate(template, role.key) : null,
      });
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

function assetCandidates(name: string): string[] {
  return [
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    path.join(process.cwd(), 'src/dashboard', name),
  ];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
