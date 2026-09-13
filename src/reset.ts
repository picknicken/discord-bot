import type { Guild } from 'discord.js';
import type { GuildSnapshot } from './snapshot.js';
import { logger } from './util/logger.js';

/**
 * Een server leeghalen: alle kanalen, alle rollen die de bot mag beheren, en de
 * AutoMod-regels. Bedoeld om een testserver opnieuw te kunnen gebruiken.
 *
 * Wat er nooit aan gaat:
 *  - @everyone, want die hoort bij de server zelf;
 *  - rollen van bots en integraties, die beheert Discord;
 *  - rollen die even hoog of hoger staan dan de bot, want dat weigert Discord toch;
 *  - leden, berichten, emoji's en de servernaam.
 */

export interface ResetTarget {
  id: string;
  name: string;
}

/** Wat er weg mag. Alles aan is de standaard; uitzetten laat dat deel staan. */
export interface ResetScope {
  channels: boolean;
  roles: boolean;
  automod: boolean;
  /** Rollen die hoe dan ook blijven staan, op naam. Hoofdletters maken niet uit. */
  behoudRollen?: readonly string[];
}

export const ALLES: ResetScope = { channels: true, roles: true, automod: true, behoudRollen: [] };

const normaliseer = (naam: string) => naam.trim().toLowerCase();

export interface ResetPlan {
  channels: ResetTarget[];
  roles: ResetTarget[];
  automod: ResetTarget[];
  /** Wat met opzet blijft staan, met de reden erbij. */
  skipped: string[];
}

export interface ResetResult {
  deleted: number;
  failed: number;
  errors: string[];
  /** Extra uitleg als alle fouten dezelfde oorzaak hebben. */
  hint: string | null;
}

const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_AUTOMOD = 10066;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;
/** Het regels- en updateskanaal van een community-server. */
const COMMUNITY_CHANNEL = 50074;

function codeOf(error: unknown): number | null {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'number' ? code : null;
}

/** De HTTP-status, als die er is. Een 404 betekent: het was er al niet meer. */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') return status;
  const message = error instanceof Error ? error.message : String(error);
  return /^404\b/.test(message) ? 404 : null;
}

/** Discord's foutteksten zijn kort; dit zegt wat het in de praktijk betekent. */
export function explainDeleteFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  switch (codeOf(error)) {
    case MISSING_ACCESS:
      return `${message} — de bot kan dit kanaal niet zien, dus hij kan het ook niet verwijderen.`;
    case MISSING_PERMISSIONS:
      return `${message} — de bot mist het recht hiervoor. Staat zijn rol hoog genoeg?`;
    case COMMUNITY_CHANNEL:
      return (
        `${message} — dit is het regels- of updateskanaal van een community-server. ` +
        'Discord laat dat niet verwijderen zolang community-modus aanstaat. Zet die uit in ' +
        'Serverinstellingen -> Inschakelen community, of geef de bot Administrator zodat hij het zelf kan.'
      );
    default:
      return message;
  }
}

export const ACCESS_HINT =
  'De bot kan een deel van deze server niet zien. Dat gebeurt bij kanalen die @everyone ' +
  'niet mag bekijken: de bot hoort ook bij @everyone. Servers die vanaf nu worden ingericht ' +
  'houden een uitzondering voor de bot. Voor deze server: geef de bot tijdelijk Administrator ' +
  '(Serverinstellingen -> Rollen), haal hem leeg, en zet het daarna weer uit.';

/** Eén regel die zegt wat er deze keer aan de beurt is. */
export function describeScope(scope: ResetScope): string {
  const weg = [
    scope.channels ? 'kanalen' : null,
    scope.roles ? 'rollen' : null,
    scope.automod ? 'automod-regels' : null,
  ].filter((deel): deel is string => deel !== null);

  const blijft = [
    scope.channels ? null : 'kanalen',
    scope.roles ? null : 'rollen',
    scope.automod ? null : 'automod-regels',
  ].filter((deel): deel is string => deel !== null);

  const uitzonderingen = scope.behoudRollen ?? [];
  const extra =
    uitzonderingen.length > 0
      ? ` Deze rollen blijven hoe dan ook: ${uitzonderingen.map((naam) => `@${naam}`).join(', ')}.`
      : '';

  if (weg.length === 0) return 'Niets aangevinkt — er gaat niets weg.' + extra;
  return (
    `Weg: ${weg.join(', ')}.` + (blijft.length > 0 ? ` Blijft staan: ${blijft.join(', ')}.` : '') + extra
  );
}

export function planReset(
  snapshot: GuildSnapshot,
  botHighestPosition: number,
  scope: ResetScope = ALLES,
): ResetPlan {
  const skipped: string[] = [];

  const roles: ResetTarget[] = [];
  if (!scope.roles) {
    if (snapshot.roles.some((role) => !role.isEveryone)) {
      skipped.push('rollen blijven staan; die keuze is zo gemaakt');
    }
  } else {
    const uitzonderingen = new Set((scope.behoudRollen ?? []).map(normaliseer));
    const gebruikt = new Set<string>();

    for (const role of snapshot.roles) {
      if (role.isEveryone) continue;

      if (uitzonderingen.has(normaliseer(role.name))) {
        gebruikt.add(normaliseer(role.name));
        skipped.push(`rol "${role.name}" staat op de lijst met rollen die moeten blijven`);
        continue;
      }
      if (role.managed) {
        skipped.push(`rol "${role.name}" hoort bij een bot of integratie`);
        continue;
      }
      if (role.position >= botHighestPosition) {
        skipped.push(`rol "${role.name}" staat even hoog als of hoger dan de bot`);
        continue;
      }
      roles.push({ id: role.id, name: role.name });
    }

    // Een typfout in een uitzondering mag niet stilletjes een rol weggooien die
    // je juist wilde houden. Dus zeggen we het als een naam nergens op slaat.
    for (const naam of scope.behoudRollen ?? []) {
      if (!gebruikt.has(normaliseer(naam))) {
        skipped.push(`let op: er is geen rol die "${naam}" heet — die uitzondering doet niets`);
      }
    }
  }

  if (!scope.channels && (snapshot.channels.length > 0 || snapshot.categories.length > 0)) {
    skipped.push('kanalen blijven staan; die keuze is zo gemaakt');
  }
  if (!scope.automod && snapshot.automod.length > 0) {
    skipped.push('automod-regels blijven staan; die keuze is zo gemaakt');
  }

  return {
    // Categorieen achteraan: de kanalen erin gaan eerst weg.
    channels: scope.channels
      ? [
          ...snapshot.channels.map((channel) => ({ id: channel.id, name: channel.name })),
          ...snapshot.categories.map((category) => ({ id: category.id, name: category.name })),
        ]
      : [],
    roles,
    automod: scope.automod ? snapshot.automod.map((rule) => ({ id: rule.id, name: rule.name })) : [],
    skipped,
  };
}

export function describeReset(plan: ResetPlan): string[] {
  return [
    ...plan.channels.map((channel) => `- kanaal ${channel.name}`),
    ...plan.roles.map((role) => `- rol @${role.name}`),
    ...plan.automod.map((rule) => `- automod "${rule.name}"`),
    ...plan.skipped.map((reason) => `  blijft staan: ${reason}`),
  ];
}

export function countReset(plan: ResetPlan): number {
  return plan.channels.length + plan.roles.length + plan.automod.length;
}

/**
 * Het regels- en updateskanaal van een community-server laat Discord niet
 * verwijderen zolang die modus aanstaat. Leeghalen betekent leeg, dus zetten we
 * community-modus eerst uit - dat vraagt Administrator. Lukt dat niet, dan
 * blijven die twee kanalen staan en zegt hij waarom.
 */
async function zetCommunityUit(guild: Guild, reason: string): Promise<string | null> {
  if (!guild.features.includes('COMMUNITY')) return null;

  try {
    await guild.edit({
      features: guild.features.filter((feature) => feature !== 'COMMUNITY'),
      reason,
    });
    return 'community-modus uitgezet; anders blijven het regels- en updateskanaal staan.';
  } catch (error) {
    const uitleg = error instanceof Error ? error.message : String(error);
    return (
      `community-modus kon niet uit (${uitleg}). Het regels- en updateskanaal blijven daardoor staan. ` +
      'Zet community-modus uit in Serverinstellingen -> Inschakelen community, of geef de bot Administrator.'
    );
  }
}

export async function applyReset(guild: Guild, plan: ResetPlan, reason: string): Promise<ResetResult> {
  const result: ResetResult = { deleted: 0, failed: 0, errors: [], hint: null };
  let geenToegang = false;

  const remove = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
      result.deleted += 1;
    } catch (error) {
      // Al weg is ook goed; daar hoeft niemand iets mee.
      if (codeOf(error) === UNKNOWN_CHANNEL || codeOf(error) === UNKNOWN_AUTOMOD || statusOf(error) === 404) {
        result.deleted += 1;
        return;
      }
      if (codeOf(error) === MISSING_ACCESS) geenToegang = true;

      result.failed += 1;
      const uitleg = explainDeleteFailure(error);
      result.errors.push(`${what}: ${uitleg}`);
      logger.warn(`Verwijderen mislukt (${what}): ${uitleg}`);
    }
  };

  if (plan.channels.length > 0) {
    const melding = await zetCommunityUit(guild, reason);
    if (melding) {
      result.errors.push(melding);
      logger.info(melding);
    }
  }

  for (const channel of plan.channels) {
    await remove(`kanaal ${channel.name}`, async () => {
      const target = await guild.channels.fetch(channel.id);
      if (target) await target.delete(reason);
    });
  }

  for (const role of plan.roles) {
    await remove(`rol ${role.name}`, async () => {
      const target = await guild.roles.fetch(role.id);
      if (target) await target.delete(reason);
    });
  }

  for (const rule of plan.automod) {
    await remove(`automod ${rule.name}`, async () => {
      await guild.autoModerationRules.delete(rule.id, reason);
    });
  }

  if (geenToegang) result.hint = ACCESS_HINT;
  return result;
}
