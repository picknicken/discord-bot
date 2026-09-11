import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, PermissionsBitField, type Client } from 'discord.js';

// Met een client secret is inloggen verplicht — ook op localhost.
const templatesDir = mkdtempSync(path.join(tmpdir(), 'setup-bot-auth-'));
copyFileSync('./templates/community.json', path.join(templatesDir, 'community.json'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.DISCORD_CLIENT_SECRET = 'geheim';
process.env.DASHBOARD_URL = 'http://127.0.0.1:4000';
process.env.TEMPLATES_DIR = templatesDir;

const { createDashboard } = await import('../src/dashboard/server.js');

const client = {
  user: { username: 'Setup Bot', id: '1', displayAvatarURL: () => 'https://example.invalid/a.png' },
  guilds: { cache: new Collection() },
} as unknown as Client<true>;

let server: Server;
let base: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createDashboard(client, { applicationOwners: ['42'] });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
        resolve();
      });
    }),
);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(templatesDir, { recursive: true, force: true });
});

describe('dashboard met inloggen aan', () => {
  it('houdt de api dicht zonder sessie', async () => {
    for (const path of ['/api/state', '/api/templates', '/api/templates/community']) {
      const response = await fetch(base + path);
      expect(response.status, path).toBe(401);
      expect(((await response.json()) as { login?: string }).login).toBe('/auth/login');
    }
  });

  it('houdt ook schrijvende routes dicht', async () => {
    const response = await fetch(base + '/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'community', guildId: 'g1' }),
    });
    expect(response.status).toBe(401);
  });

  it('vertelt wel dat je moet inloggen', async () => {
    const data = await (await fetch(base + '/api/session')).json();
    expect(data).toMatchObject({ authEnabled: true, authenticated: false, user: null });
  });

  it('serveert de pagina zelf nog, anders zie je het inlogscherm niet', async () => {
    expect((await fetch(base + '/')).status).toBe(200);
    expect((await fetch(base + '/app.js')).status).toBe(200);
  });

  it('stuurt door naar Discord met de juiste scopes', async () => {
    const response = await fetch(base + '/auth/login', { redirect: 'manual' });
    expect(response.status).toBe(302);

    const target = new URL(response.headers.get('location') ?? '');
    expect(target.host).toBe('discord.com');
    expect(target.searchParams.get('scope')).toBe('identify guilds');
    expect(target.searchParams.get('client_id')).toBe('123456789');
    expect(target.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4000/auth/callback');
    expect(target.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('weigert een callback met een verzonnen state', async () => {
    const response = await fetch(base + '/auth/callback?code=abc&state=verzonnen');
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('verlopen');
  });

  it('weigert een callback zonder code', async () => {
    expect((await fetch(base + '/auth/callback')).status).toBe(403);
  });
});
