import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LEGE_INSTELLINGEN, parseClanInstellingen, type ClanInstellingen, type Gevonden } from './rangen.js';
import { normaliseerNaam } from './wiseoldman.js';

/**
 * Wat er per server bewaard moet blijven: welke clans meetellen, welke rol bij
 * welke rang hoort, en wie welke OSRS-naam heeft opgegeven.
 *
 * Eén JSON-bestand per server. Geen database: dit is een bot die op één plek
 * draait, het gaat om honderden regels en niet om miljoenen, en een bestand kun
 * je openslaan, kopiëren en met de hand repareren. Wel op dezelfde plek als de
 * back-ups en de geschiedenis, zodat een aangekoppeld volume dit meteen meepakt.
 */

export interface Gekoppeld {
  /** De OSRS-naam, zoals WiseOldMan hem schrijft zodra we hem daar gezien hebben. */
  rsn: string;
  gekoppeldOp: string;
  /** Wie de koppeling maakte: het lid zelf, of een beheerder via het dashboard. */
  door: string;
  /**
   * Waar dit lid voor het laatst gezien is: per gekozen clan zijn rang daar.
   * Staat hier zodat het dashboard iets kan tonen zonder WiseOldMan te bellen.
   */
  gezien: Gevonden[];
  /** Wanneer dat voor het laatst klopte. */
  gezienOp: string | null;
}

export interface ClanDossier {
  guildId: string;
  instellingen: ClanInstellingen;
  /** Op Discord-gebruikers-id. */
  koppelingen: Record<string, Gekoppeld>;
  laatsteSync: string | null;
}

const leegDossier = (guildId: string): ClanDossier => ({
  guildId,
  instellingen: { ...LEGE_INSTELLINGEN, clans: [] },
  koppelingen: {},
  laatsteSync: null,
});

function bestand(dir: string, guildId: string): string {
  // Alleen cijfers: dit wordt een bestandsnaam, dus er mag geen schuine streep
  // of puntje in staan. Geen ondergrens aan de lengte — de demo draait op
  // server-ids als "1", en een korter id maakt het pad niet gevaarlijker.
  if (!/^\d{1,25}$/.test(guildId)) throw new Error(`Ongeldig server-id: "${guildId}"`);
  return path.join(dir, `${guildId}.json`);
}

export async function leesDossier(dir: string, guildId: string): Promise<ClanDossier> {
  // Het pad eerst uitrekenen, buiten de catch: een ongeldig server-id is geen
  // "bestaat nog niet" maar een fout, en die hoort niet als leeg dossier terug
  // te komen.
  const pad = bestand(dir, guildId);

  let ruw: string;
  try {
    ruw = await readFile(pad, 'utf8');
  } catch {
    return leegDossier(guildId);
  }

  try {
    const gelezen = JSON.parse(ruw) as Partial<ClanDossier>;
    return {
      guildId,
      instellingen: parseClanInstellingen(gelezen.instellingen ?? {}),
      koppelingen: gelezen.koppelingen ?? {},
      laatsteSync: gelezen.laatsteSync ?? null,
    };
  } catch (error) {
    // Een stukgelopen bestand stilletjes als "leeg" doorgeven zou betekenen dat
    // de eerstvolgende synchronisatie iedereen zijn rol afneemt. Dan liever hier
    // stoppen met een melding die zegt welk bestand het is.
    throw new Error(
      `Het clanbestand van server ${guildId} is niet te lezen (${(error as Error).message}). ` +
        `Herstel of verwijder ${pad}.`,
    );
  }
}

/** Alle servers waarvoor hier iets is ingesteld. */
export async function lijstDossiers(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((naam) => /^\d{5,25}\.json$/.test(naam))
      .map((naam) => naam.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

/**
 * Lezen, aanpassen, terugschrijven — maar dan één voor één per server. Het
 * dashboard en een lid dat net /clan koppel doet kunnen tegelijk binnenkomen;
 * zonder deze rij overschrijft de laatste de wijziging van de eerste.
 */
const rijen = new Map<string, Promise<unknown>>();

export function wijzigDossier<T>(
  dir: string,
  guildId: string,
  wijziging: (dossier: ClanDossier) => T | Promise<T>,
): Promise<{ dossier: ClanDossier; uitkomst: T }> {
  const vorige = rijen.get(guildId) ?? Promise.resolve();

  const volgende = vorige.then(async () => {
    const dossier = await leesDossier(dir, guildId);
    const uitkomst = await wijziging(dossier);
    await schrijfDossier(dir, dossier);
    return { dossier, uitkomst };
  });

  // Ook een mislukte wijziging mag de rij niet blokkeren voor de volgende.
  rijen.set(
    guildId,
    volgende.catch(() => undefined),
  );

  return volgende;
}

export async function schrijfDossier(dir: string, dossier: ClanDossier): Promise<void> {
  await mkdir(dir, { recursive: true });
  const doel = bestand(dir, dossier.guildId);

  // Eerst ernaast schrijven, dan omklappen. Gaat het proces uit terwijl dit
  // draait, dan staat er nog het oude bestand in plaats van een half bestand —
  // en dat scheelt het verschil tussen "niets veranderd" en "alle koppelingen
  // kwijt".
  const tijdelijk = `${doel}.tmp`;
  await writeFile(tijdelijk, `${JSON.stringify(dossier, null, 2)}\n`, 'utf8');
  await rename(tijdelijk, doel);
}

// --- losse bewerkingen -----------------------------------------------------

export async function zetInstellingen(
  dir: string,
  guildId: string,
  instellingen: ClanInstellingen,
): Promise<ClanDossier> {
  const { dossier } = await wijzigDossier(dir, guildId, (huidig) => {
    huidig.instellingen = instellingen;
  });
  return dossier;
}

export async function koppel(
  dir: string,
  guildId: string,
  discordId: string,
  rsn: string,
  door: string,
): Promise<ClanDossier> {
  const { dossier } = await wijzigDossier(dir, guildId, (huidig) => {
    huidig.koppelingen[discordId] = {
      rsn: rsn.trim(),
      gekoppeldOp: new Date().toISOString(),
      door,
      gezien: [],
      gezienOp: null,
    };
  });
  return dossier;
}

export async function ontkoppel(dir: string, guildId: string, discordId: string): Promise<boolean> {
  const { uitkomst } = await wijzigDossier(dir, guildId, (huidig) => {
    const bestond = discordId in huidig.koppelingen;
    delete huidig.koppelingen[discordId];
    return bestond;
  });
  return uitkomst;
}

/** Na een synchronisatie: bewaar per lid wat we net bij WiseOldMan zagen staan. */
export async function noteerRangen(
  dir: string,
  guildId: string,
  gezien: Array<{ discordId: string; gevonden: Gevonden[]; rsn?: string }>,
  opties: { volledig?: boolean } = {},
): Promise<void> {
  await wijzigDossier(dir, guildId, (huidig) => {
    const nu = new Date().toISOString();
    for (const regel of gezien) {
      const koppeling = huidig.koppelingen[regel.discordId];
      if (!koppeling) continue;
      koppeling.gezien = regel.gevonden;
      koppeling.gezienOp = nu;
      if (regel.rsn) koppeling.rsn = regel.rsn;
    }
    // Eén lid dat /clan koppel doet is geen ronde langs de hele server; dat
    // hoort het scherm niet als "laatst bijgewerkt" te tonen.
    if (opties.volledig !== false) huidig.laatsteSync = nu;
  });
}

/** De koppelingen als platte lijst, zoals het plan ze wil hebben. */
export function koppelingenVan(dossier: ClanDossier): Array<{ discordId: string; rsn: string }> {
  return Object.entries(dossier.koppelingen).map(([discordId, gegevens]) => ({
    discordId,
    rsn: gegevens.rsn,
  }));
}

/** Zit deze OSRS-naam al aan iemand anders vast? */
export function alGekoppeldAan(dossier: ClanDossier, rsn: string, behalve: string): string | null {
  const gezocht = normaliseerNaam(rsn);
  for (const [discordId, gegevens] of Object.entries(dossier.koppelingen)) {
    if (discordId !== behalve && normaliseerNaam(gegevens.rsn) === gezocht) return discordId;
  }
  return null;
}
