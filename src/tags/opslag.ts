import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EmbedVelden } from '../embedVelden.js';

/**
 * Eigen commando's per server: `/tag maak regels` legt vast wat `/tag toon
 * regels` daarna laat zien. Zoals de custom commands van Dyno of MEE6, maar
 * als slash-commando in plaats van een prefix in de chat - dat werkt ook in
 * een server zonder de Message Content Intent aan.
 *
 * Eén JSON-bestand per server, net als de clandossiers: geen database nodig
 * voor een paar tientallen tags, en een bestand kun je met de hand repareren
 * als dat ooit moet.
 */

export interface TagDefinitie extends EmbedVelden {
  naam: string;
  /** Losse tekst boven de embed, of het hele bericht als er geen embedvelden zijn. */
  tekst: string | null;
  gemaaktDoor: string;
  gemaaktOp: string;
  bijgewerktOp: string;
}

export interface TagDossier {
  guildId: string;
  tags: Record<string, TagDefinitie>;
}

const leegDossier = (guildId: string): TagDossier => ({ guildId, tags: {} });

/** Eén woord, geen leestekens: dit wordt zowel een sleutel als iets dat je typt achter `/tag toon`. */
const NAAM_PATROON = /^[a-z0-9-]{1,32}$/;

export function normaliseerTagNaam(naam: string): string {
  return naam.trim().toLowerCase().replace(/\s+/g, '-');
}

export function geldigeTagNaam(naam: string): boolean {
  return NAAM_PATROON.test(normaliseerTagNaam(naam));
}

function bestand(dir: string, guildId: string): string {
  if (!/^\d{1,25}$/.test(guildId)) throw new Error(`Ongeldig server-id: "${guildId}"`);
  return path.join(dir, `${guildId}.json`);
}

export async function leesTagDossier(dir: string, guildId: string): Promise<TagDossier> {
  const pad = bestand(dir, guildId);

  let ruw: string;
  try {
    ruw = await readFile(pad, 'utf8');
  } catch {
    return leegDossier(guildId);
  }

  try {
    const gelezen = JSON.parse(ruw) as Partial<TagDossier>;
    return { guildId, tags: gelezen.tags ?? {} };
  } catch (error) {
    throw new Error(
      `Het tag-bestand van server ${guildId} is niet te lezen (${(error as Error).message}). ` +
        `Herstel of verwijder ${pad}.`,
    );
  }
}

export async function schrijfTagDossier(dir: string, dossier: TagDossier): Promise<void> {
  await mkdir(dir, { recursive: true });
  const doel = bestand(dir, dossier.guildId);
  const tijdelijk = `${doel}.tmp`;
  await writeFile(tijdelijk, `${JSON.stringify(dossier, null, 2)}\n`, 'utf8');
  await rename(tijdelijk, doel);
}

/** Lezen, aanpassen, terugschrijven - één voor één per server, zodat twee gelijktijdige `/tag maak` elkaar niet overschrijven. */
const rijen = new Map<string, Promise<unknown>>();

export function wijzigTagDossier<T>(
  dir: string,
  guildId: string,
  wijziging: (dossier: TagDossier) => T,
): Promise<{ dossier: TagDossier; uitkomst: T }> {
  const vorige = rijen.get(guildId) ?? Promise.resolve();

  const volgende = vorige.then(async () => {
    const dossier = await leesTagDossier(dir, guildId);
    const uitkomst = wijziging(dossier);
    await schrijfTagDossier(dir, dossier);
    return { dossier, uitkomst };
  });

  rijen.set(
    guildId,
    volgende.catch(() => undefined),
  );

  return volgende;
}

export async function zetTag(
  dir: string,
  guildId: string,
  naam: string,
  velden: Omit<TagDefinitie, 'naam' | 'gemaaktDoor' | 'gemaaktOp' | 'bijgewerktOp'>,
  door: string,
): Promise<{ was: boolean }> {
  const sleutel = normaliseerTagNaam(naam);
  const { uitkomst } = await wijzigTagDossier(dir, guildId, (dossier) => {
    const bestaand = dossier.tags[sleutel];
    dossier.tags[sleutel] = {
      ...velden,
      naam: sleutel,
      gemaaktDoor: bestaand?.gemaaktDoor ?? door,
      gemaaktOp: bestaand?.gemaaktOp ?? new Date().toISOString(),
      bijgewerktOp: new Date().toISOString(),
    };
    return { was: bestaand !== undefined };
  });
  return uitkomst;
}

export async function verwijderTag(dir: string, guildId: string, naam: string): Promise<boolean> {
  const sleutel = normaliseerTagNaam(naam);
  const { uitkomst } = await wijzigTagDossier(dir, guildId, (dossier) => {
    const bestond = sleutel in dossier.tags;
    delete dossier.tags[sleutel];
    return bestond;
  });
  return uitkomst;
}
