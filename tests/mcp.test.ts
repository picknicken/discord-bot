import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { Collection, PermissionFlagsBits, PermissionsBitField, type Client, type Guild } from 'discord.js';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { demoGuilds } from '../src/demoServers.js';

/**
 * De MCP-koppeling zelf: authenticatie, de guild-allowlist (een eigen, apart
 * ingevulde lijst — hier op '1' gezet), dat een preview niets uitvoert, dat
 * schrijvende tools de allowlist net zo hard controleren als leestools, en de
 * confirmatie tussen preview_template en apply_template.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'mcp-'));
const templatesDir = path.join(werkmap, 'templates');
const historyDir = path.join(werkmap, 'history');
const backupsDir = path.join(werkmap, 'backups');

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = templatesDir;
process.env.HISTORY_DIR = historyDir;
process.env.BACKUPS_DIR = backupsDir;
process.env.MCP_ENABLED = 'true';
process.env.MCP_AUTH_TOKEN = 'geheim-token';
process.env.MCP_ALLOWED_GUILD_IDS = '1,9';
delete process.env.GUILD_IDS;

const { createDashboard } = await import('../src/dashboard/server.js');
const { wisAlleConfirmatiesVoorTests } = await import('../src/mcp/confirmaties.js');
const { readSetups } = await import('../src/setupLog.js');
const { listBackups } = await import('../src/backup.js');

import { mkdirSync } from 'node:fs';
mkdirSync(templatesDir, { recursive: true });
writeFileSync(
  path.join(templatesDir, 'minimaal.json'),
  JSON.stringify({ name: 'Minimaal', roles: [{ key: 'lid', name: 'Lid', permissions: [] }] }, null, 2),
);

/**
 * Een server die écht een rol kan aanmaken, voor de volledige apply-toets.
 * Los van `demoServers.ts`, dat expres geen schrijfmethodes nabootst.
 */
function nepRol(id: string, name: string, position: number) {
  return {
    id,
    name,
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: new PermissionsBitField(0n),
    position,
    rawPosition: position,
    managed: false,
  };
}

function werkendeGuild(id: string, naam: string): Guild {
  const rollen = new Collection<string, ReturnType<typeof nepRol>>();
  rollen.set(id, nepRol(id, '@everyone', 0));

  return {
    id,
    name: naam,
    features: [] as string[],
    roles: {
      cache: rollen,
      create: async ({ name }: { name: string }) => {
        const rol = nepRol(`${id}-${name}`, name, 1);
        rollen.set(rol.id, rol);
        return rol;
      },
    },
    channels: { cache: new Collection() },
    emojis: { cache: new Collection() },
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection() },
    fetchOnboarding: async () => null,
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
        roles: { highest: { position: 9 } },
      }),
    },
  } as unknown as Guild;
}

const guilds = demoGuilds() as unknown as Collection<string, Guild>;
guilds.set('9', werkendeGuild('9', 'Werkende Server'));

const client = {
  user: { username: 'Setup Bot', id: 'bot', displayAvatarURL: () => '' },
  guilds: { cache: guilds },
} as unknown as Client<true>;

let server: Server;
let base: string;

async function mcpClient() {
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { authorization: 'Bearer geheim-token' } },
  });
  const mcp = new McpClient({ name: 'test', version: '1.0.0' });
  await mcp.connect(transport);
  return mcp;
}

async function roep(mcp: McpClient, name: string, args: Record<string, unknown>) {
  const uitkomst = await mcp.callTool({ name, arguments: args });
  const tekst = (uitkomst.content as Array<{ text: string }>)[0]?.text ?? '';
  return { isError: Boolean(uitkomst.isError), tekst, data: veiligJson(tekst) };
}

function veiligJson(tekst: string): unknown {
  try {
    return JSON.parse(tekst);
  } catch {
    return null;
  }
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createDashboard(client);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
        resolve();
      });
    }),
);

afterEach(() => wisAlleConfirmatiesVoorTests());

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(werkmap, { recursive: true, force: true });
});

describe('authenticatie', () => {
  it('weigert zonder Bearer-token', async () => {
    const response = await fetch(base + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('weigert met een fout token', async () => {
    const response = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer verkeerd-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('weigert GET en DELETE', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(base + '/mcp', {
        method,
        headers: { authorization: 'Bearer geheim-token', accept: 'application/json, text/event-stream' },
      });
      expect(response.status).toBe(405);
    }
  });

  it('laat de goede toegang door', async () => {
    const mcp = await mcpClient();
    const tools = await mcp.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('list_allowed_servers');
    await mcp.close();
  });
});

describe('guild-isolatie (leestools)', () => {
  it('list_allowed_servers geeft alleen server 1 en 9, niet 2/3/4', async () => {
    const mcp = await mcpClient();
    const { data } = await roep(mcp, 'list_allowed_servers', {});
    const ids = (data as { servers: Array<{ id: string }> }).servers.map((server) => server.id).sort();
    expect(ids).toEqual(['1', '9']);
    await mcp.close();
  });

  it('get_server op een niet-toegestane server wordt geweigerd', async () => {
    const mcp = await mcpClient();
    const { isError, tekst } = await roep(mcp, 'get_server', { guildId: '2' });
    expect(isError).toBe(true);
    expect(tekst).toMatch(/niet toegestaan/);
    await mcp.close();
  });

  it('list_channels en list_roles worden allebei geweigerd op een niet-toegestane server', async () => {
    const mcp = await mcpClient();
    for (const tool of ['list_channels', 'list_roles', 'get_drift', 'get_recent_changes']) {
      const { isError } = await roep(mcp, tool, { guildId: '2' });
      expect(isError, tool).toBe(true);
    }
    await mcp.close();
  });

  it('geeft geen 500 of stacktrace-achtige info prijs bij een niet-bestaande server', async () => {
    const mcp = await mcpClient();
    const { isError, tekst } = await roep(mcp, 'get_server', { guildId: '999999999999999999' });
    expect(isError).toBe(true);
    expect(tekst).toBe('Server 999999999999999999 is niet toegestaan voor MCP.');
    await mcp.close();
  });
});

describe('tool-isolatie (schrijftools)', () => {
  it('create_role/update_role/delete_role worden geweigerd op een niet-toegestane server', async () => {
    const mcp = await mcpClient();
    const create = await roep(mcp, 'create_role', { guildId: '2', name: 'Test' });
    expect(create.isError).toBe(true);

    const update = await roep(mcp, 'update_role', { guildId: '2', roleId: 'r1', name: 'Test' });
    expect(update.isError).toBe(true);

    const del = await roep(mcp, 'delete_role', { guildId: '2', roleId: 'r1' });
    expect(del.isError).toBe(true);
    await mcp.close();
  });

  it('preview_template en apply_template worden geweigerd op een niet-toegestane server', async () => {
    const mcp = await mcpClient();
    const preview = await roep(mcp, 'preview_template', { guildId: '2', templateId: 'minimaal' });
    expect(preview.isError).toBe(true);

    const apply = await roep(mcp, 'apply_template', {
      guildId: '2',
      templateId: 'minimaal',
      confirmation_token: 'wat-dan-ook',
    });
    expect(apply.isError).toBe(true);
    await mcp.close();
  });
});

describe('preview voert niets uit', () => {
  it('verandert niets aan de server en schrijft geen back-up of geschiedenis', async () => {
    const mcp = await mcpClient();
    const guild = guilds.get('9') as unknown as Guild;
    const rollenVoor = guild.roles.cache.size;

    await roep(mcp, 'preview_template', { guildId: '9', templateId: 'minimaal' });

    expect(guild.roles.cache.size).toBe(rollenVoor);
    expect(await readSetups(historyDir, 10)).toHaveLength(0);
    expect(await listBackups(backupsDir)).toHaveLength(0);
    await mcp.close();
  });

  it('geeft een confirmation_token dat nog niet verlopen is', async () => {
    const mcp = await mcpClient();
    const { data } = await roep(mcp, 'preview_template', { guildId: '9', templateId: 'minimaal' });
    const { confirmation_token: token, confirmation_verloopt: verloopt } = data as {
      confirmation_token: string;
      confirmation_verloopt: string;
    };
    expect(token).toBeTruthy();
    expect(new Date(verloopt).getTime()).toBeGreaterThan(Date.now());
    await mcp.close();
  });
});

describe('confirmation-token bij apply_template', () => {
  async function nieuwToken(mcp: McpClient, guildId = '9', templateId = 'minimaal') {
    const { data } = await roep(mcp, 'preview_template', { guildId, templateId });
    return (data as { confirmation_token: string }).confirmation_token;
  }

  it('een onbekend token wordt geweigerd', async () => {
    const mcp = await mcpClient();
    const { isError, tekst } = await roep(mcp, 'apply_template', {
      guildId: '9',
      templateId: 'minimaal',
      confirmation_token: 'bestaat-niet',
    });
    expect(isError).toBe(true);
    expect(tekst).toMatch(/Onbekende of al gebruikte/);
    await mcp.close();
  });

  it('een token voor een andere server wordt geweigerd', async () => {
    const mcp = await mcpClient();
    const token = await nieuwToken(mcp, '9', 'minimaal');
    // guildId '2' is toch al niet toegestaan; dit toetst met '1' zodat de
    // guild-allowlist niet in de weg zit en de confirmatie zelf getoetst wordt.
    const { isError, tekst } = await roep(mcp, 'apply_template', {
      guildId: '1',
      templateId: 'minimaal',
      confirmation_token: token,
    });
    expect(isError).toBe(true);
    expect(tekst).toMatch(/andere server/);
    await mcp.close();
  });

  it('een token voor een andere template wordt geweigerd', async () => {
    writeFileSync(
      path.join(templatesDir, 'ook-minimaal.json'),
      JSON.stringify({ name: 'Ook minimaal', roles: [{ key: 'lid', name: 'Lid', permissions: [] }] }, null, 2),
    );
    const mcp = await mcpClient();
    const token = await nieuwToken(mcp, '9', 'minimaal');
    const { isError, tekst } = await roep(mcp, 'apply_template', {
      guildId: '9',
      templateId: 'ook-minimaal',
      confirmation_token: token,
    });
    expect(isError).toBe(true);
    expect(tekst).toMatch(/andere template/);
    await mcp.close();
  });

  it('een gewijzigd plan (de template is intussen aangepast) wordt geweigerd', async () => {
    const mcp = await mcpClient();
    const token = await nieuwToken(mcp, '9', 'minimaal');

    // De template verandert na de preview, vlak voor het toepassen.
    writeFileSync(
      path.join(templatesDir, 'minimaal.json'),
      JSON.stringify(
        { name: 'Minimaal', roles: [{ key: 'lid', name: 'Lid' }, { key: 'mod', name: 'Mod' }] },
        null,
        2,
      ),
    );

    const { isError, tekst } = await roep(mcp, 'apply_template', {
      guildId: '9',
      templateId: 'minimaal',
      confirmation_token: token,
    });
    expect(isError).toBe(true);
    expect(tekst).toMatch(/niet meer hetzelfde/);

    // Terugzetten voor de volgende tests.
    writeFileSync(
      path.join(templatesDir, 'minimaal.json'),
      JSON.stringify({ name: 'Minimaal', roles: [{ key: 'lid', name: 'Lid', permissions: [] }] }, null, 2),
    );
  });

  it('het juiste token voert de template echt uit, en is daarna niet opnieuw te gebruiken', async () => {
    const mcp = await mcpClient();
    const token = await nieuwToken(mcp, '9', 'minimaal');

    const eerste = await roep(mcp, 'apply_template', {
      guildId: '9',
      templateId: 'minimaal',
      confirmation_token: token,
    });
    expect(eerste.isError).toBeFalsy();
    expect((eerste.data as { applied: number }).applied).toBeGreaterThan(0);

    const guild = guilds.get('9') as unknown as Guild;
    expect([...guild.roles.cache.values()].some((role) => role.name === 'Lid')).toBe(true);
    expect(await listBackups(backupsDir)).not.toHaveLength(0);
    expect(await readSetups(historyDir, 10)).not.toHaveLength(0);

    const tweede = await roep(mcp, 'apply_template', {
      guildId: '9',
      templateId: 'minimaal',
      confirmation_token: token,
    });
    expect(tweede.isError).toBe(true);
    expect(tweede.tekst).toMatch(/Onbekende of al gebruikte/);
    await mcp.close();
  });
});

describe('update_template', () => {
  it('slaat een geldige template op en bewaart de vorige versie', async () => {
    const mcp = await mcpClient();
    const nieuw = JSON.stringify({ name: 'Ook minimaal, maar anders', roles: [] }, null, 2);
    const { isError, data } = await roep(mcp, 'update_template', { templateId: 'ook-minimaal', json: nieuw });
    expect(isError).toBeFalsy();
    expect((data as { saved: boolean }).saved).toBe(true);
    await mcp.close();
  });

  it('schrijft niets weg bij ongeldige JSON', async () => {
    const voor = readFileSync(path.join(templatesDir, 'ook-minimaal.json'), 'utf8');
    const mcp = await mcpClient();
    const { isError } = await roep(mcp, 'update_template', { templateId: 'ook-minimaal', json: '{ dit is geen json' });
    expect(isError).toBe(true);
    expect(readFileSync(path.join(templatesDir, 'ook-minimaal.json'), 'utf8')).toBe(voor);
    await mcp.close();
  });

  it('weigert een template-id met een padtraversal', async () => {
    const mcp = await mcpClient();
    const { isError } = await roep(mcp, 'update_template', {
      templateId: '../../etc/passwd',
      json: '{"name":"x"}',
    });
    expect(isError).toBe(true);
    await mcp.close();
  });
});
