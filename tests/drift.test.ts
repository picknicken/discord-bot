import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';

/**
 * "Klopt deze server nog?" hoort een getal te zijn dat er staat, niet iets wat
 * je per template en per server zelf gaat opzoeken. De vergelijking bestond al;
 * dit is hem uit zichzelf, tegen de template die er het laatst op ging.
 */
const map = mkdtempSync(path.join(tmpdir(), 'setup-bot-drift-'));
copyFileSync('./templates/community.json', path.join(map, 'community.json'));
mkdirSync(path.join(map, 'history'), { recursive: true });

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = map;
process.env.HISTORY_DIR = path.join(map, 'history');
process.env.BACKUPS_DIR = path.join(map, 'backups');

const { createDashboard } = await import('../src/dashboard/server.js');
const { stubGuild, stubClient } = await import('./helpers/guild.js');

const schrijfGeschiedenis = (regels: Record<string, unknown>[]) =>
  writeFileSync(
    path.join(map, 'history', 'setups.jsonl'),
    regels.map((regel) => JSON.stringify(regel)).join('\n') + '\n',
  );

let server: Server;
let base: string;

beforeAll(async () => {
  const guild = stubGuild('1', 'Testserver');
  // De bot mag alles; anders blijft het plan leeg om een andere reden.
  guild.members.fetchMe = async () => ({
    permissions: new PermissionsBitField(
      PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageGuild,
    ),
    roles: { highest: { position: 9 } },
  });

  server = createDashboard(stubClient([guild]) as Client<true>);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const adres = server.address();
      base = `http://127.0.0.1:${typeof adres === 'object' && adres ? adres.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(map, { recursive: true, force: true });
});

const drift = async () => (await (await fetch(base + '/api/drift')).json()) as {
  servers: { guildId: string; template: string | null; count: number | null; samenvatting: string | null }[];
};

describe('klopt deze server nog', () => {
  it('zegt "nog niet uitgerold" zolang er niets op ging', async () => {
    schrijfGeschiedenis([]);
    const data = await drift();

    expect(data.servers).toHaveLength(1);
    expect(data.servers[0]).toMatchObject({ guildId: '1', template: null, count: null });
  });

  it('telt de verschillen met de template die er het laatst op ging', async () => {
    schrijfGeschiedenis([
      {
        at: '2026-09-21T08:00:00.000Z',
        guildId: '1',
        guildName: 'Testserver',
        template: 'community',
        door: 'test',
        mode: 'apply',
        onderdelen: ['rollen'],
        applied: 5,
        failed: 0,
        backup: null,
        notes: [],
      },
    ]);

    const data = await drift();
    // De namaakserver is leeg, dus de hele template staat er nog niet op.
    expect(data.servers[0]?.template).toBe('community');
    expect(data.servers[0]?.count).toBeGreaterThan(0);
    expect(data.servers[0]?.samenvatting).toContain('aanmaken');
  });

  it('kijkt naar de laatste uitrol, niet naar de eerste of naar een preview', async () => {
    const basis = {
      guildId: '1',
      guildName: 'Testserver',
      door: 'test',
      onderdelen: ['rollen'],
      applied: 0,
      failed: 0,
      backup: null,
      notes: [],
    };

    schrijfGeschiedenis([
      { ...basis, at: '2026-09-21T07:00:00.000Z', template: 'een-oude', mode: 'apply' },
      { ...basis, at: '2026-09-21T08:00:00.000Z', template: 'community', mode: 'apply' },
      { ...basis, at: '2026-09-21T09:00:00.000Z', template: 'alleen-bekeken', mode: 'preview' },
    ]);

    expect((await drift()).servers[0]?.template).toBe('community');
  });
});
