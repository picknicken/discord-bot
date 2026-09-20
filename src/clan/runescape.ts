/**
 * De RuneScape-kant van de bot. Praat met de twee openbare eindpunten van Jagex
 * en zet hun antwoorden om in iets waar de rest van de code mee kan werken.
 *
 * Er is bewust niets van Discord in dit bestand te vinden: dit deel weet alleen
 * wie er in welke clan zit. Wat dat voor iemands rollen betekent staat in
 * rangen.ts, en het daadwerkelijk uitdelen in synchroniseren.ts.
 *
 * Beide eindpunten zijn van het soort dat er al twintig jaar ligt: geen sleutel,
 * geen versienummer, geen belofte. Daarom staat het uitlezen hier los van het
 * ophalen — zo is het te testen zonder internet, en zie je meteen waar het
 * misgaat als Jagex ooit iets verandert.
 */

/** De ledenlijst van een clan, als CSV. */
const LEDEN_URL = 'https://secure.runescape.com/m=clan-hiscores/members_lite.ws';

/** Per speler: in welke clan hij zit. Levert JSONP, geen JSON. */
const SPELER_URL = 'https://services.runescape.com/m=website-data/playerDetails.ws';

export interface ClanLid {
  /** De naam zoals Jagex hem teruggeeft, met gewone spaties. */
  naam: string;
  /** De rang binnen de clan, bijvoorbeeld "Corporal". */
  rang: string;
  totalXp: number;
  kills: number;
}

export interface SpelerDetails {
  naam: string;
  /** De clan waar deze speler in zit, of null als hij nergens bij hoort. */
  clan: string | null;
}

export class RuneScapeFout extends Error {}

/**
 * Namen vergelijken is in RuneScape net iets lastiger dan het lijkt. Jagex zet
 * spaties in de ledenlijst als harde spatie (U+00A0), spelers typen hun naam
 * met een underscore over uit de hiscores, en hoofdletters doen niet mee. Alles
 * gaat hier door dezelfde molen, zodat "Sparc_Mac" en "sparc mac" hetzelfde
 * lid vinden.
 */
export function normaliseerNaam(naam: string): string {
  return naam
    .replace(/[ _+]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Een RuneScape-naam is 1 tot 12 tekens: letters, cijfers, spaties, streepjes. */
export function geldigeNaam(naam: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,11}$/.test(naam.trim());
}

/**
 * De ledenlijst zoals hij binnenkomt:
 *
 *   Clanmate, Clan Rank, Total XP, Kills
 *   Sparc Mac, Owner, 1234567, 12
 *
 * Een clan die niet bestaat levert geen foutcode maar een pagina met
 * "No club was found" erin. Dat is hier dus een fout en geen lege clan — anders
 * zou een typefout in de clannaam eruitzien als een clan waar niemand in zit,
 * en haalt de eerstvolgende synchronisatie iedereen zijn rol af.
 */
export function parseLedenCsv(tekst: string): ClanLid[] {
  const regels = tekst.split(/\r?\n/).filter((regel) => regel.trim() !== '');
  const kop = regels[0] ?? '';

  if (!/^clanmate/i.test(kop.trim())) {
    if (/no club was found|not found/i.test(tekst)) {
      throw new RuneScapeFout('Die clan bestaat niet. Let op hoofdletters en spaties in de clannaam.');
    }
    throw new RuneScapeFout('Onverwacht antwoord van RuneScape — de ledenlijst was niet te lezen.');
  }

  const leden: ClanLid[] = [];

  for (const regel of regels.slice(1)) {
    // Splitsen op komma's en van achteren af lezen: een RuneScape-naam mag geen
    // komma bevatten, maar de kolommen erachter zijn altijd drie getallen. Van
    // achteren beginnen kost niets en gaat niet stuk als Jagex er ooit een
    // kolom bij zet.
    const delen = regel.split(',');
    if (delen.length < 4) continue;

    const kills = Number(delen.pop());
    const totalXp = Number(delen.pop());
    const rang = (delen.pop() ?? '').trim();
    const naam = delen.join(',').replace(/ /g, ' ').trim();

    if (!naam || !rang) continue;
    leden.push({ naam, rang, totalXp: Number.isFinite(totalXp) ? totalXp : 0, kills: Number.isFinite(kills) ? kills : 0 });
  }

  return leden;
}

/**
 * Het antwoord op een spelerlookup is JSONP met een puntkomma erachter:
 *
 *   jQuery([{"isSuffix":true,"name":"Sparc Mac","clan":"Sparc Mac","title":"the Wikian"}]);
 *
 * Een naam die niet bestaat levert een lege lijst; een speler zonder clan
 * levert een regel zonder clan-veld.
 */
export function parseSpelerDetails(tekst: string): SpelerDetails | null {
  const binnenin = tekst.match(/\[[\s\S]*\]/);
  if (!binnenin) throw new RuneScapeFout('Onverwacht antwoord van RuneScape bij het opzoeken van die naam.');

  let rijen: Array<{ name?: string; clan?: string; isSuffix?: boolean }>;
  try {
    rijen = JSON.parse(binnenin[0]) as typeof rijen;
  } catch {
    throw new RuneScapeFout('Onverwacht antwoord van RuneScape bij het opzoeken van die naam.');
  }

  const rij = rijen[0];
  if (!rij?.name) return null;

  return { naam: rij.name.replace(/ /g, ' '), clan: rij.clan?.replace(/ /g, ' ') ?? null };
}

// --- ophalen ---------------------------------------------------------------

/**
 * De ledenlijst van een grote clan is zo een paar honderd regels, en Jagex is er
 * niet snel mee. Een keer per vijf minuten is ruim genoeg: clanrangen veranderen
 * niet per seconde, en zonder deze cache zou elk scherm dat je opent een nieuw
 * verzoek zijn.
 */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { op: number; leden: ClanLid[] }>();

/** Voor tests en voor de knop "opnieuw ophalen" in het dashboard. */
export function leegClanCache(): void {
  cache.clear();
}

export interface OphaalOpties {
  /** Cache overslaan; gebruikt door de knop "opnieuw ophalen". */
  vers?: boolean;
  /** Milliseconden voordat we opgeven. Jagex is traag, maar niet eindeloos. */
  timeout?: number;
  /** Eigen fetch, zodat tests niet het internet op hoeven. */
  fetcher?: typeof fetch;
}

export interface Ledenlijst {
  clan: string;
  leden: ClanLid[];
  /** Wanneer deze lijst bij Jagex is opgehaald. */
  opgehaaldOp: string;
  /** Kwam dit uit de cache, of vers van Jagex? */
  uitCache: boolean;
}

export async function haalLedenlijst(clan: string, opties: OphaalOpties = {}): Promise<Ledenlijst> {
  const naam = clan.trim();
  if (!naam) throw new RuneScapeFout('Geen clannaam opgegeven.');

  const sleutel = normaliseerNaam(naam);
  const bewaard = cache.get(sleutel);
  if (!opties.vers && bewaard && Date.now() - bewaard.op < CACHE_MS) {
    return {
      clan: naam,
      leden: bewaard.leden,
      opgehaaldOp: new Date(bewaard.op).toISOString(),
      uitCache: true,
    };
  }

  const url = `${LEDEN_URL}?clanName=${encodeURIComponent(naam)}`;
  const leden = parseLedenCsv(await haalOp(url, opties));

  cache.set(sleutel, { op: Date.now(), leden });
  return { clan: naam, leden, opgehaaldOp: new Date().toISOString(), uitCache: false };
}

/** In welke clan zit deze speler? Levert null als de naam niet bestaat. */
export async function haalSpeler(naam: string, opties: OphaalOpties = {}): Promise<SpelerDetails | null> {
  const schoon = naam.trim();
  if (!geldigeNaam(schoon)) {
    throw new RuneScapeFout(`"${schoon}" kan geen RuneScape-naam zijn: maximaal 12 tekens, geen leestekens.`);
  }

  const params = new URLSearchParams({
    names: JSON.stringify([schoon]),
    callback: 'jQuery',
    artifact: 'name',
  });

  return parseSpelerDetails(await haalOp(`${SPELER_URL}?${params.toString()}`, opties));
}

async function haalOp(url: string, opties: OphaalOpties): Promise<string> {
  const doe = opties.fetcher ?? fetch;

  let antwoord: Response;
  try {
    antwoord = await doe(url, {
      headers: { 'user-agent': 'discord-setup-bot (clanrangen)' },
      signal: AbortSignal.timeout(opties.timeout ?? 15_000),
    });
  } catch (error) {
    // Een clan-rol die niet uitgedeeld wordt omdat Jagex er even uit ligt is
    // geen bug in deze bot; dat hoort er ook zo te staan.
    const reden = error instanceof Error && error.name === 'TimeoutError' ? 'reageerde niet op tijd' : 'is niet bereikbaar';
    throw new RuneScapeFout(`RuneScape ${reden}. Probeer het zo nog eens.`);
  }

  if (!antwoord.ok) {
    throw new RuneScapeFout(`RuneScape antwoordde met HTTP ${antwoord.status}.`);
  }

  return antwoord.text();
}
