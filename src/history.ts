import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Elke keer dat het dashboard een template opslaat, gaat de vorige inhoud hierheen.
 * Zo kun je terug na een bewerking die achteraf niet klopte.
 */

export interface Version {
  stamp: string;
  createdAt: string;
  size: number;
}

const safeId = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Ongeldige template-naam: "${id}"`);
  return id;
};

export async function recordVersion(dir: string, id: string, contents: string): Promise<void> {
  const target = path.join(dir, safeId(id));
  await mkdir(target, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(target, `${stamp}.json`), contents, 'utf8');
}

export async function listVersions(dir: string, id: string): Promise<Version[]> {
  try {
    const names = await readdir(path.join(dir, safeId(id)));
    return names
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({
        stamp: name.replace(/\.json$/, ''),
        createdAt: name.replace(/\.json$/, '').replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z'),
        size: 0,
      }))
      .sort((a, b) => b.stamp.localeCompare(a.stamp));
  } catch {
    return [];
  }
}

export async function readVersion(dir: string, id: string, stamp: string): Promise<string> {
  if (!/^[\w.-]+$/.test(stamp)) throw new Error(`Ongeldige versie: "${stamp}"`);
  return readFile(path.join(dir, safeId(id), `${stamp}.json`), 'utf8');
}
