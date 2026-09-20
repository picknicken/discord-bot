import { z } from 'zod';
import { normaliseerNaam, type ClanLid } from './runescape.js';

/**
 * Van clanrang naar Discord-rol. Dit bestand rekent het uit en raakt niets aan:
 * er gaat een ledenlijst en een stel koppelingen in, en er komt een lijstje
 * wijzigingen uit. Precies zoals de rest van deze bot eerst een plan maakt en
 * dat pas daarna uitvoert — je wilt kunnen zien wie welke rol krijgt voordat
 * driehonderd mensen een melding krijgen.
 */

/**
 * De rangen van een RuneScape 3-clan, van hoog naar laag. Dit zijn de namen
 * die Jagex zelf teruggeeft in de ledenlijst; ze staan hier in volgorde zodat
 * het dashboard ze in de juiste volgorde kan tonen en "hoogste rang wint" iets
 * betekent.
 */
export const CLAN_RANGEN = [
  'Owner',
  'Deputy Owner',
  'Overseer',
  'Coordinator',
  'Organiser',
  'Admin',
  'General',
  'Captain',
  'Lieutenant',
  'Sergeant',
  'Corporal',
  'Recruit',
] as const;

export type ClanRang = (typeof CLAN_RANGEN)[number];

/** Hoe hoog een rang staat; hoger getal is hoger in de clan. Onbekend = -1. */
export function rangHoogte(rang: string): number {
  const index = CLAN_RANGEN.findIndex((bekend) => bekend.toLowerCase() === rang.trim().toLowerCase());
  return index === -1 ? -1 : CLAN_RANGEN.length - index;
}

/**
 * Een rol-id is bij Discord een snowflake: alleen cijfers. Strenger dan "geen
 * rare tekens" is het hier niet, want de demo draait op verzonnen ids als "r1"
 * en dat scherm moet gewoon te bedienen zijn.
 */
const rolId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'Dat is geen rol-id.');

export const clanInstellingenSchema = z.object({
  /** De clan waar deze server bij hoort. Leeg = nog niets ingesteld. */
  clan: z.string().trim().max(64).default(''),
  /** Per clanrang de rol die daarbij hoort. Rangen zonder rol worden overgeslagen. */
  rangRollen: z
    .record(z.string(), rolId)
    .default({})
    .superRefine((rollen, ctx) => {
      for (const rang of Object.keys(rollen)) {
        if (rangHoogte(rang) === -1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Onbekende clanrang: "${rang}"` });
        }
      }
    }),
  /** Rol voor iedereen die in de clan zit, ongeacht rang. Bijvoorbeeld @Clanlid. */
  lidRol: rolId.nullable().default(null),
  /** Rol voor gekoppelde leden die (nog) niet in de clan zitten. Bijvoorbeeld @Gast. */
  gastRol: rolId.nullable().default(null),
  /** Bijnaam in Discord gelijktrekken met de RuneScape-naam. */
  bijnaam: z.boolean().default(false),
  /** Rollen die deze koppeling beheert weer afnemen zodra ze niet meer kloppen. */
  opruimen: z.boolean().default(true),
  /** Elk uur vanzelf bijwerken, zonder dat iemand op een knop drukt. */
  automatisch: z.boolean().default(false),
});

export type ClanInstellingen = z.infer<typeof clanInstellingenSchema>;

export const LEGE_INSTELLINGEN: ClanInstellingen = clanInstellingenSchema.parse({});

export function parseClanInstellingen(waarde: unknown): ClanInstellingen {
  const uitkomst = clanInstellingenSchema.safeParse(waarde);
  if (uitkomst.success) return uitkomst.data;
  throw new Error(uitkomst.error.issues.map((issue) => issue.message).join('; '));
}

/** Een Discord-lid zoals dit bestand het nodig heeft. */
export interface DiscordLid {
  id: string;
  naam: string;
  bijnaam: string | null;
  rollen: string[];
  /**
   * Of de bot dit lid mag aanpassen. De eigenaar van een server en iedereen met
   * een rol boven de bot vallen buiten zijn bereik — dat is geen fout van ons,
   * maar het hoort wel in het plan te staan.
   */
  beheerbaar: boolean;
}

export interface RolInfo {
  id: string;
  naam: string;
  /** Of de bot deze rol mag uitdelen: hij moet onder de hoogste rol van de bot staan. */
  beheerbaar: boolean;
}

/** Wie in Discord hoort bij welke RuneScape-naam. */
export interface Koppeling {
  discordId: string;
  rsn: string;
}

export interface Rangwissel {
  discordId: string;
  rsn: string;
  /** De naam zoals Discord hem toont, om het plan leesbaar te houden. */
  weergavenaam: string;
  /** Zit deze speler in de ingestelde clan? */
  inClan: boolean;
  /** De clanrang, of null als hij niet in de clan zit. */
  rang: string | null;
  /** Rol-ids die erbij komen. */
  erbij: string[];
  /** Rol-ids die eraf gaan. */
  eraf: string[];
  /** Nieuwe bijnaam, of null als die blijft zoals hij is. */
  bijnaamNaar: string | null;
  /** Eén regel over wat er met deze persoon gebeurt. */
  reden: string;
  /** Waarom dit (deels) niet lukt. Leeg als er niets in de weg staat. */
  problemen: string[];
}

export interface ClanPlanInvoer {
  instellingen: ClanInstellingen;
  koppelingen: Koppeling[];
  clanLeden: ClanLid[];
  /** De leden van de Discord-server, op id. Wie ontbreekt is de server uit. */
  leden: Map<string, DiscordLid>;
  /** De rollen van de server, op id. */
  rollen: Map<string, RolInfo>;
}

export interface ClanPlan {
  /** Alleen de mensen bij wie er echt iets verandert. */
  wissels: Rangwissel[];
  /** Gekoppelde leden waar niets aan hoeft te veranderen. */
  ongewijzigd: number;
  /** Clanleden zonder Discord-koppeling: die missen hun rol dus nog. */
  ongekoppeld: ClanLid[];
  /** Koppelingen van mensen die niet (meer) in de Discord-server zitten. */
  vertrokken: Koppeling[];
  /** Wat er scheef staat aan de instellingen zelf. */
  waarschuwingen: string[];
}

/**
 * Het plan. Per gekoppeld lid: welke rol hoort erbij, welke rollen mogen eraf.
 *
 * Eraf gaan alleen rollen die deze koppeling zelf beheert — de rangrollen, de
 * lidrol en de gastrol. Alle andere rollen blijft hij af. Iemand die naast
 * @Corporal ook @Eventteam heeft, is niet ineens zijn eventrol kwijt omdat hij
 * in de clan promoveerde.
 */
export function planClanRangen(invoer: ClanPlanInvoer): ClanPlan {
  const { instellingen, koppelingen, clanLeden, leden, rollen } = invoer;

  const opNaam = new Map(clanLeden.map((lid) => [normaliseerNaam(lid.naam), lid]));
  const gebruikt = new Set<string>();

  const beheerdeRollen = [
    ...Object.values(instellingen.rangRollen),
    instellingen.lidRol,
    instellingen.gastRol,
  ].filter((id): id is string => Boolean(id));

  const waarschuwingen: string[] = [];
  if (!instellingen.clan) waarschuwingen.push('Er is nog geen clan ingesteld.');
  if (beheerdeRollen.length === 0) waarschuwingen.push('Er is nog geen enkele rang aan een rol gekoppeld.');

  for (const id of new Set(beheerdeRollen)) {
    const rol = rollen.get(id);
    if (!rol) {
      waarschuwingen.push(`Een gekoppelde rol bestaat niet meer in deze server (${id}).`);
    } else if (!rol.beheerbaar) {
      waarschuwingen.push(`De bot kan "${rol.naam}" niet uitdelen: die rol staat boven zijn eigen rol.`);
    }
  }

  const wissels: Rangwissel[] = [];
  const vertrokken: Koppeling[] = [];
  let ongewijzigd = 0;

  for (const koppeling of koppelingen) {
    const lid = leden.get(koppeling.discordId);
    if (!lid) {
      vertrokken.push(koppeling);
      continue;
    }

    const clanLid = opNaam.get(normaliseerNaam(koppeling.rsn));
    if (clanLid) gebruikt.add(normaliseerNaam(clanLid.naam));

    const gewenst = new Set<string>();
    if (clanLid) {
      const rangRol = instellingen.rangRollen[pasendeRang(clanLid.rang, instellingen)];
      if (rangRol) gewenst.add(rangRol);
      if (instellingen.lidRol) gewenst.add(instellingen.lidRol);
    } else if (instellingen.gastRol) {
      gewenst.add(instellingen.gastRol);
    }

    const huidig = new Set(lid.rollen);
    const erbij = [...gewenst].filter((id) => !huidig.has(id));
    const eraf = instellingen.opruimen
      ? beheerdeRollen.filter((id) => huidig.has(id) && !gewenst.has(id))
      : [];

    // De naam uit de ledenlijst wint van wat iemand zelf intypte: Jagex weet
    // beter hoe de hoofdletters staan dan de haast van een nieuw lid.
    const naam = clanLid?.naam ?? koppeling.rsn;
    const bijnaamNaar = instellingen.bijnaam && lid.bijnaam !== naam ? naam : null;

    if (erbij.length === 0 && eraf.length === 0 && bijnaamNaar === null) {
      ongewijzigd += 1;
      continue;
    }

    const problemen: string[] = [];
    if (!lid.beheerbaar) {
      problemen.push('de bot kan dit lid niet aanpassen (eigenaar, of een rol boven de bot)');
    }
    for (const id of [...erbij, ...eraf]) {
      const rol = rollen.get(id);
      if (!rol) problemen.push(`rol ${id} bestaat niet meer`);
      else if (!rol.beheerbaar) problemen.push(`"${rol.naam}" staat boven de bot`);
    }

    wissels.push({
      discordId: lid.id,
      rsn: naam,
      weergavenaam: lid.bijnaam || lid.naam,
      inClan: Boolean(clanLid),
      rang: clanLid?.rang ?? null,
      erbij: [...new Set(erbij)],
      eraf: [...new Set(eraf)],
      bijnaamNaar,
      reden: beschrijf(clanLid?.rang ?? null, erbij, eraf, bijnaamNaar, rollen),
      problemen: [...new Set(problemen)],
    });
  }

  return {
    wissels,
    ongewijzigd,
    ongekoppeld: clanLeden.filter((lid) => !gebruikt.has(normaliseerNaam(lid.naam))),
    vertrokken,
    waarschuwingen: [...new Set(waarschuwingen)],
  };
}

/**
 * De rang waarvan de rol gepakt wordt. Staat er voor de eigen rang geen rol
 * ingesteld, dan zakt hij door naar de eerstvolgende lagere rang die er wél een
 * heeft. Een clan die alleen @Lid en @Leiding uitdeelt hoeft zo niet alle twaalf
 * rangen in te vullen, en een Corporal blijft niet zonder rol staan.
 */
function pasendeRang(rang: string, instellingen: ClanInstellingen): string {
  const eigen = CLAN_RANGEN.find((bekend) => bekend.toLowerCase() === rang.trim().toLowerCase());
  if (!eigen) return rang;

  const vanaf = CLAN_RANGEN.indexOf(eigen);
  for (const kandidaat of CLAN_RANGEN.slice(vanaf)) {
    if (instellingen.rangRollen[kandidaat]) return kandidaat;
  }
  return eigen;
}

function beschrijf(
  rang: string | null,
  erbij: string[],
  eraf: string[],
  bijnaamNaar: string | null,
  rollen: Map<string, RolInfo>,
): string {
  const naam = (id: string) => rollen.get(id)?.naam ?? id;
  const delen: string[] = [];

  if (erbij.length > 0) delen.push(`krijgt ${erbij.map(naam).map((n) => `@${n}`).join(', ')}`);
  if (eraf.length > 0) delen.push(`verliest ${eraf.map(naam).map((n) => `@${n}`).join(', ')}`);
  if (bijnaamNaar) delen.push(`bijnaam wordt "${bijnaamNaar}"`);

  const staat = rang ? `${rang} in de clan` : 'niet in de clan';
  return `${staat} — ${delen.join(', ')}`;
}

/**
 * Een eerste invulling op basis van de rolnamen die er al staan: een rol die
 * "Corporal" heet hoort bij de rang Corporal. Scheelt bij een clanserver die al
 * jaren draait twaalf keuzes uit een dropdown.
 */
export function raadRangRollen(rollen: RolInfo[]): Record<string, string> {
  const gevonden: Record<string, string> = {};

  for (const rang of CLAN_RANGEN) {
    const rol = rollen.find((kandidaat) => normaliseerNaam(kandidaat.naam) === normaliseerNaam(rang));
    if (rol) gevonden[rang] = rol.id;
  }

  return gevonden;
}
