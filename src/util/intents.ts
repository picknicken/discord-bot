import { ApplicationFlagsBitField, GatewayIntentBits } from 'discord.js';
import { logger } from './logger.js';

/**
 * Twee intents met hetzelfde addertje: vraag je ze aan terwijl ze in het
 * Developer Portal uitstaan, dan weigert Discord de hele inlog. Niet "dat ene
 * stukje werkt niet" — de bot start helemaal niet meer.
 *
 * Daarom vragen we eerst netjes na: bij de applicatie staat of de schakelaar
 * aanstaat. Staat hij uit, dan start de bot zonder die intent en werkt alles
 * behalve het stuk dat hem nodig heeft.
 */

const BASIS_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] as const;

/** Wat de bot aan Discord vraagt, gegeven wat er in het portal aanstaat. */
export async function kiesIntents(token: string): Promise<GatewayIntentBits[]> {
  const intents: GatewayIntentBits[] = [...BASIS_INTENTS];

  if (await ledenIntentAan(token)) {
    intents.push(GatewayIntentBits.GuildMembers);
  } else {
    logger.warn(
      'Server Members Intent staat uit — nieuwe leden krijgen geen welkomstbericht met de koppelknop.\n' +
        '  Aanzetten: Developer Portal -> jouw applicatie -> Bot -> Privileged Gateway Intents -> Server Members Intent.\n' +
        '  Daarna de bot opnieuw starten. De rest werkt gewoon; /clan koppel en de knop uit /clan knop ook.',
    );
  }

  if (await berichtIntentAan(token)) {
    intents.push(GatewayIntentBits.MessageContent);
  } else {
    logger.warn(
      'Message Content Intent staat uit — een naam typen in het welkomkanaal werkt dan niet; de knop en ' +
        '/clan koppel wel gewoon.\n' +
        '  Aanzetten: Developer Portal -> jouw applicatie -> Bot -> Privileged Gateway Intents -> Message Content Intent.\n' +
        '  Daarna de bot opnieuw starten.',
    );
  }

  return intents;
}

/**
 * Staat de schakelaar aan? De applicatie zelf vertelt het, in twee vlaggen:
 * eentje voor bots onder de honderd servers en eentje voor bots die daarvoor
 * zijn goedgekeurd. Allebei betekenen: je mag hem vragen.
 */
export async function ledenIntentAan(token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const antwoord = await fetcher('https://discord.com/api/v10/applications/@me', {
      headers: { authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!antwoord.ok) return false;

    const { flags } = (await antwoord.json()) as { flags?: number };
    const vlaggen = new ApplicationFlagsBitField(flags ?? 0);

    return (
      vlaggen.has(ApplicationFlagsBitField.Flags.GatewayGuildMembers) ||
      vlaggen.has(ApplicationFlagsBitField.Flags.GatewayGuildMembersLimited)
    );
  } catch {
    // Niet kunnen vragen is geen reden om de bot te laten struikelen; dan maar
    // zonder die intent starten.
    return false;
  }
}

/** Dezelfde vraag, maar dan voor de Message Content Intent. */
export async function berichtIntentAan(token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const antwoord = await fetcher('https://discord.com/api/v10/applications/@me', {
      headers: { authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!antwoord.ok) return false;

    const { flags } = (await antwoord.json()) as { flags?: number };
    const vlaggen = new ApplicationFlagsBitField(flags ?? 0);

    return (
      vlaggen.has(ApplicationFlagsBitField.Flags.GatewayMessageContent) ||
      vlaggen.has(ApplicationFlagsBitField.Flags.GatewayMessageContentLimited)
    );
  } catch {
    return false;
  }
}
