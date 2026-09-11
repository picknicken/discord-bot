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
import { snapshotGuild } from '../snapshot.js';
import { listTemplateIds, loadTemplate } from '../templates.js';
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

  if (segments[0] !== 'api') return send(response, 404, { error: 'Niet gevonden' });
  const [, resource, id] = segments;

  // --- Status -------------------------------------------------------------
  if (method === 'GET' && resource === 'state') {
    return send(response, 200, {
      botName: client.user.username,
      botId: client.user.id,
      avatarUrl: client.user.displayAvatarURL(),
      templatesDir: config.templatesDir,
      guilds: await Promise.all(client.guilds.cache.map(describeGuild)),
      templates: await describeTemplates(),
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
        : { name: newId, description: '', guild: {}, roles: [], categories: [], uncategorizedChannels: [] };

      await writeTemplate(newId, source);
      return send(response, 200, { id: newId, json: JSON.stringify(source, null, 2) });
    }
  }

  if (resource === 'templates' && id !== undefined) {
    if (method === 'GET') {
      const json = await readFile(templatePath(id), 'utf8');
      return send(response, 200, { id, json, template: parseTemplate(JSON.parse(json)) });
    }

    if (method === 'PUT') {
      const body = await readJson<{ json?: string }>(request);
      try {
        const template = parseTemplate(JSON.parse(body.json ?? ''));
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

  // --- Plannen en toepassen ----------------------------------------------
  if (method === 'POST' && (resource === 'plan' || resource === 'apply')) {
    const body = await readJson<{
      templateId?: string;
      guildId?: string;
      prune?: boolean;
      update?: boolean;
    }>(request);

    if (!body.templateId || !body.guildId) {
      return send(response, 400, { error: 'Kies een template en een server.' });
    }

    const guild = client.guilds.cache.get(body.guildId);
    if (!guild) return send(response, 404, { error: 'Server niet gevonden — is de bot er nog lid van?' });

    const template = await loadTemplate(config.templatesDir, body.templateId);
    const plan = planSetup(snapshotGuild(guild), template, {
      prune: body.prune ?? false,
      update: body.update ?? true,
    });

    if (resource === 'plan') {
      return send(response, 200, {
        summary: summarizePlan(plan),
        actions: describeActions(plan, 1000),
        warnings: plan.warnings,
        count: plan.actions.length,
      });
    }

    const me = await guild.members.fetchMe();
    const missing = missingPermissions(me);
    if (missing.length > 0) {
      return send(response, 400, { error: `De bot mist rechten in deze server: ${missing.join(', ')}` });
    }
    if (plan.actions.length === 0) {
      return send(response, 200, { applied: 0, failed: 0, errors: [], note: 'Niets te doen.' });
    }

    logger.info(`Dashboard past "${body.templateId}" toe op "${guild.name}" (${plan.actions.length} acties)`);
    const result = await applyPlan(guild, template, plan);
    return send(response, 200, result);
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
