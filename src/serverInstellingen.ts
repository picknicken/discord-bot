import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Wat je per server anders wil, los van welke template erop staat.
 *
 * Nu alleen: of de bot het in de server zegt als die afwijkt van zijn template.
 * Dat melden is nuttig op een server die af is, en vervelend op een server die
 * je aan het verbouwen bent - dan hoor je elke keer wat er "nog niet" staat,
 * terwijl je het zelf net anders hebt bedoeld. Een melding die je elke dag
 * wegklikt is geen melding meer, en dan mis je hem ook op de servers waar hij
 * er wél toe doet.
 *
 * Alles in één bestand naast de rest van de geschiedenis. Een server die er niet
 * in staat krijgt gewoon de standaard, dus er hoeft niets te worden aangemaakt.
 */

export interface ServerInstellingen {
  /** Meldt de bot in deze server dat hij afwijkt van de template? */
  driftMelden: boolean;
}

export const STANDAARD: ServerInstellingen = { driftMelden: true };

const BESTAND = 'server-instellingen.json';

export function schoonInstellingen(waarde: unknown): ServerInstellingen {
  if (typeof waarde !== 'object' || waarde === null) return { ...STANDAARD };
  const ruw = waarde as Record<string, unknown>;

  return {
    driftMelden: typeof ruw['driftMelden'] === 'boolean' ? ruw['driftMelden'] : STANDAARD.driftMelden,
  };
}

export async function leesServerInstellingen(dir: string): Promise<Record<string, ServerInstellingen>> {
  try {
    const ruw = JSON.parse(await readFile(path.join(dir, BESTAND), 'utf8')) as Record<string, unknown>;
    const uit: Record<string, ServerInstellingen> = {};
    for (const [guildId, waarde] of Object.entries(ruw)) uit[guildId] = schoonInstellingen(waarde);
    return uit;
  } catch {
    // Geen bestand of onleesbaar: dan geldt overal de standaard.
    return {};
  }
}

export async function instellingenVan(dir: string, guildId: string): Promise<ServerInstellingen> {
  return (await leesServerInstellingen(dir))[guildId] ?? { ...STANDAARD };
}

/** Eén server bijwerken; de rest blijft staan zoals het stond. */
export async function zetServerInstellingen(
  dir: string,
  guildId: string,
  waarden: Partial<ServerInstellingen>,
): Promise<ServerInstellingen> {
  const alles = await leesServerInstellingen(dir);
  const nieuw = schoonInstellingen({ ...(alles[guildId] ?? STANDAARD), ...waarden });

  alles[guildId] = nieuw;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, BESTAND), JSON.stringify(alles, null, 2));

  return nieuw;
}
