import { PermissionFlagsBits, type Client, type Guild, type GuildMember } from 'discord.js';
import { logger } from '../util/logger.js';
import { haalLedenlijst, type Ledenlijst, type OphaalOpties } from './runescape.js';
import { planClanRangen, type ClanPlan, type DiscordLid, type RolInfo } from './rangen.js';
import { koppelingenVan, leesDossier, lijstDossiers, noteerRangen, type ClanDossier } from './opslag.js';

/**
 * Hier komen de drie delen bij elkaar: de ledenlijst van Jagex, de koppelingen
 * op schijf en de echte server in Discord. Eerst een plan, dan pas uitvoeren —
 * hetzelfde als bij het uitrollen van een template, en om dezelfde reden: je
 * wilt kunnen zien wie er een rol bij krijgt voordat het gebeurt.
 */

export interface SyncOpties extends OphaalOpties {
  /** Alleen deze Discord-leden bekijken. Leeg = iedereen die gekoppeld is. */
  alleen?: string[];
}

export interface ClanPlanResultaat {
  plan: ClanPlan;
  ledenlijst: Ledenlijst;
}

export async function bouwClanPlan(
  guild: Guild,
  dossier: ClanDossier,
  opties: SyncOpties = {},
): Promise<ClanPlanResultaat> {
  if (!dossier.instellingen.clan) {
    throw new Error('Er is nog geen clan ingesteld voor deze server.');
  }

  const ledenlijst = await haalLedenlijst(dossier.instellingen.clan, opties);

  const koppelingen = koppelingenVan(dossier).filter(
    (koppeling) => !opties.alleen || opties.alleen.includes(koppeling.discordId),
  );

  const leden = await verzamelLeden(
    guild,
    koppelingen.map((koppeling) => koppeling.discordId),
  );

  const plan = planClanRangen({
    instellingen: dossier.instellingen,
    koppelingen,
    clanLeden: ledenlijst.leden,
    leden,
    rollen: rolInfoVan(guild, await guild.members.fetchMe()),
  });

  return { plan, ledenlijst };
}

export interface SyncResultaat {
  aangepast: number;
  mislukt: number;
  fouten: string[];
}

/**
 * Het plan uitvoeren. Per lid één poging; gaat er eentje mis, dan gaan de
 * anderen gewoon door. Een clan van tweehonderd man hoort niet stil te vallen
 * omdat er één iemand tussen zit die de bot niet mag aanraken.
 */
export async function voerClanPlanUit(guild: Guild, plan: ClanPlan, reden: string): Promise<SyncResultaat> {
  const fouten: string[] = [];
  let aangepast = 0;
  let mislukt = 0;

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { aangepast: 0, mislukt: plan.wissels.length, fouten: ['De bot mist het recht "Rollen beheren".'] };
  }
  const magBijnamen = me.permissions.has(PermissionFlagsBits.ManageNicknames);

  for (const wissel of plan.wissels) {
    try {
      const lid = await guild.members.fetch(wissel.discordId);

      if (wissel.erbij.length > 0) await lid.roles.add(wissel.erbij, reden);
      if (wissel.eraf.length > 0) await lid.roles.remove(wissel.eraf, reden);

      if (wissel.bijnaamNaar) {
        if (!magBijnamen) {
          fouten.push(`${wissel.weergavenaam}: bijnaam niet aangepast — de bot mist "Bijnamen beheren".`);
        } else if (!lid.manageable) {
          // De eigenaar van een server kan door niemand hernoemd worden, ook
          // niet door een bot met alle rechten. Zijn rollen lukken wel.
          fouten.push(`${wissel.weergavenaam}: bijnaam niet aangepast — dit lid staat boven de bot.`);
        } else {
          await lid.setNickname(wissel.bijnaamNaar, reden);
        }
      }

      aangepast += 1;
    } catch (error) {
      mislukt += 1;
      fouten.push(`${wissel.weergavenaam}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { aangepast, mislukt, fouten };
}

/** Plan maken, uitvoeren en onthouden wat we zagen staan. */
export async function synchroniseerServer(
  clanDir: string,
  guild: Guild,
  opties: SyncOpties & { reden?: string } = {},
): Promise<ClanPlanResultaat & SyncResultaat> {
  const dossier = await leesDossier(clanDir, guild.id);
  const { plan, ledenlijst } = await bouwClanPlan(guild, dossier, opties);

  const resultaat = await voerClanPlanUit(
    guild,
    plan,
    opties.reden ?? `Clanrangen bijgewerkt vanuit "${dossier.instellingen.clan}"`,
  );

  await noteerRangen(
    clanDir,
    guild.id,
    plan.wissels.map((wissel) => ({ discordId: wissel.discordId, rang: wissel.rang, rsn: wissel.rsn })),
    { volledig: opties.alleen === undefined },
  );

  return { plan, ledenlijst, ...resultaat };
}

// --- de server uitlezen ----------------------------------------------------

/**
 * De rollen van de server, met per rol of de bot er iets mee mag. Dat hangt aan
 * twee dingen: het recht "Rollen beheren", en de plek in de lijst — Discord laat
 * een bot geen rol uitdelen die boven zijn eigen hoogste rol staat. Rollen van
 * andere bots en boosts vallen af: die deelt niemand met de hand uit.
 */
export function rolInfoVan(guild: Guild, me: GuildMember): Map<string, RolInfo> {
  const rollen = new Map<string, RolInfo>();
  const magRollen = me.permissions.has(PermissionFlagsBits.ManageRoles);
  const hoogste = me.roles.highest.position;

  for (const rol of guild.roles.cache.values()) {
    if (rol.id === guild.id) continue; // @everyone deelt niemand uit
    rollen.set(rol.id, {
      id: rol.id,
      naam: rol.name,
      beheerbaar: magRollen && !rol.managed && rol.position < hoogste,
    });
  }

  return rollen;
}

/**
 * De gekoppelde leden ophalen. Per stuk opvragen zou bij een clan van
 * tweehonderd man tweehonderd verzoeken zijn; in blokken van honderd is het er
 * twee. Wie er niet meer is komt simpelweg niet terug, en dat mag: het plan
 * zet die koppelingen apart onder "vertrokken".
 */
export async function verzamelLeden(guild: Guild, ids: string[]): Promise<Map<string, DiscordLid>> {
  const leden = new Map<string, DiscordLid>();
  if (ids.length === 0) return leden;

  const blokken: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) blokken.push(ids.slice(i, i + 100));

  for (const blok of blokken) {
    try {
      for (const lid of (await guild.members.fetch({ user: blok })).values()) {
        leden.set(lid.id, beschrijfLid(lid));
      }
    } catch (error) {
      // Lukt het blok niet, dan alsnog één voor één: liever traag dan een lege
      // lijst, want een lege lijst ziet eruit als "iedereen is vertrokken".
      logger.warn(`Leden ophalen in blok mislukte in "${guild.name}", nu één voor één`, error);
      for (const id of blok) {
        try {
          leden.set(id, beschrijfLid(await guild.members.fetch(id)));
        } catch {
          continue;
        }
      }
    }
  }

  return leden;
}

function beschrijfLid(lid: GuildMember): DiscordLid {
  return {
    id: lid.id,
    naam: lid.user.globalName || lid.user.username,
    bijnaam: lid.nickname,
    rollen: [...lid.roles.cache.keys()],
    beheerbaar: lid.manageable,
  };
}

// --- vanzelf bijwerken -----------------------------------------------------

/**
 * Eens per uur langs de servers die daarom gevraagd hebben. Promoties in een
 * clan gebeuren in het spel, niet in Discord; zonder dit zou iemand na elke
 * promotie zelf een commando moeten draaien om zijn nieuwe rol te krijgen.
 */
export function startAutomatischeSync(
  client: Client<true>,
  clanDir: string,
  intervalMinuten = 60,
): NodeJS.Timeout {
  let bezig = false;

  const ronde = async () => {
    // Een ronde langs een paar grote clans kan trager zijn dan het interval.
    // Zonder deze vlag lopen ze dan over elkaar heen en krijgt iedereen zijn
    // rollen twee keer toebedeeld.
    if (bezig) return;
    bezig = true;

    try {
      await langsDeServers(client, clanDir);
    } finally {
      bezig = false;
    }
  };

  const timer = setInterval(() => void ronde(), intervalMinuten * 60 * 1000);
  // Een openstaande timer hoort een `npm start` niet in de lucht te houden als
  // alles verder klaar is.
  timer.unref?.();
  return timer;
}

/**
 * Eén ronde. Servers die er niet om gevraagd hebben of nog geen clan hebben
 * slaat hij over, en een server die stukloopt houdt de rest niet tegen.
 */
async function langsDeServers(client: Client<true>, clanDir: string): Promise<void> {
  for (const guildId of await lijstDossiers(clanDir)) {
    try {
      const dossier = await leesDossier(clanDir, guildId);
      if (!dossier.instellingen.automatisch || !dossier.instellingen.clan) continue;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      const uitkomst = await synchroniseerServer(clanDir, guild, {
        reden: 'Clanrangen automatisch bijgewerkt',
      });

      if (uitkomst.aangepast > 0 || uitkomst.mislukt > 0) {
        logger.info(
          `Clanrangen in "${guild.name}": ${uitkomst.aangepast} bijgewerkt, ${uitkomst.mislukt} mislukt.`,
        );
      }
    } catch (error) {
      logger.warn(`Automatische clansync mislukte voor server ${guildId}`, error);
    }
  }
}
