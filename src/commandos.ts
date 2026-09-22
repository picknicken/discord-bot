import { Routes, type Client } from 'discord.js';
import { logger } from './util/logger.js';

/**
 * De slash-commando's bij Discord aanmelden.
 *
 * Dit was handwerk: een workflow starten na elke wijziging, en als je daar het
 * veld "testserver" invulde stonden ze alleen daar. Dat zie je niet aan de bot -
 * die draait gewoon - maar wel in elke andere server, waar je /setup dan
 * tevergeefs staat te typen.
 *
 * Dus doet de bot het nu zelf bij het opstarten. Maar alleen als er iets
 * veranderd is: Discord staat maar tweehonderd wijzigingen per dag toe, en een
 * bot die bij elke herstart opnieuw aanmeldt is precies het soort ding dat een
 * maand later op een rate limit stukloopt. Vandaar dat we eerst ophalen wat er
 * staat en dat vergelijken.
 */

export interface CommandoJSON {
  name: string;
  [veld: string]: unknown;
}

const lijst = (waarde: unknown): Record<string, unknown>[] =>
  Array.isArray(waarde) ? (waarde as Record<string, unknown>[]) : [];

/**
 * Alleen de velden waar wij iets over te zeggen hebben.
 *
 * Discord stuurt van alles terug wat wij nooit verstuurd hebben (id, versie,
 * vertalingen), en laat weg wat op de standaardwaarde staat. Zonder dit opschonen
 * verschilt het altijd, en meldt de bot bij elke herstart opnieuw aan.
 */
function netteOptie(optie: Record<string, unknown>): Record<string, unknown> {
  return {
    name: optie['name'],
    description: optie['description'] ?? '',
    type: optie['type'],
    required: optie['required'] ?? false,
    autocomplete: optie['autocomplete'] ?? false,
    choices: lijst(optie['choices']).map((keuze) => ({ name: keuze['name'], value: keuze['value'] })),
    channel_types: lijst(optie['channel_types']),
    min_value: optie['min_value'] ?? null,
    max_value: optie['max_value'] ?? null,
    min_length: optie['min_length'] ?? null,
    max_length: optie['max_length'] ?? null,
    options: lijst(optie['options']).map(netteOptie),
  };
}

export function netjes(command: CommandoJSON): Record<string, unknown> {
  return {
    name: command['name'],
    description: command['description'] ?? '',
    type: command['type'] ?? 1,
    default_member_permissions: command['default_member_permissions'] ?? null,
    nsfw: command['nsfw'] ?? false,
    options: lijst(command['options']).map(netteOptie),
  };
}

const opNaam = (commandos: readonly CommandoJSON[]) =>
  [...commandos].sort((a, b) => a.name.localeCompare(b.name)).map(netjes);

/** Staat bij Discord precies wat wij bedoelen? */
export function zelfde(onze: readonly CommandoJSON[], bijDiscord: readonly CommandoJSON[]): boolean {
  return JSON.stringify(opNaam(onze)) === JSON.stringify(opNaam(bijDiscord));
}

/** Wat er zou veranderen, in gewone woorden - genoeg voor één regel in het log. */
export function watVerandert(
  onze: readonly CommandoJSON[],
  bijDiscord: readonly CommandoJSON[],
): { erbij: string[]; weg: string[]; anders: string[] } {
  const hier = new Map(onze.map((command) => [command.name, netjes(command)]));
  const daar = new Map(bijDiscord.map((command) => [command.name, netjes(command)]));

  return {
    erbij: [...hier.keys()].filter((naam) => !daar.has(naam)),
    weg: [...daar.keys()].filter((naam) => !hier.has(naam)),
    anders: [...hier.keys()].filter(
      (naam) => daar.has(naam) && JSON.stringify(hier.get(naam)) !== JSON.stringify(daar.get(naam)),
    ),
  };
}

/** Eén regel die zegt wat er gebeurd is. */
export function beschrijf(verschil: { erbij: string[]; weg: string[]; anders: string[] }): string {
  const delen = [
    verschil.erbij.length > 0 ? `nieuw: ${verschil.erbij.map((naam) => `/${naam}`).join(', ')}` : '',
    verschil.anders.length > 0 ? `gewijzigd: ${verschil.anders.map((naam) => `/${naam}`).join(', ')}` : '',
    verschil.weg.length > 0 ? `weg: ${verschil.weg.map((naam) => `/${naam}`).join(', ')}` : '',
  ].filter(Boolean);

  return delen.length > 0 ? delen.join(' · ') : 'niets veranderd';
}

/** Zo praat je met Discord, of je nu een ingelogde bot bent of een los script. */
export interface CommandoKoppeling {
  get: (route: string) => Promise<unknown>;
  put: (route: string, body: CommandoJSON[]) => Promise<unknown>;
}

export const koppelingVan = (client: Client): CommandoKoppeling => ({
  get: (route) => client.rest.get(route as `/${string}`),
  put: (route, body) => client.rest.put(route as `/${string}`, { body }),
});

export const overal = (clientId: string): string => Routes.applicationCommands(clientId) as string;
export const inServer = (clientId: string, guildId: string): string =>
  Routes.applicationGuildCommands(clientId, guildId) as string;

export interface Uitkomst {
  /** Is er echt iets naar Discord gestuurd? */
  aangemeld: boolean;
  /** Wat er nu bij Discord staat. */
  commandos: CommandoJSON[];
  uitleg: string;
}

/**
 * De commando's gelijktrekken met wat deze versie van de bot kent.
 *
 * Met `altijd` slaan we het vergelijken over; dat is voor de knop in het
 * dashboard, waar iemand bewust op "nu aanmelden" drukt omdat hij twijfelt.
 */
export async function meldCommandosAan(
  koppeling: CommandoKoppeling,
  route: string,
  onze: readonly CommandoJSON[],
  opties: { altijd?: boolean } = {},
): Promise<Uitkomst> {
  const bijDiscord = ((await koppeling.get(route)) ?? []) as CommandoJSON[];

  if (!opties.altijd && zelfde(onze, bijDiscord)) {
    return { aangemeld: false, commandos: bijDiscord, uitleg: 'stonden al goed' };
  }

  const verschil = watVerandert(onze, bijDiscord);
  const nu = ((await koppeling.put(route, [...onze])) ?? []) as CommandoJSON[];
  return { aangemeld: true, commandos: nu, uitleg: beschrijf(verschil) };
}

/**
 * Bij het opstarten: zorgen dat de commando's kloppen, zonder dat een mislukking
 * de bot tegenhoudt. Kan Discord ze even niet aannemen, dan is dat vervelend
 * maar geen reden om de hele bot niet te laten draaien.
 */
export async function zorgVoorCommandos(client: Client<true>, onze: readonly CommandoJSON[]): Promise<void> {
  try {
    const uitkomst = await meldCommandosAan(koppelingVan(client), overal(client.application.id), onze);

    if (uitkomst.aangemeld) {
      logger.info(
        `Slash-commando's bijgewerkt bij Discord (${uitkomst.uitleg}). ` +
          'In een server waar de bot al zit kan het tot een uur duren voor je ze ziet.',
      );
    } else {
      logger.info(`Slash-commando's staan al goed: ${uitkomst.commandos.map((c) => `/${c.name}`).join(', ')}`);
    }
  } catch (error) {
    logger.error(
      'Slash-commando\'s aanmelden mislukt. De bot draait gewoon door; ' +
        'in het dashboard staat een knop om het opnieuw te proberen.',
      error,
    );
  }
}
