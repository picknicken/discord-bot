import type { Guild } from 'discord.js';
import { geldigeNaam, haalSpelerClans, netteRang, normaliseerNaam, WomFout } from './wiseoldman.js';
import { alGekoppeldAan, koppel, leesDossier } from './opslag.js';
import { synchroniseerServer } from './synchroniseren.js';
import { logger } from '../util/logger.js';

/**
 * Eén naam koppelen en er meteen de juiste rollen bij zetten.
 *
 * Staat hier apart omdat het langs twee wegen binnenkomt: `/clan koppel` en de
 * knop "Koppel je OSRS-naam" die nieuwe leden krijgen. Die twee horen precies
 * hetzelfde te doen en hetzelfde te antwoorden — anders krijgt de helft van je
 * server een ander verhaal te horen dan de andere helft.
 */

export interface KoppelVerzoek {
  clanDir: string;
  guild: Guild;
  discordId: string;
  rsn: string;
  /** Wie de koppeling maakte: "zelf" of de naam van een beheerder. */
  door: string;
}

export interface KoppelUitkomst {
  /** Het antwoord voor degene die het vroeg, klaar om te tonen. */
  bericht: string;
  /** Of de naam is opgeslagen. Bij een afgekeurde naam gebeurt er niets. */
  gekoppeld: boolean;
  /** Of deze speler in een van de gekozen clans staat. */
  inClan: boolean;
}

export async function koppelEnMeld(verzoek: KoppelVerzoek): Promise<KoppelUitkomst> {
  const { clanDir, guild, discordId, door } = verzoek;
  const rsn = verzoek.rsn.trim();

  if (!geldigeNaam(rsn)) {
    return {
      bericht: `"${rsn}" kan geen OSRS-naam zijn: maximaal 12 tekens, alleen letters, cijfers, spaties en streepjes.`,
      gekoppeld: false,
      inClan: false,
    };
  }

  const dossier = await leesDossier(clanDir, guild.id);

  const bezet = alGekoppeldAan(dossier, rsn, discordId);
  if (bezet) {
    // Twee mensen op dezelfde naam betekent dat de een de rol van de ander
    // krijgt. Dat moet een beheerder oplossen, niet een van de twee.
    return {
      bericht: `"${rsn}" staat al gekoppeld aan <@${bezet}>. Klopt dat niet? Vraag een beheerder om het recht te zetten.`,
      gekoppeld: false,
      inClan: false,
    };
  }

  await koppel(clanDir, guild.id, discordId, rsn, door);

  if (dossier.instellingen.clans.length === 0) {
    return {
      bericht: `Genoteerd: **${rsn}**. Er is voor deze server nog geen clan gekozen, dus er is nog geen rol aan te geven.`,
      gekoppeld: true,
      inClan: false,
    };
  }

  return { ...(await werkBij(clanDir, guild, discordId, rsn)), gekoppeld: true };
}

/** Eén lid bijwerken en er een leesbare zin over teruggeven. */
export async function werkBij(
  clanDir: string,
  guild: Guild,
  discordId: string,
  rsn: string,
): Promise<{ bericht: string; inClan: boolean }> {
  let uitkomst;
  try {
    uitkomst = await synchroniseerServer(clanDir, guild, {
      alleen: [discordId],
      reden: 'Clanrol bijgewerkt na koppelen',
    });
  } catch (error) {
    if (error instanceof WomFout) {
      return { bericht: `Genoteerd, maar WiseOldMan antwoordde niet: ${error.message}`, inClan: false };
    }
    throw error;
  }

  const gezocht = normaliseerNaam(rsn);

  // Waar hij staat en met welke rang. Dit lezen we uit de ledenlijsten zelf en
  // niet uit het plan: staat er niets te veranderen, dan is er ook geen plan —
  // en dan wil je nog steeds horen wat je rang is.
  const staatIn = uitkomst.groepen.flatMap((groep) => {
    const lid = groep.leden.find((kandidaat) => normaliseerNaam(kandidaat.naam) === gezocht);
    return lid ? [{ groupId: groep.id, clan: groep.naam, rang: lid.rang }] : [];
  });

  if (staatIn.length === 0) {
    return {
      bericht: await buitenDeClans(rsn, uitkomst.groepen.map((groep) => groep.naam)),
      inClan: false,
    };
  }

  // "Tess staat in Mijn Clan als Captain." — eerst waar je staat, dan pas wat
  // dat voor je rollen betekent.
  const regels = [
    `**${rsn}** staat in ` +
      staatIn.map((plek) => `**${plek.clan}** als **${netteRang(plek.rang)}**`).join(' en ') +
      '.',
  ];

  const wissel = uitkomst.plan.wissels[0];

  if (wissel?.wijziging) {
    regels.push(wissel.wijziging.charAt(0).toUpperCase() + wissel.wijziging.slice(1) + '.');
  } else {
    // Niets te doen kan twee dingen betekenen, en het verschil is nogal groot:
    // je hebt de goede rollen al, óf er hangt hier nog helemaal geen rol aan
    // jouw rang. Dat tweede als "klopt al" verkopen is ronduit misleidend.
    const instellingen = (await leesDossier(clanDir, guild.id)).instellingen;

    const rollenVoorHem = staatIn.flatMap((plek) => {
      const clan = instellingen.clans.find((kandidaat) => kandidaat.groupId === plek.groupId);
      return [clan?.lidRol, clan?.rangRollen[plek.rang]].filter(Boolean);
    });

    regels.push(
      rollenVoorHem.length > 0
        ? 'Je rollen klopten al.'
        : 'Aan die rang hangt hier nog geen Discord-rol. Een beheerder koppelt die in het dashboard, onder Clan.',
    );
  }

  if (uitkomst.mislukt > 0) regels.push(`Let op: ${uitkomst.fouten[0] ?? 'aanpassen mislukte'}`);

  return { bericht: regels.join('\n'), inClan: true };
}

/**
 * Wie niet gevonden is wil vooral weten waarom. WiseOldMan weet in welke clans
 * iemand wél zit; dat scheelt het verschil tussen "je naam staat verkeerd" en
 * "je zit in een clan die hier niet meetelt". De naam blijft gekoppeld — dan
 * weet je later alsnog wie wie is, en telt hij vanzelf mee zodra hij lid wordt.
 */
async function buitenDeClans(rsn: string, gekozen: string[]): Promise<string> {
  const waar = gekozen.length === 1 ? gekozen[0] : `een van deze clans: ${gekozen.join(', ')}`;

  let elders: Awaited<ReturnType<typeof haalSpelerClans>> = [];
  try {
    elders = await haalSpelerClans(rsn);
  } catch (error) {
    // Niet kunnen kijken is geen reden om helemaal niets te zeggen.
    if (!(error instanceof WomFout)) throw error;
    logger.warn(`Clans opzoeken mislukte voor "${rsn}"`, error);
  }

  const buiten = elders.filter((clan) => !gekozen.some((naam) => normaliseerNaam(naam) === normaliseerNaam(clan.naam)));

  const staart = ' Je naam blijft gekoppeld, dus zodra je lid wordt telt hij vanzelf mee.';

  if (buiten.length > 0) {
    return (
      `**${rsn}** staat niet in ${waar}, maar wel in ` +
      `${buiten.map((clan) => `**${clan.naam}**`).join(', ')}. Die telt hier niet mee.` + staart
    );
  }

  return (
    `**${rsn}** staat niet in ${waar}. Klopt je naam precies? ` +
    'Is dat zo, dan staat hij nog niet in de ledenlijst op WiseOldMan — die wordt door de clan zelf bijgehouden.' +
    staart
  );
}
