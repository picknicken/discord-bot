import type { Client } from 'discord.js';
import { logger } from './logger.js';

/**
 * Inloggen bij Discord met een begrijpelijke fout als het misgaat. Rauw levert
 * discord.js hier "DiscordAPIError[undefined]: No Description" met een stacktrace
 * op — precies bij de fout die iedereen een keer maakt: een token die niet klopt.
 */
export async function login(client: Client, token: string): Promise<void> {
  try {
    await client.login(token);
  } catch (error) {
    logger.error(explainLoginFailure(error));
    process.exit(1);
  }
}

export function explainLoginFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  if (/token|401|unauthorized|no description/i.test(text)) {
    return [
      'Discord accepteert de token niet.',
      '',
      '  - Staat DISCORD_TOKEN in .env, zonder aanhalingstekens en zonder "Bot " ervoor?',
      '  - Een token wordt ongeldig zodra je hem reset in het Developer Portal.',
      '  - Nieuwe halen: Developer Portal -> jouw applicatie -> Bot -> Reset Token.',
    ].join('\n');
  }

  if (/disallowed intents|used disallowed/i.test(text)) {
    return 'Discord weigert de gevraagde intents. Zet in het Developer Portal onder Bot de benodigde intents aan.';
  }

  if (/enotfound|econnrefused|etimedout|network|fetch failed/i.test(text)) {
    return `Geen verbinding met Discord: ${text}. Controleer je internetverbinding of een firewall.`;
  }

  return `Inloggen bij Discord mislukt: ${text}`;
}
