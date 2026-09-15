import { bedoeldeJe } from './bedoeldeJe.js';

/**
 * Variabelen in een template: `{{server_naam}}` in plaats van een vaste naam.
 *
 * Zo is dezelfde template voor meerdere servers te gebruiken zonder hem te
 * kopieren en met de hand aan te passen. Het invullen gebeurt op de tekst van
 * het bestand, vóór de controle - alles wat daarna komt (rolnamen, topics,
 * berichten, kleuren) ziet dus gewoon de ingevulde waarde, en elke bestaande
 * controle werkt er zonder aanpassing op.
 */

export interface VariabeleSpec {
  beschrijving?: string;
  standaard?: string;
}

export interface Ingevuld {
  json: string;
  /** Wat er uiteindelijk is ingevuld, per naam. */
  gebruikt: Record<string, string>;
  /** Gebruikt in de template, maar geen waarde en geen standaard. */
  ontbrekend: string[];
  /** Opgegeven, maar de template kent ze niet. Met een suggestie erbij. */
  onbekend: string[];
}

const PATROON = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Alle namen die de template gebruikt, in volgorde van voorkomen. */
export function gebruikteVariabelen(json: string): string[] {
  return [...new Set([...json.matchAll(PATROON)].map((match) => match[1] ?? ''))].filter(Boolean);
}

/** De variabelen die de template zelf opgeeft, uit de ruwe JSON. */
export function aangegevenVariabelen(json: string): Record<string, VariabeleSpec> {
  try {
    const data = JSON.parse(json) as { variables?: Record<string, VariabeleSpec> };
    return data.variables ?? {};
  } catch {
    return {};
  }
}

/** Leest "naam=waarde" regels, zoals ze van de commandoregel of uit een veld komen. */
export function leesWaarden(invoer: readonly string[]): Record<string, string> {
  const waarden: Record<string, string> = {};

  for (const regel of invoer) {
    for (const deel of regel.split(',')) {
      const index = deel.indexOf('=');
      if (index <= 0) continue;
      const naam = deel.slice(0, index).trim();
      const waarde = deel.slice(index + 1).trim();
      if (naam !== '') waarden[naam] = waarde;
    }
  }

  return waarden;
}

/**
 * Vult de variabelen in. Waarden gaan door JSON.stringify, zodat een
 * aanhalingsteken of een backslash in een waarde het bestand niet sloopt.
 */
export function vulVariabelenIn(json: string, opgegeven: Record<string, string> = {}): Ingevuld {
  const aangegeven = aangegevenVariabelen(json);
  const gebruikt: Record<string, string> = {};
  const ontbrekend: string[] = [];

  for (const naam of gebruikteVariabelen(json)) {
    const waarde = opgegeven[naam] ?? aangegeven[naam]?.standaard;
    if (waarde === undefined) {
      ontbrekend.push(naam);
      continue;
    }
    gebruikt[naam] = waarde;
  }

  const bekend = new Set([...Object.keys(aangegeven), ...gebruikteVariabelen(json)]);
  const onbekend = Object.keys(opgegeven)
    .filter((naam) => !bekend.has(naam))
    .map((naam) => `${naam}${bedoeldeJe(naam, [...bekend])}`);

  const ingevuld = json.replace(PATROON, (heel, naam: string) => {
    const waarde = gebruikt[naam];
    if (waarde === undefined) return heel;
    // De haakjes eromheen weglaten: we plakken in een bestaande JSON-string.
    return JSON.stringify(waarde).slice(1, -1);
  });

  return { json: ingevuld, gebruikt, ontbrekend, onbekend };
}

/** Eén regel over wat er is ingevuld. */
export function beschrijfVariabelen(gebruikt: Record<string, string>): string {
  const namen = Object.keys(gebruikt);
  if (namen.length === 0) return '';
  return `Variabelen: ${namen.map((naam) => `${naam}="${gebruikt[naam]}"`).join(', ')}.`;
}

/** De melding als er iets niet ingevuld kan worden. */
export function uitlegOntbrekend(
  ontbrekend: readonly string[],
  aangegeven: Record<string, VariabeleSpec>,
): string[] {
  if (ontbrekend.length === 0) return [];

  return [
    `Deze template heeft ${ontbrekend.length === 1 ? 'een waarde' : 'waarden'} nodig: ${ontbrekend.join(', ')}.`,
    ...ontbrekend.map((naam) => {
      const uitleg = aangegeven[naam]?.beschrijving;
      return `  ${naam}${uitleg ? ` — ${uitleg}` : ''}`;
    }),
    'Geef ze mee met --var naam=waarde (in de Action: het veld variabelen).',
  ];
}
