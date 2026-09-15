import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

/**
 * Inloggen staat aan, en de bot zit in twee servers: eentje waar deze gebruiker
 * beheerder is en eentje van iemand anders. Hij hoort de tweede niet te zien en
 * er al helemaal niets mee te kunnen.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-eigen-'));
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

const historyDir = path.join(werkmap, 'history');
const backupsDir = path.join(werkmap, 'backups');
mkdirSync(historyDir, { recursive: true });
mkdirSync(backupsDir, { recursive: true });

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = 'geheim';
process.env.DASHBOARD_URL = 'http://127.0.0.1:4000';
process.env.TEMPLATES_DIR = werkmap;
process.env.HISTORY_DIR = historyDir;
process.env.BACKUPS_DIR = backupsDir;

const { createDashboard } = await import('../src/dashboard/server.js');
const { SessionStore } = await import('../src/auth.js');
const { stubClient, stubGuild } = await import('./helpers/guild.js');

const mijn = stubGuild('mijn-server', 'Mijn server');
const andermans = stubGuild('andermans-server', 'Server van iemand anders');

const client = stubClient([mijn, andermans]);

// Een back-up en een uitrolregel van allebei de servers, zodat de lijsten iets
// te zeven hebben.
for (const guild of [mijn, andermans]) {
  writeFileSync(
    path.join(backupsDir, `${guild.id}.json`),
    JSON.stringify({
      guildId: guild.id,
      guildName: guild.name,
      createdAt: new Date().toISOString(),
      template: { name: guild.name, roles: [], categories: [], uncategorizedChannels: [] },
    }),
  );
}

writeFileSync(
  path.join(historyDir, 'setups.jsonl'),
  [mijn, andermans]
    .map((guild) =>
      JSON.stringify({
        at: new Date().toISOString(),
        guildId: guild.id,
        guildName: guild.name,
        template: 'community',
        door: 'test',
        mode: 'apply',
        onderdelen: [],
        applied: 1,
        failed: 0,
        backup: null,
        notes: [],
      }),
    )
    .join('\n') + '\n',
);

const sessions = new SessionStore();
const sessie = sessions.create(
  { id: '42', username: 'schaap', globalName: null, avatarUrl: 'https://example.invalid/a.png' },
  [
    { id: mijn.id, name: mijn.name, iconUrl: null, owner: true, canManage: true },
    { id: andermans.id, name: andermans.name, iconUrl: null, owner: false, canManage: false },
  ],
);

let server: Server;
let base: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createDashboard(client, { applicationOwners: ['42'], sessions });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
        resolve();
      });
    }),
);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(werkmap, { recursive: true, force: true });
});

const cookie = { cookie: `setupbot_session=${sessie.id}` };
type Json = Record<string, any>;
const json = async <T extends Json = Json>(response: Response): Promise<T> => (await response.json()) as T;
const get = (pad: string) => fetch(base + pad, { headers: cookie });
const post = (pad: string, body: unknown) =>
  fetch(base + pad, {
    method: 'POST',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('alleen je eigen servers in het dashboard', () => {
  it('toont alleen de server waar je beheerder bent', async () => {
    const state = await json(await get('/api/state'));
    expect(state.guilds.map((guild: { id: string }) => guild.id)).toEqual(['mijn-server']);
  });

  it('laat geen back-ups van andermans servers zien', async () => {
    const state = await json(await get('/api/state'));
    expect(state.backups.map((backup: { guildId: string }) => backup.guildId)).toEqual(['mijn-server']);

    const los = await json(await get('/api/backups'));
    expect(los.backups.map((backup: { guildId: string }) => backup.guildId)).toEqual(['mijn-server']);
  });

  it('laat geen uitrolgeschiedenis van andermans servers zien', async () => {
    const setups = await json(await get('/api/setups'));
    expect(setups.setups.map((run: { guildId: string }) => run.guildId)).toEqual(['mijn-server']);
  });

  it('weigert plannen en toepassen op een vreemde server', async () => {
    for (const pad of ['/api/plan', '/api/apply']) {
      const response = await post(pad, { templateId: 'community', guildId: 'andermans-server' });
      expect(response.status, pad).toBe(403);
      expect((await json(response)).error).toMatch(/geen beheerder/);
    }
  });

  it('weigert de hele rij zodra er een vreemde server tussen zit', async () => {
    const response = await post('/api/plan', {
      templateId: 'community',
      guildIds: ['mijn-server', 'andermans-server'],
    });
    expect(response.status).toBe(403);
  });

  it('weigert vergelijken, uitvoeren en terugzetten op een vreemde server', async () => {
    expect((await post('/api/compare', { json: '{"name":"X"}', guildId: 'andermans-server' })).status).toBe(403);
    expect((await get('/api/export/andermans-server')).status).toBe(403);
    expect((await post('/api/backups/restore', { file: 'andermans-server.json' })).status).toBe(403);
  });

  it('laat je eigen server gewoon met rust', async () => {
    const plan = await json(await post('/api/plan', { templateId: 'community', guildId: 'mijn-server' }));
    expect(plan.count).toBeGreaterThan(0);

    const exported = await json(await get('/api/export/mijn-server'));
    expect(JSON.parse(exported.json).name).toBe('Mijn server');
  });
});
