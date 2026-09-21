import { ApplicationFlagsBitField, GatewayIntentBits } from 'discord.js';
import { logger } from './logger.js';

/**
 * De Server Members Intent is er eentje met een addertje: vraag je hem aan
 * terwijl hij in het Developer Portal uitstaat, dan weigert Discord de hele
 * inlog. Niet "dat ene stukje werkt niet" — de bot start helemaal niet meer.
 *
 * Daarom vragen we het eerst netjes: bij de applicatie staat of de schakelaar
 * aanstaat. Staat hij uit, dan start de bot zonder die intent en werkt alles
 * behalve het welkomstbericht voor nieuwe leden.
 */

const BASIS_INTENTS = [GatewayIntentBits.Guilds] as const;

/** Wat de bot aan Discord vraagt, gegeven wat er in het portal aanstaat. */
export async function kiesIntents(token: string): Promise<GatewayIntentBits[]> {
  if (await ledenIntentAan(token)) return [...BASIS_INTENTS, GatewayIntentBits.GuildMembers];

  logger.warn(
    'Server Members Intent staat uit — nieuwe leden krijgen geen welkomstbericht met de koppelknop.\n' +
      '  Aanzetten: Developer Portal -> jouw applicatie -> Bot -> Privileged Gateway Intents -> Server Members Intent.\n' +
      '  Daarna de bot opnieuw starten. De rest werkt gewoon; /clan koppel en de knop uit /clan knop ook.',
  );

  return [...BASIS_INTENTS];
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
