import { ChannelType, SnowflakeUtil, type Guild } from 'discord.js';

/**
 * Wat er in een server is blijven liggen.
 *
 * Een server groeit dicht: kanalen waar al een half jaar niets gebeurt, rollen
 * die niemand meer heeft, uitnodigingen die nooit verlopen. Niets daarvan is
 * kapot, dus niemand ruimt het op - je komt er alleen achter als je er expres
 * naar gaat zoeken. Dit is dat zoeken, in één lijst.
 *
 * Alles hier is alleen kijken. Wat ermee gebeurt beslis je zelf.
 */
export interface Opruimpunt {
  soort: 'kanaal' | 'rol' | 'uitnodiging' | 'webhook';
  naam: string;
  waarom: string;
}

/** Wanneer was het laatste bericht? Uit het id, want dat is een tijdstempel. */
export function laatsteBericht(lastMessageId: string | null | undefined): Date | null {
  if (!lastMessageId) return null;
  try {
    return new Date(Number(SnowflakeUtil.timestampFrom(lastMessageId)));
  } catch {
    return null;
  }
}

export function dagenGeleden(wanneer: Date, nu: Date): number {
  return Math.floor((nu.getTime() - wanneer.getTime()) / (24 * 60 * 60 * 1000));
}

export interface StilKanaal {
  name: string;
  lastMessageId: string | null;
}

/**
 * Kanalen waar het stil is.
 *
 * Een kanaal zonder berichten telt ook mee, maar zegt er wel bij dat er nooit
 * iets in gezegd is - dat is iets anders dan "ooit druk, nu stil", en het
 * verschil bepaalt of je het weggooit of nieuw leven inblaast.
 */
export function stilleKanalen(kanalen: readonly StilKanaal[], nu: Date, dagen: number): Opruimpunt[] {
  const punten: Opruimpunt[] = [];

  for (const kanaal of kanalen) {
    const laatste = laatsteBericht(kanaal.lastMessageId);

    if (!laatste) {
      punten.push({ soort: 'kanaal', naam: kanaal.name, waarom: 'nog nooit een bericht' });
      continue;
    }

    const oud = dagenGeleden(laatste, nu);
    if (oud >= dagen) {
      punten.push({ soort: 'kanaal', naam: kanaal.name, waarom: `al ${oud} dagen stil` });
    }
  }

  return punten;
}

const PRAATKANALEN = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];

export interface Opruimuitkomst {
  punten: Opruimpunt[];
  /** Wat niet bekeken kon worden, en waarom. Beter dan stilzwijgend niets tonen. */
  gemist: string[];
  dagen: number;
}

export async function opruimlijst(guild: Guild, dagen = 60): Promise<Opruimuitkomst> {
  const nu = new Date();
  const punten: Opruimpunt[] = [];
  const gemist: string[] = [];

  const praat = [...guild.channels.cache.values()]
    .filter((kanaal) => PRAATKANALEN.includes(kanaal.type))
    .map((kanaal) => ({
      name: kanaal.name,
      lastMessageId: 'lastMessageId' in kanaal ? kanaal.lastMessageId ?? null : null,
    }));

  punten.push(...stilleKanalen(praat, nu, dagen));

  // Rollen zonder leden. Alleen te zeggen als de ledenlijst er echt is: zonder
  // de Server Members Intent lijkt elke rol leeg, en dan zou dit adviseren om
  // je hele rechtenstructuur weg te gooien.
  const ledenBekend = await Promise.resolve()
    .then(() => guild.members.fetch())
    .then(() => true)
    .catch(() => false);

  if (!ledenBekend) {
    gemist.push('Rollen zonder leden: daarvoor moet de bot de ledenlijst mogen ophalen (Server Members Intent).');
  } else {
    for (const rol of guild.roles.cache.values()) {
      if (rol.id === guild.id || rol.managed) continue;
      if (rol.members.size === 0) punten.push({ soort: 'rol', naam: rol.name, waarom: 'niemand heeft deze rol' });
    }
  }

  try {
    for (const invite of (await guild.invites.fetch()).values()) {
      if (invite.maxAge === 0) {
        punten.push({
          soort: 'uitnodiging',
          naam: invite.code,
          waarom:
            `verloopt nooit · ${invite.uses ?? 0}x gebruikt` +
            (invite.inviter ? ` · van ${invite.inviter.globalName || invite.inviter.username}` : ''),
        });
      }
    }
  } catch {
    gemist.push('Uitnodigingen: die mag de bot hier niet bekijken.');
  }

  try {
    for (const webhook of (await guild.fetchWebhooks()).values()) {
      punten.push({
        soort: 'webhook',
        naam: webhook.name,
        waarom:
          (webhook.channelId ? `in #${guild.channels.cache.get(webhook.channelId)?.name ?? webhook.channelId}` : '') +
          (webhook.owner ? ` · van ${webhook.owner.username}` : ''),
      });
    }
  } catch {
    gemist.push('Webhooks: daarvoor heeft de bot het recht Webhooks beheren nodig.');
  }

  return { punten, gemist, dagen };
}
