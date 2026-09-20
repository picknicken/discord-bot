import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits, PermissionsBitField, type ChatInputCommandInteraction } from 'discord.js';

const werkmap = mkdtempSync(path.join(tmpdir(), 'clan-cmd-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = werkmap;
process.env.CLAN_DIR = path.join(werkmap, 'clan');
process.env.GUILD_IDS = '987654321';

const { data, execute } = await import('../src/commands/clan.js');
const { koppel, leesDossier } = await import('../src/clan/opslag.js');
const { COMMANDS } = await import('../src/bot.js');

/** Een nagebootst commando; we kijken naar wat er terugkomt en wat er op schijf staat. */
function interactie(opties: {
  guildId?: string;
  permissions?: bigint;
  subcommand: string;
  rsn?: string;
  userId?: string;
}) {
  const antwoorden: string[] = [];

  return {
    antwoorden,
    interaction: {
      inGuild: () => true,
      guild: { id: opties.guildId ?? '987654321', name: 'Clanserver' },
      guildId: opties.guildId ?? '987654321',
      user: { id: opties.userId ?? '111111111', username: 'tessa' },
      memberPermissions: new PermissionsBitField(opties.permissions ?? PermissionFlagsBits.SendMessages),
      options: {
        getSubcommand: () => opties.subcommand,
        getString: () => opties.rsn ?? '',
        getUser: () => ({ id: '111111111' }),
      },
      reply: async (bericht: { content?: string }) => {
        antwoorden.push(bericht.content ?? '(embed)');
      },
      deferReply: async () => undefined,
      editReply: async (bericht: string | { content?: string }) => {
        antwoorden.push(typeof bericht === 'string' ? bericht : (bericht.content ?? '(embed)'));
      },
    } as unknown as ChatInputCommandInteraction,
  };
}

afterAll(() => rmSync(werkmap, { recursive: true, force: true }));

describe('/clan', () => {
  it('staat naast /setup geregistreerd', () => {
    expect(data.name).toBe('clan');
    expect(COMMANDS.map((command) => command.data.name).sort()).toEqual(['clan', 'setup']);
  });

  it('weigert een server die niet op de lijst staat', async () => {
    const { interaction, antwoorden } = interactie({ guildId: 'mag-niet', subcommand: 'status' });
    await execute(interaction);
    expect(antwoorden[0]).toMatch(/staat niet in de lijst/);
  });

  it('houdt /clan sync bij wie geen rollen mag beheren weg', async () => {
    const { interaction, antwoorden } = interactie({ subcommand: 'sync' });
    await execute(interaction);
    expect(antwoorden[0]).toMatch(/Rollen beheren/);
  });

  it('laat koppelen wel aan een gewoon lid', async () => {
    const { interaction, antwoorden } = interactie({ subcommand: 'koppel', rsn: 'een veel te lange naam' });
    await execute(interaction);
    // Struikelt op de naam, niet op de rechten: dat is precies het verschil.
    expect(antwoorden[0]).toMatch(/kan geen RuneScape-naam zijn/);
  });

  it('vertelt bij /clan mij dat er nog niets gekoppeld is', async () => {
    const { interaction, antwoorden } = interactie({ subcommand: 'mij', userId: '222222222' });
    await execute(interaction);
    expect(antwoorden[0]).toMatch(/nog geen RuneScape-naam gekoppeld/);
  });

  it('haalt de koppeling weg bij /clan ontkoppel', async () => {
    await koppel(process.env.CLAN_DIR as string, '987654321', '111111111', 'Tess', 'zelf');

    const { interaction, antwoorden } = interactie({ subcommand: 'ontkoppel' });
    await execute(interaction);

    expect(antwoorden[0]).toMatch(/Koppeling weg/);
    expect((await leesDossier(process.env.CLAN_DIR as string, '987654321')).koppelingen).toEqual({});
  });

  it('zegt bij "wie" wat er over een lid bekend is', async () => {
    await koppel(process.env.CLAN_DIR as string, '987654321', '111111111', 'Tess', 'zelf');

    const { interaction, antwoorden } = interactie({
      subcommand: 'wie',
      permissions: PermissionFlagsBits.ManageRoles,
    });
    await execute(interaction);

    expect(antwoorden[0]).toMatch(/Tess/);
  });
});
