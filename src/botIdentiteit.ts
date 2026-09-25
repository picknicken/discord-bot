import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { leesServerInstellingen } from './serverInstellingen.js';
import { logger } from './util/logger.js';

/**
 * Eigen naam en plaatje van de bot, per server.
 *
 * Eén applicatie kan in servers zitten die niets met elkaar te maken hebben —
 * een bedrijf, een OSRS-clan, een vriendengroep. Overal dezelfde naam en
 * hetzelfde logo laten zien is dan een gemiste kans. Discord staat het toe: een
 * bot mag zijn eigen bijnaam en zijn eigen server-plaatje per server zetten,
 * los van zijn wereldwijde profiel. Dat plaatje staat hier als bestand, de naam
 * in server-instellingen.json — dezelfde plek als de rest van wat per server
 * verschilt.
 */

const MAP_NAAM = 'bot-avatars';
// Het dashboard verkleint een gekozen foto al in de browser tot 512x512
// voor hij hierheen gestuurd wordt; alleen een gif slaat die stap over, want
// die kan bewegen en dat gaat niet door een canvas. Deze grens is dus vooral
// een laatste rem, ruim onder de limiet van het hele dashboard-verzoek (dat
// mag als geheel 4 MB zijn, en base64 maakt een plaatje zelf al een derde
// groter).
const MAX_BYTES = 2_500_000;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export class AvatarFout extends Error {}

function mapVoor(dir: string): string {
  return path.join(dir, MAP_NAAM);
}

async function bestaandBestand(dir: string, guildId: string): Promise<string | null> {
  try {
    const namen = await readdir(mapVoor(dir));
    const naam = namen.find((n) => n.startsWith(`${guildId}.`));
    return naam ? path.join(mapVoor(dir), naam) : null;
  } catch {
    return null;
  }
}

/** Het huidige avatarbestand van deze server, of null zonder eigen plaatje. */
export async function leesAvatar(dir: string, guildId: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const bestand = await bestaandBestand(dir, guildId);
  if (!bestand) return null;

  const ext = path.extname(bestand).slice(1);
  const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? 'image/png';
  return { buffer: await readFile(bestand), mime };
}

/**
 * Zet een nieuw avatarbestand neer, als "data:image/...;base64,..." zoals een
 * <input type="file"> dat in de browser oplevert. Een eerder bestand met een
 * andere extensie gaat eerst weg, anders blijft dat oude plaatje ernaast staan.
 */
export async function bewaarAvatar(dir: string, guildId: string, dataUrl: string): Promise<void> {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!match) throw new AvatarFout('Dat is geen geldige afbeelding. Gebruik png, jpg, gif of webp.');

  const buffer = Buffer.from(match[2] as string, 'base64');
  if (buffer.length === 0) throw new AvatarFout('Die afbeelding is leeg.');
  if (buffer.length > MAX_BYTES) {
    throw new AvatarFout(
      `Die afbeelding is ${Math.round(buffer.length / 1024)} KB, dat is te groot. Hou het onder ${Math.round(MAX_BYTES / 1024)} KB.`,
    );
  }

  await mkdir(mapVoor(dir), { recursive: true });
  await verwijderAvatar(dir, guildId);
  const ext = MIME_EXT[match[1] as string] ?? 'png';
  await writeFile(path.join(mapVoor(dir), `${guildId}.${ext}`), buffer);
}

export async function verwijderAvatar(dir: string, guildId: string): Promise<void> {
  const bestand = await bestaandBestand(dir, guildId);
  if (bestand) await unlink(bestand);
}

/** Waarom de bot zijn eigen bijnaam hier niet kan zetten, of null als het wel kan. */
export function waaromGeenBijnaam(guild: Guild): string | null {
  const me = guild.members.me;
  if (!me) return 'De bot is niet meer lid van deze server.';
  if (!me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
    return 'De bot mist het recht "Eigen bijnaam wijzigen" in deze server.';
  }
  return null;
}

/**
 * Past de gewenste naam en het gewenste plaatje toe in Discord. De naam alleen
 * als hij echt anders is — bij elke herstart opnieuw dezelfde bijnaam zetten is
 * een aanroep die niets doet. Het plaatje kan niet zo worden vergeleken: wat
 * Discord teruggeeft is een hash van het plaatje zoals Discord het zelf heeft
 * verwerkt, niet van de bestanden die hier klaarstaan. Opnieuw zetten van een
 * ongewijzigd plaatje kan geen kwaad; het scheelt alleen een API-aanroep die we
 * hiermee dus niet overslaan.
 */
export async function pasIdentiteitToe(
  guild: Guild,
  wens: { naam: string | null; avatar: { buffer: Buffer } | null },
): Promise<void> {
  const me = guild.members.me;
  if (!me) return;

  const velden: { nick?: string | null; avatar?: Buffer | null } = {};

  if ((me.nickname ?? null) !== wens.naam) {
    const nee = waaromGeenBijnaam(guild);
    if (nee) logger.warn(`Eigen botnaam in "${guild.name}" niet gezet: ${nee}`);
    else velden.nick = wens.naam;
  }

  if (wens.avatar) velden.avatar = wens.avatar.buffer;
  else if (me.avatar !== null) velden.avatar = null;

  if (Object.keys(velden).length === 0) return;
  await guild.members.editMe({ ...velden, reason: 'Eigen botidentiteit voor deze server' });
}

/**
 * Alle servers met een eigen naam of plaatje bijwerken. Draait bij het opstarten
 * van de bot, zodat een herstart of een nieuwe versie de instelling niet stilletjes
 * kwijtraakt — en verder alleen als iemand het in het dashboard aanpast.
 *
 * Servers zonder eigen instelling worden overgeslagen: die kosten geen aanroep,
 * en de meeste servers hebben nooit iets aangepast.
 */
export async function synchroniseerIdentiteiten(client: Client<true>, dir: string): Promise<void> {
  const instellingen = await leesServerInstellingen(dir);

  for (const guild of client.guilds.cache.values()) {
    const eigenNaam = instellingen[guild.id]?.botNaam ?? null;
    const avatar = await leesAvatar(dir, guild.id);
    if (eigenNaam === null && !avatar) continue;

    try {
      await pasIdentiteitToe(guild, { naam: eigenNaam, avatar });
    } catch (error) {
      logger.warn(`Eigen botidentiteit voor "${guild.name}" kon niet gezet worden`, error);
    }
  }
}
