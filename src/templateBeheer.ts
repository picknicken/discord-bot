import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { basisVan } from './overerven.js';
import { recordVersion } from './history.js';
import { templateUitJson } from './templates.js';
import type { ServerTemplate } from './types.js';

/**
 * Een template op schijf wegschrijven — de ene plek die dat doet, voor het
 * dashboard en voor MCP allebei. Er is maar één manier waarop een template op
 * deze installatie verandert, en dat is expres: een tweede manier zou hier of
 * daar een keer een andere regel toepassen, en dan is het niet meer waar dat
 * "de template" ergens één ding is.
 *
 * Het id komt uiteindelijk van buiten (een dashboardverzoek, een MCP-tool),
 * dus de tekenset hier is de enige rem tegen een pad dat ergens anders heen
 * wijst dan de templates-map. Geen lijst met wat er niet in mag ("geen ../"),
 * maar een gesloten lijst met wat er wél in mag — die kun je niet vergeten
 * aan te vullen.
 */
export function templatePath(dir: string, id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Ongeldige template-naam: "${id}"`);
  return path.join(dir, `${id}.json`);
}

export async function writeTemplate(dir: string, id: string, template: ServerTemplate): Promise<void> {
  await writeFile(templatePath(dir, id), `${JSON.stringify(template, null, 2)}\n`, 'utf8');
}

/**
 * Bouwt een template op een andere voort, dan slaan we op wat er getypt is en
 * niet wat eruit komt. Het samengevoegde resultaat wegschrijven zou de basis
 * stilletjes uit het bestand halen, en dan is precies het punt van overerven weg.
 */
export async function writeRuw(dir: string, id: string, json: string): Promise<void> {
  await writeFile(templatePath(dir, id), json.endsWith('\n') ? json : `${json}\n`, 'utf8');
}

export function erft(json: string): boolean {
  try {
    return basisVan(JSON.parse(json)) !== null;
  } catch {
    return false;
  }
}

export interface TemplateUpdateResultaat {
  id: string;
  template: ServerTemplate;
}

/**
 * Eén template overschrijven: valideren, de vorige versie bewaren, dan pas
 * schrijven. Dezelfde volgorde als de rest van deze bot bij alles wat iets
 * aanpast — eerst kijken of het klopt, dan een manier terug, dan pas doen.
 */
export async function werkTemplateBij(
  templatesDir: string,
  historyDir: string,
  id: string,
  json: string,
  door?: string,
): Promise<TemplateUpdateResultaat> {
  const template = await templateUitJson(templatesDir, json);

  const previous = await readFile(templatePath(templatesDir, id), 'utf8').catch(() => null);
  if (previous) await recordVersion(historyDir, id, previous, door);

  if (erft(json)) await writeRuw(templatesDir, id, json);
  else await writeTemplate(templatesDir, id, template);

  return { id, template };
}
