import { describe, expect, it } from 'vitest';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits, PermissionsBitField, type ChatInputCommandInteraction } from 'discord.js';

const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-cmd-'));
copyFileSync('./templates/community.json', path.join(werkmap, 'community.json'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.TEMPLATES_DIR = werkmap;
process.env.GUILD_IDS = 'mag-wel';

const { execute } = await import('../src/commands/setup.js');

/** Een nagebootst commando; we kijken alleen naar het antwoord dat eruit komt. */
function interactie(options: { guildId: string; permissions: bigint; subcommand: string }) {
  const antwoorden: string[] = [];

  return {
    antwoorden,
    interaction: {
      inGuild: () => true,
      guild: { id: options.guildId, name: 'Testserver' },
      guildId: options.guildId,
      memberPermissions: new PermissionsBitField(options.permissions),
      options: { getSubcommand: () => options.subcommand },
      reply: async ({ content }: { content: string }) => {
        antwoorden.push(content);
      },
      deferReply: async () => undefined,
      editReply: async ({ content }: { content?: string }) => {
        antwoorden.push(content ?? '(embed)');
      },
    } as unknown as ChatInputCommandInteraction,
  };
}

describe('/setup laat niet iedereen erbij', () => {
  it('weigert iemand zonder "Server beheren"', async () => {
    const { interaction, antwoorden } = interactie({
      guildId: 'mag-wel',
      permissions: PermissionFlagsBits.SendMessages,
      subcommand: 'apply',
    });

    await execute(interaction);
    expect(antwoorden[0]).toMatch(/Alleen beheerders/);
  });

  it('weigert een server die niet op de lijst staat', async () => {
    const { interaction, antwoorden } = interactie({
      guildId: 'mag-niet',
      permissions: PermissionFlagsBits.ManageGuild,
      subcommand: 'preview',
    });

    await execute(interaction);
    expect(antwoorden[0]).toMatch(/staat niet in de lijst/);
  });

  it('laat de templatelijst wel aan iedereen zien', async () => {
    const { interaction, antwoorden } = interactie({
      guildId: 'mag-niet',
      permissions: PermissionFlagsBits.SendMessages,
      subcommand: 'list',
    });

    await execute(interaction);
    expect(antwoorden.join(' ')).not.toMatch(/Alleen beheerders|staat niet in de lijst/);
  });
});
