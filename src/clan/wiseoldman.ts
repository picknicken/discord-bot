/**
 * De OSRS-kant van de bot: WiseOldMan.
 *
 * Old School RuneScape heeft zelf geen clan-API. WiseOldMan wel: daar heet een
 * clan een *group*, en zo'n group heeft een ledenlijst waarin per speler zijn
 * rang staat. Dat is precies wat hier nodig is — wie zit er in welke clan, en
 * met welke rang.
 *
 * Er zit niets van Discord in dit bestand. Het uitlezen staat los van het
 * ophalen, zodat het te testen is zonder internet en het meteen opvalt als
 * WiseOldMan ooit iets anders gaat sturen.
 */

const BASIS = 'https://api.wiseoldman.net/v2';

export interface WomLid {
  /** De naam met hoofdletters, zoals hij in het spel wordt getoond. */
  naam: string;
  /** De rang binnen de clan, zoals WiseOldMan hem opslaat: "deputy_owner". */
  rang: string;
}

export interface WomGroep {
  id: number;
  naam: string;
  leden: WomLid[];
  /** Wanneer deze lijst bij WiseOldMan is opgehaald. */
  opgehaaldOp: string;
  /** Kwam dit uit de cache, of vers van WiseOldMan? */
  uitCache: boolean;
}

/** Een group uit de zoeklijst: genoeg om hem te herkennen en te kiezen. */
export interface WomZoekresultaat {
  id: number;
  naam: string;
  aantal: number;
  /** De clan chat in het spel, als die is ingevuld. Handig om te herkennen. */
  clanChat: string | null;
}

/** Eén clan waar een speler in zit, met zijn rang daar. */
export interface WomSpelerClan {
  groupId: number;
  naam: string;
  rang: string;
}

export class WomFout extends Error {}

/**
 * Namen vergelijken is net iets lastiger dan het lijkt: WiseOldMan schrijft ze
 * in kleine letters, in het spel staan er hoofdletters in, en wie zijn naam uit
 * de hiscores plakt heeft er underscores in staan. Alles gaat hier door dezelfde
 * molen, zodat "Sparc_Mac" en "sparc mac" hetzelfde lid vinden.
 */
export function normaliseerNaam(naam: string): string {
  return naam
    .replace(/[ _+]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Een OSRS-naam is 1 tot 12 tekens: letters, cijfers, spaties, streepjes. */
export function geldigeNaam(naam: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,11}$/.test(naam.trim());
}

/**
 * WiseOldMan slaat rangen op als `deputy_owner`; op het scherm hoort dat
 * "Deputy owner" te zijn. Alleen voor het tonen — opgeslagen wordt altijd de
 * naam zoals WiseOldMan hem geeft, want daar vergelijken we op.
 */
export function netteRang(rang: string): string {
  const woorden = rang.replace(/_/g, ' ').trim();
  return woorden.charAt(0).toUpperCase() + woorden.slice(1);
}

// --- uitlezen --------------------------------------------------------------

/**
 * De group met zijn ledenlijst. WiseOldMan zet de leden onder `memberships`,
 * met de speler in een apart blokje eronder:
 *
 *   { "id": 139, "name": "Mijn Clan",
 *     "memberships": [{ "role": "owner", "player": { "displayName": "Tess" } }] }
 *
 * Een group zonder leden is verdacht genoeg om er een fout van te maken: een
 * lege lijst zou bij de eerstvolgende ronde iedereen zijn rol afnemen.
 */
export function parseGroep(waarde: unknown): { id: number; naam: string; leden: WomLid[] } {
  const groep = waarde as {
    id?: number;
    name?: string;
    memberships?: Array<{ role?: string | null; player?: { displayName?: string; username?: string } }>;
  };

  if (typeof groep?.id !== 'number' || typeof groep.name !== 'string') {
    throw new WomFout('Onverwacht antwoord van WiseOldMan — dit was geen clan.');
  }

  if (!Array.isArray(groep.memberships)) {
    throw new WomFout(`De ledenlijst van "${groep.name}" kwam niet mee uit WiseOldMan.`);
  }

  const leden: WomLid[] = [];
  for (const lidmaatschap of groep.memberships) {
    const naam = lidmaatschap.player?.displayName || lidmaatschap.player?.username;
    if (!naam) continue;
    // Een lid zonder rang bestaat bij WiseOldMan; dat is daar gewoon "member".
    leden.push({ naam: naam.replace(/_/g, ' '), rang: lidmaatschap.role || 'member' });
  }

  return { id: groep.id, naam: groep.name, leden };
}

export function parseZoekresultaat(waarde: unknown): WomZoekresultaat[] {
  if (!Array.isArray(waarde)) throw new WomFout('Onverwacht antwoord van WiseOldMan bij het zoeken.');

  return waarde
    .map((rij) => rij as { id?: number; name?: string; memberCount?: number; clanChat?: string | null })
    .filter((rij) => typeof rij.id === 'number' && typeof rij.name === 'string')
    .map((rij) => ({
      id: rij.id as number,
      naam: rij.name as string,
      aantal: rij.memberCount ?? 0,
      clanChat: rij.clanChat ?? null,
    }));
}

/** In welke clans zit deze speler? Antwoord is een lijst lidmaatschappen. */
export function parseSpelerClans(waarde: unknown): WomSpelerClan[] {
  if (!Array.isArray(waarde)) throw new WomFout('Onverwacht antwoord van WiseOldMan bij het opzoeken van die naam.');

  return waarde
    .map((rij) => rij as { role?: string | null; group?: { id?: number; name?: string } })
    .filter((rij) => typeof rij.group?.id === 'number')
    .map((rij) => ({
      groupId: rij.group?.id as number,
      naam: rij.group?.name ?? 'onbekende clan',
      rang: rij.role || 'member',
    }));
}

// --- ophalen ---------------------------------------------------------------

/**
 * Een ledenlijst van een grote clan is zo een paar honderd regels, en
 * WiseOldMan laat zonder sleutel maar twintig verzoeken per minuut toe. Een keer
 * per vijf minuten is ruim genoeg: rangen veranderen niet per seconde, en zonder
 * deze cache zou elk scherm dat je opent een nieuw verzoek zijn.
 */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<number, { op: number; groep: { id: number; naam: string; leden: WomLid[] } }>();

/** Voor tests en voor de knop "opnieuw ophalen" in het dashboard. */
export function leegClanCache(): void {
  cache.clear();
}

export interface OphaalOpties {
  /** Cache overslaan; gebruikt door de knop "opnieuw ophalen". */
  vers?: boolean;
  /** Milliseconden voordat we opgeven. */
  timeout?: number;
  /** Eigen fetch, zodat tests niet het internet op hoeven. */
  fetcher?: typeof fetch;
}

export async function haalGroep(groupId: number, opties: OphaalOpties = {}): Promise<WomGroep> {
  if (!Number.isInteger(groupId) || groupId <= 0) throw new WomFout('Dat is geen clan-nummer.');

  const bewaard = cache.get(groupId);
  if (!opties.vers && bewaard && Date.now() - bewaard.op < CACHE_MS) {
    return { ...bewaard.groep, opgehaaldOp: new Date(bewaard.op).toISOString(), uitCache: true };
  }

  const groep = parseGroep(await haalOp(`${BASIS}/groups/${groupId}`, opties));

  cache.set(groupId, { op: Date.now(), groep });
  return { ...groep, opgehaaldOp: new Date().toISOString(), uitCache: false };
}

/** Clans zoeken op naam, zodat niemand een nummer hoeft op te zoeken. */
export async function zoekGroepen(naam: string, opties: OphaalOpties = {}): Promise<WomZoekresultaat[]> {
  const gezocht = naam.trim();
  if (!gezocht) throw new WomFout('Geef een naam op om op te zoeken.');

  const params = new URLSearchParams({ name: gezocht, limit: '10' });
  return parseZoekresultaat(await haalOp(`${BASIS}/groups?${params.toString()}`, opties));
}

export async function haalSpelerClans(naam: string, opties: OphaalOpties = {}): Promise<WomSpelerClan[]> {
  const schoon = naam.trim();
  if (!geldigeNaam(schoon)) {
    throw new WomFout(`"${schoon}" kan geen OSRS-naam zijn: maximaal 12 tekens, geen leestekens.`);
  }

  return parseSpelerClans(await haalOp(`${BASIS}/players/${encodeURIComponent(schoon)}/groups`, opties));
}

async function haalOp(url: string, opties: OphaalOpties): Promise<unknown> {
  const doe = opties.fetcher ?? fetch;

  const headers: Record<string, string> = { 'user-agent': 'discord-setup-bot (clanrangen)' };
  // Zonder sleutel mag je twintig verzoeken per minuut, met sleutel meer.
  // WiseOldMan geeft die uit in hun Discord; zonder werkt alles ook.
  const sleutel = (process.env.WOM_API_KEY ?? '').trim();
  if (sleutel) headers['x-api-key'] = sleutel;

  let antwoord: Response;
  try {
    antwoord = await doe(url, { headers, signal: AbortSignal.timeout(opties.timeout ?? 15_000) });
  } catch (error) {
    // Een clanrol die niet uitgedeeld wordt omdat WiseOldMan er even uit ligt is
    // geen bug in deze bot; dat hoort er ook zo te staan.
    const reden = error instanceof Error && error.name === 'TimeoutError' ? 'reageerde niet op tijd' : 'is niet bereikbaar';
    throw new WomFout(`WiseOldMan ${reden}. Probeer het zo nog eens.`);
  }

  if (antwoord.status === 404) throw new WomFout('WiseOldMan kent die clan of naam niet.');
  if (antwoord.status === 429) {
    throw new WomFout(
      'WiseOldMan laat even geen verzoeken meer toe (te veel achter elkaar). Probeer het over een minuut nog eens.',
    );
  }
  if (!antwoord.ok) throw new WomFout(`WiseOldMan antwoordde met HTTP ${antwoord.status}.`);

  try {
    return await antwoord.json();
  } catch {
    throw new WomFout('WiseOldMan stuurde iets terug dat geen JSON was.');
  }
}
