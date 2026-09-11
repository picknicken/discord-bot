import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTemplate, type ServerTemplate } from './types.js';

export interface TemplateEntry {
  /** Bestandsnaam zonder .json — dit is wat de gebruiker in het commando kiest. */
  id: string;
  template: ServerTemplate;
}

export async function listTemplateIds(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .sort();
}

export async function loadTemplate(dir: string, id: string): Promise<ServerTemplate> {
  if (!/^[\w-]+$/.test(id)) {
    throw new Error(`Ongeldige template-naam: "${id}"`);
  }
  const file = path.join(dir, `${id}.json`);
  const raw = await readFile(file, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${id}.json bevat geen geldige JSON: ${(error as Error).message}`);
  }
  return parseTemplate(json);
}

export async function loadAllTemplates(dir: string): Promise<TemplateEntry[]> {
  const ids = await listTemplateIds(dir);
  const loaded: TemplateEntry[] = [];
  for (const id of ids) {
    loaded.push({ id, template: await loadTemplate(dir, id) });
  }
  return loaded;
}
