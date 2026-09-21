import { AuditLogEvent, type Guild } from 'discord.js';

/**
 * Wie heeft er iets veranderd in de server?
 *
 * "Drie verschillen met de template" zegt wát er anders is, niet hoe het zo
 * gekomen is. Discord houdt dat bij in het auditlog; de bot kon er alleen nog
 * niet bij kijken. Vaak is dat het enige wat je wil weten: is dit expres
 * gebeurd, of is er iets omgevallen?
 *
 * Het auditlog gaat niet eindeloos terug - Discord bewaart het een week of zes -
 * dus dit is "wat er recent is veranderd", niet "alles wat er ooit gebeurde".
 */
export interface Wijziging {
  /** Waar het over ging. */
  soort: 'kanaal' | 'rol' | 'rechten' | 'server' | 'automod' | 'emoji';
  /** Wat ermee gebeurde. */
  wat: 'erbij' | 'weg' | 'anders';
  naam: string;
  door: string;
  at: string;
}

const SOORTEN: Partial<Record<AuditLogEvent, { soort: Wijziging['soort']; wat: Wijziging['wat'] }>> = {
  [AuditLogEvent.ChannelCreate]: { soort: 'kanaal', wat: 'erbij' },
  [AuditLogEvent.ChannelUpdate]: { soort: 'kanaal', wat: 'anders' },
  [AuditLogEvent.ChannelDelete]: { soort: 'kanaal', wat: 'weg' },
  [AuditLogEvent.ChannelOverwriteCreate]: { soort: 'rechten', wat: 'erbij' },
  [AuditLogEvent.ChannelOverwriteUpdate]: { soort: 'rechten', wat: 'anders' },
  [AuditLogEvent.ChannelOverwriteDelete]: { soort: 'rechten', wat: 'weg' },
  [AuditLogEvent.RoleCreate]: { soort: 'rol', wat: 'erbij' },
  [AuditLogEvent.RoleUpdate]: { soort: 'rol', wat: 'anders' },
  [AuditLogEvent.RoleDelete]: { soort: 'rol', wat: 'weg' },
  [AuditLogEvent.GuildUpdate]: { soort: 'server', wat: 'anders' },
  [AuditLogEvent.EmojiCreate]: { soort: 'emoji', wat: 'erbij' },
  [AuditLogEvent.EmojiDelete]: { soort: 'emoji', wat: 'weg' },
  [AuditLogEvent.AutoModerationRuleCreate]: { soort: 'automod', wat: 'erbij' },
  [AuditLogEvent.AutoModerationRuleUpdate]: { soort: 'automod', wat: 'anders' },
  [AuditLogEvent.AutoModerationRuleDelete]: { soort: 'automod', wat: 'weg' },
};

/** Alleen wat over de inrichting gaat; bans en berichten zijn niet onze zaak. */
export const AUDIT_SOORTEN = Object.keys(SOORTEN).map(Number) as AuditLogEvent[];

/**
 * Eén regel uit het auditlog in onze vorm, of null als het ons niet aangaat.
 *
 * Bij een verwijderd kanaal is het doel weg, dus dan staat de naam alleen nog in
 * de wijzigingen zelf. Zonder die omweg zou juist de interessantste regel -
 * "iemand heeft #media weggegooid" - geen naam hebben.
 */
export function leesEntry(entry: {
  action: number;
  target?: unknown;
  changes?: readonly { key: string; old?: unknown; new?: unknown }[];
  executor?: { globalName?: string | null; username?: string } | null;
  createdAt?: Date;
}): Wijziging | null {
  const soort = SOORTEN[entry.action as AuditLogEvent];
  if (!soort) return null;

  const doel = entry.target as { name?: string } | null | undefined;
  const uitChanges = entry.changes?.find((change) => change.key === 'name');
  const naam =
    doel?.name ??
    (typeof uitChanges?.old === 'string' ? uitChanges.old : undefined) ??
    (typeof uitChanges?.new === 'string' ? uitChanges.new : undefined) ??
    (soort.soort === 'server' ? 'serverinstellingen' : 'onbekend');

  return {
    ...soort,
    naam,
    door: entry.executor?.globalName || entry.executor?.username || 'onbekend',
    at: (entry.createdAt ?? new Date()).toISOString(),
  };
}

export interface AuditUitkomst {
  /** Mag de bot het auditlog lezen? Zonder dat recht valt er niets te halen. */
  mag: boolean;
  wijzigingen: Wijziging[];
}

export async function recenteWijzigingen(guild: Guild, limiet = 25): Promise<AuditUitkomst> {
  try {
    const logs = await guild.fetchAuditLogs({ limit: 100 });
    const wijzigingen = [...logs.entries.values()]
      .map((entry) => leesEntry(entry as Parameters<typeof leesEntry>[0]))
      .filter((wijziging): wijziging is Wijziging => wijziging !== null)
      .slice(0, limiet);

    return { mag: true, wijzigingen };
  } catch {
    // Geen recht (of Discord doet moeilijk): dan zeggen we dat, in plaats van
    // een lege lijst te tonen alsof er niets veranderd is.
    return { mag: false, wijzigingen: [] };
  }
}
