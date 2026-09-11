import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Guild } from 'discord.js';
import { exportGuild } from './exporter.js';
import { parseTemplate, type ServerTemplate } from './types.js';

/**
 * Een momentopname van een server, weggeschreven vlak voor het toepassen van een
 * template. Het is geen volledige tijdmachine — verwijderde kanalen nemen hun
 * berichten mee het graf in — maar de structuur (rollen, kanalen, rechten) kun je
 * er wel mee terugzetten.
 */

export interface BackupEntry {
  file: string;
  guildId: string;
  guildName: string;
  createdAt: string;
  roles: number;
  channels: number;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export async function backupGuild(guild: Guild, dir: string, label = 'auto'): Promise<string> {
  await mkdir(dir, { recursive: true });

  const template = exportGuild(guild, `Back-up van ${guild.name}`);
  const payload = {
    guildId: guild.id,
    guildName: guild.name,
    createdAt: new Date().toISOString(),
    label,
    template,
  };

  const file = path.join(dir, `${guild.id}-${stamp()}.json`);
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}

export async function listBackups(dir: string): Promise<BackupEntry[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }

  const entries: BackupEntry[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as {
        guildId?: string;
        guildName?: string;
        createdAt?: string;
        template?: ServerTemplate;
      };
      entries.push({
        file: name,
        guildId: parsed.guildId ?? '',
        guildName: parsed.guildName ?? '(onbekend)',
        createdAt: parsed.createdAt ?? '',
        roles: parsed.template?.roles.length ?? 0,
        channels:
          (parsed.template?.categories ?? []).reduce((sum, category) => sum + category.channels.length, 0) +
          (parsed.template?.uncategorizedChannels.length ?? 0),
      });
    } catch {
      continue;
    }
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readBackup(dir: string, file: string): Promise<{ guildId: string; template: ServerTemplate }> {
  if (!/^[\w.-]+\.json$/.test(file)) throw new Error(`Ongeldige back-upnaam: "${file}"`);

  const parsed = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as {
    guildId?: string;
    template?: unknown;
  };

  return { guildId: parsed.guildId ?? '', template: parseTemplate(parsed.template) };
}
