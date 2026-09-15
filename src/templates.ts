import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTemplate, type ServerTemplate } from './types.js';
import { aangegevenVariabelen, uitlegOntbrekend, vulVariabelenIn } from './variabelen.js';

export interface TemplateEntry {
  /** Bestandsnaam zonder .json — dit is wat de gebruiker in het commando kiest. */
  id: string;
  template: ServerTemplate;
}

/**
 * Zet de meegeleverde templates klaar in een lege map.
 *
 * Nodig zodra de templates ergens anders staan dan in de repo: op een host met
 * een volume begint die map leeg, en dan is er niets om uit te rollen. Alleen
 * als er nog geen enkele template staat — anders zou hij jouw aanpassingen bij
 * elke herstart overschrijven met de originelen.
 */
export async function zaaiTemplates(doel: string, bron = './templates'): Promise<string[]> {
  if (path.resolve(doel) === path.resolve(bron)) return [];

  await mkdir(doel, { recursive: true });
  if ((await listTemplateIds(doel)).length > 0) return [];

  let namen: string[];
  try {
    namen = (await readdir(bron)).filter((naam) => naam.endsWith('.json'));
  } catch {
    return [];
  }

  for (const naam of namen) {
    await copyFile(path.join(bron, naam), path.join(doel, naam));
  }
  return namen.map((naam) => naam.replace(/\.json$/, '')).sort();
}

export async function listTemplateIds(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .sort();
}

/**
 * Laadt een template en vult eerst de variabelen in. Zonder waarden gebruikt hij
 * wat de template zelf als standaard opgeeft; ontbreekt er dan nog iets, dan
 * stopt hij met de vraag welke waarden hij nodig heeft - in plaats van een
 * server met `{{server_naam}}` als kanaalnaam.
 */
export async function loadTemplate(
  dir: string,
  id: string,
  variabelen: Record<string, string> = {},
): Promise<ServerTemplate> {
  const { template } = await loadTemplateMet(dir, id, variabelen);
  return template;
}

export interface GeladenTemplate {
  template: ServerTemplate;
  /** Welke variabelen er zijn ingevuld, en waarmee. */
  gebruikt: Record<string, string>;
  /** Opgegeven waarden die de template niet kent. */
  onbekend: string[];
}

export async function loadTemplateMet(
  dir: string,
  id: string,
  variabelen: Record<string, string> = {},
  opties: { losjes?: boolean } = {},
): Promise<GeladenTemplate> {
  if (!/^[\w-]+$/.test(id)) {
    throw new Error(`Ongeldige template-naam: "${id}"`);
  }

  const file = path.join(dir, `${id}.json`);
  const raw = await readFile(file, 'utf8');
  const ingevuld = vulVariabelenIn(raw, variabelen);

  // Losjes is voor een lijstje op het scherm: dan blijft {{clan}} gewoon staan.
  // Bij het uitrollen mag dat niet - daar moet je weten wat je invult.
  if (ingevuld.ontbrekend.length > 0 && !opties.losjes) {
    throw new Error(uitlegOntbrekend(ingevuld.ontbrekend, aangegevenVariabelen(raw)).join('\n'));
  }

  let json: unknown;
  try {
    json = JSON.parse(ingevuld.json);
  } catch (error) {
    throw new Error(`${id}.json bevat geen geldige JSON: ${(error as Error).message}`);
  }

  return { template: parseTemplate(json), gebruikt: ingevuld.gebruikt, onbekend: ingevuld.onbekend };
}

export async function loadAllTemplates(dir: string): Promise<TemplateEntry[]> {
  const ids = await listTemplateIds(dir);
  const loaded: TemplateEntry[] = [];
  for (const id of ids) {
    loaded.push({ id, template: await loadTemplate(dir, id) });
  }
  return loaded;
}
