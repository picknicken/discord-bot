import { z } from 'zod';
import { netteRang, normaliseerNaam, type WomLid } from './wiseoldman.js';

/**
 * Van clanrang naar Discord-rol. Dit bestand rekent het uit en raakt niets aan:
 * erin gaan de ledenlijsten van de gekozen clans en de koppelingen, eruit komt
 * een lijstje wijzigingen. Precies zoals de rest van deze bot eerst een plan
 * maakt en dat pas daarna uitvoert — je wilt kunnen zien wie welke rol krijgt
 * voordat driehonderd mensen een melding krijgen.
 *
 * Twee dingen zijn met opzet anders dan je misschien verwacht:
 *
 * 1. Er is geen vaste lijst rangen. In OSRS bepaalt elke clan zelf welke rangen
 *    hij gebruikt, en WiseOldMan geeft ze terug zoals ze daar staan. De rangen
 *    die je in het dashboard ziet komen dus uit de ledenlijst van jouw clan.
 * 2. Er is geen volgorde tussen rangen. WiseOldMan zegt nergens dat een Captain
 *    boven een Corporal staat. Elke rang krijgt daarom zijn eigen rol, en wie
 *    een rang heeft waar niets aan gekoppeld is krijgt alleen de clanrol.
 */

const rolId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'Dat is geen rol-id.');

export const clanSchema = z.object({
  /** Het nummer van de group bij WiseOldMan: wiseoldman.net/groups/<dit> */
  groupId: z.number().int().positive(),
  /** De naam zoals hij bij WiseOldMan staat; alleen om te tonen. */
  naam: z.string().trim().max(64).default(''),
  /** Rol voor iedereen in deze clan, ongeacht rang. */
  lidRol: rolId.nullable().default(null),
  /** Per rang van deze clan de rol die daarbij hoort. */
  rangRollen: z.record(z.string(), rolId).default({}),
});

export type ClanKeuze = z.infer<typeof clanSchema>;

export const clanInstellingenSchema = z.object({
  /** De clans die meetellen. Alleen deze; de rest van WiseOldMan doet niet mee. */
  clans: z.array(clanSchema).max(10).default([]),
  /** Rol voor gekoppelde leden die in geen van de gekozen clans zitten. */
  gastRol: rolId.nullable().default(null),
  /** Bijnaam in Discord gelijktrekken met de OSRS-naam. */
  bijnaam: z.boolean().default(false),
  /** Rollen die deze koppeling beheert weer afnemen zodra ze niet meer kloppen. */
  opruimen: z.boolean().default(true),
  /** Elk uur vanzelf bijwerken, zonder dat iemand op een knop drukt. */
  automatisch: z.boolean().default(false),
  /**
   * Nieuwe leden begroeten met de knop "Koppel je OSRS-naam". Zonder dat moet
   * iedereen zelf /clan koppel ontdekken, en dat doet niemand.
   */
  welkom: z.boolean().default(true),
  /**
   * In welk kanaal dat bericht komt. Leeg = het systeemkanaal van de server,
   * en anders het eerste kanaal waar de bot mag praten.
   */
  welkomKanaal: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable().default(null),
});

export type ClanInstellingen = z.infer<typeof clanInstellingenSchema>;

export const LEGE_INSTELLINGEN: ClanInstellingen = clanInstellingenSchema.parse({});

export function parseClanInstellingen(waarde: unknown): ClanInstellingen {
  const uitkomst = clanInstellingenSchema.safeParse(waarde);
  if (uitkomst.success) {
    const nummers = uitkomst.data.clans.map((clan) => clan.groupId);
    if (new Set(nummers).size !== nummers.length) {
      throw new Error('Dezelfde clan staat er twee keer in.');
    }
    return uitkomst.data;
  }
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

/** Wie in Discord hoort bij welke OSRS-naam. */
export interface Koppeling {
  discordId: string;
  rsn: string;
}

/** Een opgehaalde ledenlijst van één gekozen clan. */
export interface Ledenlijst {
  groupId: number;
  naam: string;
  leden: WomLid[];
}

/** Waar iemand gevonden is: in welke clan, met welke rang. */
export interface Gevonden {
  groupId: number;
  clan: string;
  rang: string;
}

export interface Rangwissel {
  discordId: string;
  rsn: string;
  /** De naam zoals Discord hem toont, om het plan leesbaar te houden. */
  weergavenaam: string;
  /** In welke van de gekozen clans deze speler staat, met zijn rang daar. */
  gevonden: Gevonden[];
  /** Rol-ids die erbij komen. */
  erbij: string[];
  /** Rol-ids die eraf gaan. */
  eraf: string[];
  /** Nieuwe bijnaam, of null als die blijft zoals hij is. */
  bijnaamNaar: string | null;
  /** Waar deze persoon staat: "Captain in Mijn Clan", of dat hij nergens staat. */
  staat: string;
  /** Wat er verandert: "krijgt @Captain, verliest @Gast". */
  wijziging: string;
  /** Die twee achter elkaar, voor een lijst waar één regel per persoon past. */
  reden: string;
  /** Waarom dit (deels) niet lukt. Leeg als er niets in de weg staat. */
  problemen: string[];
}

export interface ClanPlanInvoer {
  instellingen: ClanInstellingen;
  koppelingen: Koppeling[];
  /** Per gekozen clan de ledenlijst van WiseOldMan. */
  ledenlijsten: Ledenlijst[];
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
  /** Per clan de leden zonder Discord-koppeling: die missen hun rol dus nog. */
  ongekoppeld: Array<{ groupId: number; clan: string; leden: string[] }>;
  /** Koppelingen van mensen die niet (meer) in de Discord-server zitten. */
  vertrokken: Koppeling[];
  /** Wat er scheef staat aan de instellingen zelf. */
  waarschuwingen: string[];
}

/**
 * Het plan. Per gekoppeld lid: in welke gekozen clans hij staat, welke rollen
 * daarbij horen, en welke daarvan hij nog niet of juist te veel heeft.
 *
 * Staat iemand in twee gekozen clans, dan krijgt hij van allebei de rollen. Dat
 * is de enige regel die zich laat uitleggen zonder voorrangslijstje: elke clan
 * die je hier kiest telt op zichzelf.
 *
 * Eraf gaan alleen rollen die deze koppeling zelf beheert — de rangrollen, de
 * clanrollen en de gastrol. Alle andere rollen blijft hij af. Iemand die naast
 * @Corporal ook @Eventteam heeft, is niet ineens zijn eventrol kwijt omdat hij
 * in de clan promoveerde.
 */
export function planClanRangen(invoer: ClanPlanInvoer): ClanPlan {
  const { instellingen, koppelingen, ledenlijsten, leden, rollen } = invoer;

  // Per clan: de leden op genormaliseerde naam, plus wie we gezien hebben.
  const perClan = instellingen.clans.map((clan) => {
    const lijst = ledenlijsten.find((kandidaat) => kandidaat.groupId === clan.groupId);
    return {
      clan,
      naam: lijst?.naam || clan.naam || `clan ${clan.groupId}`,
      opNaam: new Map((lijst?.leden ?? []).map((lid) => [normaliseerNaam(lid.naam), lid])),
      gebruikt: new Set<string>(),
      gevonden: Boolean(lijst),
    };
  });

  const beheerdeRollen = [
    ...instellingen.clans.flatMap((clan) => [...Object.values(clan.rangRollen), clan.lidRol]),
    instellingen.gastRol,
  ].filter((id): id is string => Boolean(id));

  const waarschuwingen: string[] = [];
  if (instellingen.clans.length === 0) waarschuwingen.push('Er is nog geen clan gekozen.');
  if (beheerdeRollen.length === 0) waarschuwingen.push('Er is nog geen enkele rol aan een clan of rang gekoppeld.');

  for (const regel of perClan) {
    if (!regel.gevonden) waarschuwingen.push(`De ledenlijst van "${regel.naam}" is niet opgehaald.`);
  }

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

    const gezocht = normaliseerNaam(koppeling.rsn);
    const gewenst = new Set<string>();
    const gevonden: Gevonden[] = [];
    let naam = koppeling.rsn;

    for (const regel of perClan) {
      const clanLid = regel.opNaam.get(gezocht);
      if (!clanLid) continue;

      regel.gebruikt.add(gezocht);
      gevonden.push({ groupId: regel.clan.groupId, clan: regel.naam, rang: clanLid.rang });
      // De schrijfwijze van WiseOldMan wint van wat iemand zelf intypte.
      naam = clanLid.naam;

      if (regel.clan.lidRol) gewenst.add(regel.clan.lidRol);
      const rangRol = regel.clan.rangRollen[clanLid.rang];
      if (rangRol) gewenst.add(rangRol);
    }

    if (gevonden.length === 0 && instellingen.gastRol) gewenst.add(instellingen.gastRol);

    const huidig = new Set(lid.rollen);
    const erbij = [...gewenst].filter((id) => !huidig.has(id));
    const eraf = instellingen.opruimen
      ? [...new Set(beheerdeRollen)].filter((id) => huidig.has(id) && !gewenst.has(id))
      : [];

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
      gevonden,
      erbij: [...new Set(erbij)],
      eraf,
      bijnaamNaar,
      ...beschrijf(gevonden, erbij, eraf, bijnaamNaar, rollen),
      problemen: [...new Set(problemen)],
    });
  }

  return {
    wissels,
    ongewijzigd,
    ongekoppeld: perClan
      .filter((regel) => regel.gevonden)
      .map((regel) => ({
        groupId: regel.clan.groupId,
        clan: regel.naam,
        leden: [...regel.opNaam.values()]
          .filter((lid) => !regel.gebruikt.has(normaliseerNaam(lid.naam)))
          .map((lid) => lid.naam),
      }))
      .filter((regel) => regel.leden.length > 0),
    vertrokken,
    waarschuwingen: [...new Set(waarschuwingen)],
  };
}

function beschrijf(
  gevonden: Gevonden[],
  erbij: string[],
  eraf: string[],
  bijnaamNaar: string | null,
  rollen: Map<string, RolInfo>,
): { staat: string; wijziging: string; reden: string } {
  const naam = (id: string) => `@${rollen.get(id)?.naam ?? id}`;
  const delen: string[] = [];

  if (erbij.length > 0) delen.push(`krijgt ${erbij.map(naam).join(', ')}`);
  if (eraf.length > 0) delen.push(`verliest ${eraf.map(naam).join(', ')}`);
  if (bijnaamNaar) delen.push(`bijnaam wordt "${bijnaamNaar}"`);

  const staat =
    gevonden.length > 0
      ? gevonden.map((plek) => `${netteRang(plek.rang)} in ${plek.clan}`).join(' en ')
      : 'in geen van de gekozen clans';

  const wijziging = delen.join(', ');
  return { staat, wijziging, reden: `${staat} — ${wijziging}` };
}

/**
 * Een eerste invulling op basis van de rolnamen die er al staan: een rol die
 * "Deputy owner" of "deputy_owner" heet hoort bij die rang. Scheelt bij een
 * clanserver die al jaren draait een hoop keuzes uit een dropdown.
 */
export function raadRangRollen(rollen: RolInfo[], rangen: string[]): Record<string, string> {
  const gevonden: Record<string, string> = {};

  for (const rang of rangen) {
    const rol = rollen.find(
      (kandidaat) =>
        normaliseerNaam(kandidaat.naam) === normaliseerNaam(rang) ||
        normaliseerNaam(kandidaat.naam) === normaliseerNaam(netteRang(rang)),
    );
    if (rol) gevonden[rang] = rol.id;
  }

  return gevonden;
}
