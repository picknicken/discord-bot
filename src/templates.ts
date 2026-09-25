import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { basisVan, bouwOp, type Ruw } from './overerven.js';
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

/**
 * De ruwe JSON van één bestand, met de bestandsnaam in de foutmelding. Zonder
 * die naam weet je bij een template die op een andere voortbouwt niet welk van
 * de twee bestanden scheef staat.
 */
async function leesRuw(dir: string, id: string): Promise<Ruw> {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Ongeldige template-naam: "${id}"`);

  let tekst: string;
  try {
    tekst = await readFile(path.join(dir, `${id}.json`), 'utf8');
  } catch {
    throw new Error(`Template "${id}" bestaat niet.`);
  }

  try {
    const data: unknown = JSON.parse(tekst);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('de inhoud is geen object');
    }
    return data as Ruw;
  } catch (error) {
    throw new Error(`${id}.json bevat geen geldige JSON: ${(error as Error).message}`);
  }
}

/**
 * De template met alles wat hij van zijn basis erft er al in verwerkt.
 *
 * Een basis mag zelf ook weer een basis hebben; we lopen de rij van onderaf af en
 * houden bij waar we geweest zijn, want een template die (via via) zichzelf als
 * basis heeft zou anders blijven lezen tot het geheugen op is.
 */
export async function ruweTemplate(dir: string, id: string, gezien: readonly string[] = []): Promise<Ruw> {
  if (gezien.includes(id)) {
    throw new Error(`De basis loopt rond: ${[...gezien, id].join(" -> ")}.`);
  }

  const data = await leesRuw(dir, id);
  return metBasis(dir, data, [...gezien, id]);
}

async function metBasis(dir: string, data: Ruw, gezien: readonly string[]): Promise<Ruw> {
  const basis = basisVan(data);

  if (basis === null) {
    if (data['verwijder'] !== undefined) {
      throw new Error('"verwijder" kan alleen in een template met een "basis": er is anders niets om uit weg te halen.');
    }
    return data;
  }

  return bouwOp(await ruweTemplate(dir, basis, gezien), data);
}

/**
 * Een template uit de editor controleren zonder hem op te slaan: net als bij het
 * laden wordt de basis er eerst bij gezocht, zodat wat je ziet ook is wat er
 * uitgerold wordt.
 */
export async function templateUitJson(dir: string, json: string): Promise<ServerTemplate> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`Dit is geen geldige JSON: ${(error as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Een template hoort een object te zijn.');
  }

  const compleet = await metBasis(dir, data as Ruw, []);
  const ingevuld = vulVariabelenIn(JSON.stringify(compleet, null, 2));
  return parseTemplate(JSON.parse(ingevuld.json));
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
  const opSchijf = await readFile(file, 'utf8');

  // Bouwt deze template op een andere voort, dan voegen we ze eerst samen en gaan
  // we verder met het resultaat. Doet hij dat niet - en dat geldt voor bijna
  // alles - dan blijft het pad precies zoals het was: de tekst van het bestand
  // in, de variabelen erin, en dan pas JSON.
  const erft = /"(basis|verwijder)"\s*:/.test(opSchijf);
  const raw = erft ? JSON.stringify(await metBasis(dir, JSON.parse(opSchijf) as Ruw, [id]), null, 2) : opSchijf;

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

/**
 * Een naam voor een geexporteerde server die als bestandsnaam kan. Een servernaam
 * met alleen emoji of andere tekens houdt niets over; dan wordt het het server-id.
 */
export function exportId(serverNaam: string, serverId: string): string {
  const slug = serverNaam
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `server-${serverId}`;
}

/**
 * Bewaart een export in de templates-map, zodat hij meteen in `/setup list`, de
 * keuzelijst en het dashboard staat. Een bestaande template met dezelfde naam
 * blijft staan: dan krijgt de nieuwe een volgnummer.
 */
export async function bewaarExport(dir: string, basis: string, template: ServerTemplate): Promise<string> {
  await mkdir(dir, { recursive: true });
  const bestaand = new Set(await listTemplateIds(dir));
  let id = basis;
  for (let n = 2; bestaand.has(id); n++) id = `${basis}-${n}`;
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return id;
}
